-- Replaces the curriculum release schema with the stage-based content model.
--
-- `202608030002_curriculum_releases.sql` was written against a lesson shape that no longer exists:
-- lessons carried `conceptTitle`/`conceptLede`/`tryHint`/`previewCaption`/`defaultPresetId`/
-- `introEyebrow`, and their content lived in `content_presets` (a preview key plus code lines) and
-- `content_sections` (prose). Sub-project 2 replaced all of that with `stages` — each one a title,
-- a prose body, and a complete runnable `mainImage` source — and the TypeScript side moved with it,
-- leaving `publish_course_release` writing columns the payload no longer has. Publishing has been
-- broken since, which is why nothing has ever been published to production.
--
-- This drops the old tables rather than migrating them. The retired columns have no counterpart in
-- the new model (a preview key named an app behaviour that no longer exists; code lines were display
-- metadata, not runnable source), so there is nothing to carry across. The only rows that exist
-- anywhere are local CI fixtures.
--
-- A new migration rather than an edit to the old one: both files are already recorded in
-- `supabase_migrations.schema_migrations` on every database that has been set up, so rewriting the
-- old file in place would never re-run and would leave those databases on the broken schema
-- indefinitely.
--
-- Everything the previous migration got right is preserved deliberately and re-stated here rather
-- than inherited, so this file describes the whole curriculum schema on its own: immutability
-- enforced by trigger with a session-local teardown guard, RLS with read-only public access, writes
-- reachable only through `security definer` RPCs, and `service_role` restricted to publishing.

drop table if exists public.content_presets cascade;
drop table if exists public.content_sections cascade;
drop table if exists public.content_lessons cascade;
drop table if exists public.content_modules cascade;
drop table if exists public.content_releases cascade;

create table public.content_releases (
  id text primary key,
  schema_version integer not null check (schema_version > 0),
  minimum_app_version text not null check (length(minimum_app_version) > 0),
  checksum text not null check (checksum ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  published_at timestamptz not null default now()
);

-- At most one active release at a time. Partial so many inactive rows can coexist.
create unique index content_releases_active_idx
  on public.content_releases (active)
  where active;

create table public.content_modules (
  release_id text not null references public.content_releases (id) on delete cascade,
  id text not null,
  position integer not null,
  status text not null check (status in ('published', 'planned')),
  title text not null,
  description text not null,
  planned_lesson_count integer not null default 0,
  planned_topics jsonb not null default '[]'::jsonb,
  primary key (release_id, id)
);

-- `try_this` is the only nullable column: it is an optional authoring prompt, absent on most
-- lessons. Everything else the stage model needs is required.
create table public.content_lessons (
  release_id text not null references public.content_releases (id) on delete cascade,
  id text not null,
  module_id text not null,
  position integer not null,
  title text not null,
  short_title text not null,
  intro text not null,
  takeaway text not null,
  try_this text,
  primary key (release_id, id),
  foreign key (release_id, module_id) references public.content_modules (release_id, id) on delete cascade
);

-- Replaces both `content_presets` and `content_sections`: a stage carries its own prose *and* its
-- own runnable source, which is exactly the split those two tables used to make.
--
-- `helpers` is nullable and mirrors the `helpers` column on the device's `lesson_stages` table. It
-- holds GLSL spliced above `mainImage` for stages that declare their own functions, and NULL keeps
-- "no helpers" a single representation rather than splitting it between NULL and empty string.
create table public.content_stages (
  release_id text not null references public.content_releases (id) on delete cascade,
  id text not null,
  lesson_id text not null,
  position integer not null,
  title text not null,
  body text not null,
  source text not null,
  helpers text,
  primary key (release_id, id),
  foreign key (release_id, lesson_id) references public.content_lessons (release_id, id) on delete cascade
);

-- Published releases (and their children) are immutable. This trigger is the single place that
-- enforces it, so no future RPC or ad-hoc admin query can accidentally corrupt history: once a
-- release row exists, its id/schema_version/minimum_app_version/checksum/published_at cannot change,
-- the row cannot be deleted, and none of its child rows can be changed or deleted either. `active` is
-- the one mutable field, and only on `content_releases`, because activating a different release is
-- the whole point of publishing one. Child tables (`content_modules`/`content_lessons`/
-- `content_stages`) have no mutable field at all: every update to any of their rows is rejected, not
-- just delete, because they carry no analogue of `active`.
--
-- `publish_course_release` still needs to delete a release it *itself* just inserted, inside the same
-- transaction, if a nested-count check fails partway through. It does this by deleting through a
-- session-local guard flag rather than bypassing the trigger, so the immutability rule has no
-- back door reachable from SQL a caller controls.
create or replace function public.reject_published_mutation()
returns trigger
language plpgsql
as $$
begin
  if current_setting('shadercraft.allow_release_teardown', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    raise exception 'published curriculum content is immutable' using errcode = '42501';
  end if;

  -- tg_op = 'UPDATE'. On content_releases only `active` may move; every other table has no mutable
  -- field, so any update at all is rejected (tg_table_name distinguishes the two cases because one
  -- trigger function is shared by all four tables).
  if tg_table_name = 'content_releases' then
    if new.id is distinct from old.id
      or new.schema_version is distinct from old.schema_version
      or new.minimum_app_version is distinct from old.minimum_app_version
      or new.checksum is distinct from old.checksum
      or new.published_at is distinct from old.published_at
    then
      raise exception 'published curriculum content is immutable' using errcode = '42501';
    end if;
  else
    raise exception 'published curriculum content is immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger content_releases_immutable
  before update or delete on public.content_releases
  for each row execute function public.reject_published_mutation();

create trigger content_modules_immutable
  before update or delete on public.content_modules
  for each row execute function public.reject_published_mutation();

create trigger content_lessons_immutable
  before update or delete on public.content_lessons
  for each row execute function public.reject_published_mutation();

create trigger content_stages_immutable
  before update or delete on public.content_stages
  for each row execute function public.reject_published_mutation();

alter table public.content_releases enable row level security;
alter table public.content_modules enable row level security;
alter table public.content_lessons enable row level security;
alter table public.content_stages enable row level security;

-- Every published release is readable by anyone, signed in or not — curriculum content is not
-- per-user data. There is no "select only the active one" restriction here: `get_course_release`
-- lets a client fetch a non-active-but-published release it already knows the id of (e.g. one it
-- downloaded earlier), while `get_active_course_manifest` is how it discovers what is current.
create policy content_releases_select_all
  on public.content_releases for select to anon, authenticated using (true);
create policy content_modules_select_all
  on public.content_modules for select to anon, authenticated using (true);
create policy content_lessons_select_all
  on public.content_lessons for select to anon, authenticated using (true);
create policy content_stages_select_all
  on public.content_stages for select to anon, authenticated using (true);

-- No write policies exist for anon/authenticated on any of these tables, and RLS has no default
-- allow, so only `security definer` RPCs (below) or the table owner can ever write here.
revoke all on public.content_releases, public.content_modules, public.content_lessons,
  public.content_stages
  from anon, authenticated;
grant select on public.content_releases, public.content_modules, public.content_lessons,
  public.content_stages
  to anon, authenticated;
-- service_role (the publishing tool / CI) only ever reads these tables directly, e.g. to confirm a
-- publish landed. It writes exclusively through `publish_course_release`, which is `security
-- definer` and therefore runs with the function owner's privileges, not the caller's — it needs no
-- table-level write grant to insert/update/delete. Granting service_role raw write access here would
-- only reopen the immutability hole the triggers above close (an update/delete no longer needs to be
-- routed through the RPC's own checks).
grant select on public.content_releases, public.content_modules, public.content_lessons,
  public.content_stages
  to service_role;

/**
 * Reassembles one published release as a single JSONB document shaped exactly like `CourseRelease`
 * (src/data/course/types.ts): camelCase keys, nested release -> modules -> lessons -> stages, each
 * level ordered by its `position`. `parseCourseRelease` can consume this result with no
 * transformation, which is what lets the client-side release-download path share the same schema and
 * validator as authored, checked-in content.
 *
 * Only returns a published (i.e. existing) release row; there is no distinction between "not found"
 * and "not published" because every row in these tables is, by construction, published.
 *
 * `src/data/course/schema.ts` parses this with `.strict()` Zod object schemas where every optional
 * field is `z.string().optional()` — which accepts a missing key but rejects an explicit JSON
 * `null`. `try_this` (on a lesson) and `helpers` (on a stage) are both nullable columns that are
 * absent far more often than present, so the whole result is wrapped in `jsonb_strip_nulls`, which
 * drops any object key whose value is JSON `null` (recursively, at every nesting level) and leaves
 * everything else — including legitimately empty arrays like `plannedTopics: []`, which is never
 * JSON null — untouched.
 */
create or replace function public.get_course_release(p_release_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', r.id,
    'schemaVersion', r.schema_version,
    'minimumAppVersion', r.minimum_app_version,
    'checksum', r.checksum,
    'modules', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'position', m.position,
          'status', m.status,
          'title', m.title,
          'description', m.description,
          'plannedLessonCount', m.planned_lesson_count,
          'plannedTopics', m.planned_topics,
          'lessons', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', l.id,
                'moduleId', l.module_id,
                'position', l.position,
                'title', l.title,
                'shortTitle', l.short_title,
                'intro', l.intro,
                'takeaway', l.takeaway,
                'tryThis', l.try_this,
                'stages', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', s.id,
                      'position', s.position,
                      'title', s.title,
                      'body', s.body,
                      'source', s.source,
                      'helpers', s.helpers
                    ) order by s.position
                  )
                  from public.content_stages s
                  where s.release_id = r.id and s.lesson_id = l.id
                ), '[]'::jsonb)
              ) order by l.position
            )
            from public.content_lessons l
            where l.release_id = r.id and l.module_id = m.id
          ), '[]'::jsonb)
        ) order by m.position
      )
      from public.content_modules m
      where m.release_id = r.id
    ), '[]'::jsonb)
  ))
  from public.content_releases r
  where r.id = p_release_id;
$$;

revoke all on function public.get_course_release(text) from public, anon, authenticated;
grant execute on function public.get_course_release(text) to anon, authenticated;

/**
 * Publishes one immutable curriculum release from a JSONB payload shaped like `CourseRelease`.
 *
 * Restricted to the `service_role` JWT — the publishing tool and CI are the only holders of that
 * credential; mobile clients only ever get the anon/publishable key, so this function is
 * unreachable from the app. Rejects everyone else, including signed-in learners, with 42501.
 *
 * Republishing the same release id with the same checksum is a no-op that returns success: a
 * publishing tool retried after a network blip should not fail just because its first attempt
 * actually landed. Republishing the same id with a *different* checksum is refused, because a
 * release id names one immutable payload forever; a correction must publish under a new id.
 *
 * On a fresh publish, every nested row is inserted, and the expected nested counts (modules,
 * lessons, stages) are checked against the *actual* row counts left in the tables for this release,
 * all inside one transaction, before the release is activated. The expected counts are computed
 * once, directly from the payload's JSON structure (`jsonb_array_length` over its nested arrays),
 * entirely independently of the insert loop below — they are not incremented alongside each insert.
 * That independence is what makes the comparison meaningful: if the insert loop and the count
 * derivation ever disagree about how many rows a payload implies (e.g. a future edit teaches one of
 * them to skip or dedupe something the other still counts), this catches it, rather than two numbers
 * that were always definitionally equal because one was tallied by watching the other run.
 *
 * If the count check fails, the partially inserted release is torn down via the
 * `shadercraft.allow_release_teardown` guard (see `reject_published_mutation`), and the exception
 * propagates so the whole transaction rolls back regardless.
 */
create or replace function public.publish_course_release(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
  v_id text := p_payload ->> 'id';
  v_checksum text := p_payload ->> 'checksum';
  v_schema_version integer := (p_payload ->> 'schemaVersion')::integer;
  v_minimum_app_version text := p_payload ->> 'minimumAppVersion';
  v_existing public.content_releases;
  v_module jsonb;
  v_lesson jsonb;
  v_stage jsonb;
  v_expected_modules integer := jsonb_array_length(coalesce(p_payload -> 'modules', '[]'::jsonb));
  v_expected_lessons integer;
  v_expected_stages integer;
  v_actual_modules integer;
  v_actual_lessons integer;
  v_actual_stages integer;
begin
  if v_role <> 'service_role' then
    raise exception 'publish_course_release requires the service_role credential'
      using errcode = '42501';
  end if;

  if v_id is null or length(v_id) = 0 then
    raise exception 'release id is required' using errcode = '22004';
  end if;

  select * into v_existing from public.content_releases where id = v_id;

  if found then
    if v_existing.checksum = v_checksum then
      -- Same id, same checksum: already published. Ensure it is active and return, without
      -- touching any child rows (they are immutable and, being identical, need no changes).
      update public.content_releases set active = false where id <> v_id and active;
      update public.content_releases set active = true where id = v_id;
      return;
    else
      raise exception 'release % is already published with a different checksum', v_id
        using errcode = '23505';
    end if;
  end if;

  -- Expected nested counts, derived once from the payload's own JSON structure and never touched
  -- again — in particular, never incremented from inside the insert loop below. See the function
  -- comment for why that independence matters.
  select coalesce(sum(jsonb_array_length(coalesce(module -> 'lessons', '[]'::jsonb))), 0)
    into v_expected_lessons
    from jsonb_array_elements(coalesce(p_payload -> 'modules', '[]'::jsonb)) as module;

  select coalesce(sum(jsonb_array_length(coalesce(lesson -> 'stages', '[]'::jsonb))), 0)
    into v_expected_stages
    from jsonb_array_elements(coalesce(p_payload -> 'modules', '[]'::jsonb)) as module,
         jsonb_array_elements(coalesce(module -> 'lessons', '[]'::jsonb)) as lesson;

  insert into public.content_releases (id, schema_version, minimum_app_version, checksum, active)
  values (v_id, v_schema_version, v_minimum_app_version, v_checksum, false);

  for v_module in select * from jsonb_array_elements(coalesce(p_payload -> 'modules', '[]'::jsonb))
  loop
    insert into public.content_modules (
      release_id, id, position, status, title, description, planned_lesson_count, planned_topics
    ) values (
      v_id,
      v_module ->> 'id',
      (v_module ->> 'position')::integer,
      v_module ->> 'status',
      v_module ->> 'title',
      v_module ->> 'description',
      coalesce((v_module ->> 'plannedLessonCount')::integer, 0),
      coalesce(v_module -> 'plannedTopics', '[]'::jsonb)
    );

    for v_lesson in select * from jsonb_array_elements(coalesce(v_module -> 'lessons', '[]'::jsonb))
    loop
      insert into public.content_lessons (
        release_id, id, module_id, position, title, short_title, intro, takeaway, try_this
      ) values (
        v_id,
        v_lesson ->> 'id',
        v_lesson ->> 'moduleId',
        (v_lesson ->> 'position')::integer,
        v_lesson ->> 'title',
        v_lesson ->> 'shortTitle',
        v_lesson ->> 'intro',
        v_lesson ->> 'takeaway',
        v_lesson ->> 'tryThis'
      );

      for v_stage in select * from jsonb_array_elements(coalesce(v_lesson -> 'stages', '[]'::jsonb))
      loop
        insert into public.content_stages (
          release_id, id, lesson_id, position, title, body, source, helpers
        ) values (
          v_id,
          v_stage ->> 'id',
          v_lesson ->> 'id',
          (v_stage ->> 'position')::integer,
          v_stage ->> 'title',
          v_stage ->> 'body',
          v_stage ->> 'source',
          v_stage ->> 'helpers'
        );
      end loop;
    end loop;
  end loop;

  select count(*) into v_actual_modules from public.content_modules where release_id = v_id;
  select count(*) into v_actual_lessons from public.content_lessons where release_id = v_id;
  select count(*) into v_actual_stages from public.content_stages where release_id = v_id;

  if v_actual_modules <> v_expected_modules
    or v_actual_lessons <> v_expected_lessons
    or v_actual_stages <> v_expected_stages
  then
    perform set_config('shadercraft.allow_release_teardown', 'on', true);
    delete from public.content_releases where id = v_id;
    perform set_config('shadercraft.allow_release_teardown', 'off', true);
    raise exception 'release % nested row counts did not match its payload', v_id
      using errcode = '22023';
  end if;

  -- Deactivate the current release before activating the new one: the partial unique index allows
  -- at most one active row at a time, so flipping them in this order never asks it to hold two.
  update public.content_releases set active = false where id <> v_id and active;
  update public.content_releases set active = true where id = v_id;
end;
$$;

revoke all on function public.publish_course_release(jsonb) from public, anon, authenticated;
grant execute on function public.publish_course_release(jsonb) to service_role;
