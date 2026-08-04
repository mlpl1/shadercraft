-- Revisioned, per-user lesson progress for cross-device synchronisation.
--
-- Ordering is owned by the server: every accepted change bumps that row's `revision`, and a client
-- sends the revision its change was based on. A stale base is reported as a conflict rather than
-- silently overwritten, so the client can rebase and resend. `change_id` comes from one global
-- sequence, which gives clients a single monotonic cursor to pull by.
--
-- Clients never write these tables directly. All writes go through `apply_progress_mutation`, whose
-- first act is to resolve `auth.uid()`, so a caller cannot address another user's rows.

create sequence public.progress_change_id_seq;

create table public.lesson_progress (
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  completed boolean not null,
  revision bigint not null default 0,
  change_id bigint not null default nextval('public.progress_change_id_seq'),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- Cursor-based pulls read one user's rows in change order.
create index lesson_progress_user_change_idx
  on public.lesson_progress (user_id, change_id);

create table public.progress_mutations (
  mutation_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_id text not null,
  completed boolean not null,
  resulting_revision bigint not null,
  resulting_change_id bigint not null,
  accepted_at timestamptz not null default now()
);

-- Every accepted write takes the next change id and a fresh timestamp. Doing this in a trigger
-- rather than at each call site means no write can forget to advance the cursor.
create function public.stamp_progress_change()
returns trigger
language plpgsql
as $$
begin
  new.change_id := nextval('public.progress_change_id_seq');
  new.updated_at := now();
  return new;
end;
$$;

create trigger stamp_lesson_progress_change
  before insert or update on public.lesson_progress
  for each row execute function public.stamp_progress_change();

alter table public.lesson_progress enable row level security;
alter table public.progress_mutations enable row level security;

create policy lesson_progress_select_own
  on public.lesson_progress
  for select
  to authenticated
  using (user_id = auth.uid());

create policy progress_mutations_select_own
  on public.progress_mutations
  for select
  to authenticated
  using (user_id = auth.uid());

-- Readable by its owner, writable only through the RPC below.
revoke all on public.lesson_progress from anon, authenticated;
revoke all on public.progress_mutations from anon, authenticated;
grant select on public.lesson_progress to authenticated;
grant select on public.progress_mutations to authenticated;

/**
 * Applies one progress change under server-owned revision ordering.
 *
 * Returns `applied` when the change was written, or `conflict` with the current server state when
 * the supplied base revision is stale. Replaying a `mutation_id` that was already accepted returns
 * the recorded outcome without advancing anything, which is what makes client retries safe.
 */
create function public.apply_progress_mutation(
  p_mutation_id uuid,
  p_lesson_id text,
  p_completed boolean,
  p_base_revision bigint
)
returns table (
  applied boolean,
  conflict boolean,
  completed boolean,
  revision bigint,
  change_id bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_recorded public.progress_mutations;
  v_row public.lesson_progress;
begin
  if v_user_id is null then
    raise exception 'apply_progress_mutation requires an authenticated caller'
      using errcode = '28000';
  end if;

  if p_mutation_id is null then
    raise exception 'mutation_id is required' using errcode = '22004';
  end if;

  if p_lesson_id is null or length(p_lesson_id) = 0 then
    raise exception 'lesson_id is required' using errcode = '22004';
  end if;

  if p_completed is null or p_base_revision is null then
    raise exception 'completed and base_revision are required' using errcode = '22004';
  end if;

  -- Already accepted: hand back exactly what was recorded the first time.
  select * into v_recorded
    from public.progress_mutations m
    where m.mutation_id = p_mutation_id;

  if found then
    if v_recorded.user_id <> v_user_id then
      raise exception 'mutation_id belongs to another user' using errcode = '42501';
    end if;

    return query
      select true, false, v_recorded.completed, v_recorded.resulting_revision,
             v_recorded.resulting_change_id;
    return;
  end if;

  -- Lock this lesson's row so two concurrent callers cannot both accept a change onto the same
  -- base revision.
  select * into v_row
    from public.lesson_progress p
    where p.user_id = v_user_id and p.lesson_id = p_lesson_id
    for update;

  if found then
    if v_row.revision <> p_base_revision then
      return query select false, true, v_row.completed, v_row.revision, v_row.change_id;
      return;
    end if;

    update public.lesson_progress p
      set completed = p_completed,
          revision = p.revision + 1
      where p.user_id = v_user_id and p.lesson_id = p_lesson_id
      returning p.completed, p.revision, p.change_id
      into v_row.completed, v_row.revision, v_row.change_id;
  else
    -- No server row yet, so the only coherent base is 0.
    if p_base_revision <> 0 then
      return query select false, true, false, 0::bigint, 0::bigint;
      return;
    end if;

    insert into public.lesson_progress (user_id, lesson_id, completed, revision)
      values (v_user_id, p_lesson_id, p_completed, 1)
      returning public.lesson_progress.completed,
                public.lesson_progress.revision,
                public.lesson_progress.change_id
      into v_row.completed, v_row.revision, v_row.change_id;
  end if;

  insert into public.progress_mutations (
    mutation_id, user_id, lesson_id, completed, resulting_revision, resulting_change_id
  )
  values (
    p_mutation_id, v_user_id, p_lesson_id, v_row.completed, v_row.revision, v_row.change_id
  );

  return query select true, false, v_row.completed, v_row.revision, v_row.change_id;
end;
$$;

revoke all on function public.apply_progress_mutation(uuid, text, boolean, bigint) from public, anon;
grant execute on function public.apply_progress_mutation(uuid, text, boolean, bigint) to authenticated;
