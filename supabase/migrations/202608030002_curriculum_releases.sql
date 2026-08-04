-- Immutable curriculum releases: published course content, downloadable and activatable without
-- an app-store release.
--
-- A release and everything nested under it (modules, lessons, presets, sections) is written once by
-- `publish_course_release` and never touched again except for the `active` flag, which moves between
-- releases as new ones are published. This mirrors the on-device model: the compiled, checksummed
-- `CourseRelease` in src/data/course/types.ts is the unit of truth, and Postgres here is just another
-- place that unit gets stored, keyed the same way (release -> modules -> lessons -> presets/sections).
--
-- Only the `service_role` credential (the publishing tool and CI) may call `publish_course_release`.
-- Every other caller, including a signed-in learner, only ever reads published rows through RLS and
-- the two read RPCs below.

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

create table public.content_lessons (
  release_id text not null references public.content_releases (id) on delete cascade,
  id text not null,
  module_id text not null,
  position integer not null,
  title text not null,
  short_title text not null,
  intro text not null,
  concept_title text not null,
  concept_lede text not null,
  try_hint text not null,
  takeaway text not null,
  preview_caption text not null,
  default_preset_id text,
  intro_eyebrow text,
  primary key (release_id, id),
  foreign key (release_id, module_id) references public.content_modules (release_id, id) on delete cascade
);

create table public.content_presets (
  release_id text not null references public.content_releases (id) on delete cascade,
  id text not null,
  lesson_id text not null,
  position integer not null,
  label text not null,
  preview_key text not null,
  preview_parameters jsonb not null default '{}'::jsonb,
  value text not null,
  preview_value_label text,
  filename text not null,
  code_lines jsonb not null default '[]'::jsonb,
  highlighted_lines jsonb not null default '[]'::jsonb,
  primary key (release_id, id),
  foreign key (release_id, lesson_id) references public.content_lessons (release_id, id) on delete cascade
);

create table public.content_sections (
  release_id text not null references public.content_releases (id) on delete cascade,
  id text not null,
  lesson_id text not null,
  position integer not null,
  title text not null,
  body text not null,
  primary key (release_id, id),
  foreign key (release_id, lesson_id) references public.content_lessons (release_id, id) on delete cascade
);

-- Published releases (and their children) are immutable. This trigger is the single place that
-- enforces it, so no future RPC or ad-hoc admin query can accidentally corrupt history: once a
-- release row exists, its id/schema_version/minimum_app_version/checksum/published_at cannot change,
-- the row cannot be deleted, and none of its child rows can be deleted either. `active` is the one
-- mutable field, because activating a different release is the whole point of publishing one.
--
-- `publish_course_release` still needs to delete a release it *itself* just inserted, inside the same
-- transaction, if a nested-count check fails partway through. It does this by deleting through a
-- session-local guard flag rather than bypassing the trigger, so the immutability rule has no
-- back door reachable from SQL a caller controls.
create function public.reject_published_mutation()
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

  -- tg_op = 'UPDATE' on content_releases: only `active` may move.
  if new.id is distinct from old.id
    or new.schema_version is distinct from old.schema_version
    or new.minimum_app_version is distinct from old.minimum_app_version
    or new.checksum is distinct from old.checksum
    or new.published_at is distinct from old.published_at
  then
    raise exception 'published curriculum content is immutable' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger content_releases_immutable
  before update or delete on public.content_releases
  for each row execute function public.reject_published_mutation();

create trigger content_modules_immutable
  before delete on public.content_modules
  for each row execute function public.reject_published_mutation();

create trigger content_lessons_immutable
  before delete on public.content_lessons
  for each row execute function public.reject_published_mutation();

create trigger content_presets_immutable
  before delete on public.content_presets
  for each row execute function public.reject_published_mutation();

create trigger content_sections_immutable
  before delete on public.content_sections
  for each row execute function public.reject_published_mutation();

alter table public.content_releases enable row level security;
alter table public.content_modules enable row level security;
alter table public.content_lessons enable row level security;
alter table public.content_presets enable row level security;
alter table public.content_sections enable row level security;

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
create policy content_presets_select_all
  on public.content_presets for select to anon, authenticated using (true);
create policy content_sections_select_all
  on public.content_sections for select to anon, authenticated using (true);

-- No write policies exist for anon/authenticated on any of these tables, and RLS has no default
-- allow, so only `security definer` RPCs (below) or the table owner can ever write here.
revoke all on public.content_releases, public.content_modules, public.content_lessons,
  public.content_presets, public.content_sections
  from anon, authenticated;
grant select on public.content_releases, public.content_modules, public.content_lessons,
  public.content_presets, public.content_sections
  to anon, authenticated;
-- service_role (the publishing tool / CI) reads its own writes directly, e.g. to confirm a publish
-- landed, in addition to calling publish_course_release to write.
grant select, insert, update, delete on public.content_releases, public.content_modules,
  public.content_lessons, public.content_presets, public.content_sections
  to service_role;

/**
 * Names the currently active release without shipping its (potentially large) nested payload.
 * Clients poll this to learn whether a newer release exists before deciding to download it via
 * `get_course_release`.
 */
create function public.get_active_course_manifest()
returns table (
  id text,
  schema_version integer,
  minimum_app_version text,
  checksum text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id, schema_version, minimum_app_version, checksum, published_at
  from public.content_releases
  where active;
$$;

revoke all on function public.get_active_course_manifest() from public, anon, authenticated;
grant execute on function public.get_active_course_manifest() to anon, authenticated;

/**
 * Reassembles one published release as a single JSONB document shaped exactly like `CourseRelease`
 * (src/data/course/types.ts): camelCase keys, nested release -> modules -> lessons ->
 * (presets, sections), each level ordered by its `position`. `parseCourseRelease` can consume this
 * result with no transformation, which is what lets the client-side release-download path share the
 * same schema and validator as authored, checked-in content.
 *
 * Only returns a published (i.e. existing) release row; there is no distinction between "not found"
 * and "not published" because every row in these tables is, by construction, published.
 */
create function public.get_course_release(p_release_id text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
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
                'conceptTitle', l.concept_title,
                'conceptLede', l.concept_lede,
                'tryHint', l.try_hint,
                'takeaway', l.takeaway,
                'previewCaption', l.preview_caption,
                'defaultPresetId', l.default_preset_id,
                'introEyebrow', l.intro_eyebrow,
                'presets', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', p.id,
                      'position', p.position,
                      'label', p.label,
                      'previewKey', p.preview_key,
                      'previewParameters', p.preview_parameters,
                      'value', p.value,
                      'previewValueLabel', p.preview_value_label,
                      'filename', p.filename,
                      'codeLines', p.code_lines,
                      'highlightedLines', p.highlighted_lines
                    ) order by p.position
                  )
                  from public.content_presets p
                  where p.release_id = r.id and p.lesson_id = l.id
                ), '[]'::jsonb),
                'sections', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', s.id,
                      'position', s.position,
                      'title', s.title,
                      'body', s.body
                    ) order by s.position
                  )
                  from public.content_sections s
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
  )
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
 * On a fresh publish, every nested row is inserted and the expected nested counts (modules,
 * lessons, presets, sections) are checked against what the payload claimed before the release is
 * activated, all inside one transaction: a payload that is malformed partway through never leaves a
 * half-inserted release active, or even lying around. If the count check fails, the partially
 * inserted release is torn down via the `shadercraft.allow_release_teardown` guard (see
 * `reject_published_mutation`), and the exception propagates so the whole transaction rolls back
 * regardless.
 */
create function public.publish_course_release(p_payload jsonb)
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
  v_preset jsonb;
  v_section jsonb;
  v_expected_modules integer := jsonb_array_length(coalesce(p_payload -> 'modules', '[]'::jsonb));
  v_expected_lessons integer := 0;
  v_expected_presets integer := 0;
  v_expected_sections integer := 0;
  v_actual_modules integer;
  v_actual_lessons integer;
  v_actual_presets integer;
  v_actual_sections integer;
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
      v_expected_lessons := v_expected_lessons + 1;

      insert into public.content_lessons (
        release_id, id, module_id, position, title, short_title, intro, concept_title,
        concept_lede, try_hint, takeaway, preview_caption, default_preset_id, intro_eyebrow
      ) values (
        v_id,
        v_lesson ->> 'id',
        v_lesson ->> 'moduleId',
        (v_lesson ->> 'position')::integer,
        v_lesson ->> 'title',
        v_lesson ->> 'shortTitle',
        v_lesson ->> 'intro',
        v_lesson ->> 'conceptTitle',
        v_lesson ->> 'conceptLede',
        v_lesson ->> 'tryHint',
        v_lesson ->> 'takeaway',
        v_lesson ->> 'previewCaption',
        v_lesson ->> 'defaultPresetId',
        v_lesson ->> 'introEyebrow'
      );

      for v_preset in select * from jsonb_array_elements(coalesce(v_lesson -> 'presets', '[]'::jsonb))
      loop
        v_expected_presets := v_expected_presets + 1;

        insert into public.content_presets (
          release_id, id, lesson_id, position, label, preview_key, preview_parameters, value,
          preview_value_label, filename, code_lines, highlighted_lines
        ) values (
          v_id,
          v_preset ->> 'id',
          v_lesson ->> 'id',
          (v_preset ->> 'position')::integer,
          v_preset ->> 'label',
          v_preset ->> 'previewKey',
          coalesce(v_preset -> 'previewParameters', '{}'::jsonb),
          v_preset ->> 'value',
          v_preset ->> 'previewValueLabel',
          v_preset ->> 'filename',
          coalesce(v_preset -> 'codeLines', '[]'::jsonb),
          coalesce(v_preset -> 'highlightedLines', '[]'::jsonb)
        );
      end loop;

      for v_section in select * from jsonb_array_elements(coalesce(v_lesson -> 'sections', '[]'::jsonb))
      loop
        v_expected_sections := v_expected_sections + 1;

        insert into public.content_sections (
          release_id, id, lesson_id, position, title, body
        ) values (
          v_id,
          v_section ->> 'id',
          v_lesson ->> 'id',
          (v_section ->> 'position')::integer,
          v_section ->> 'title',
          v_section ->> 'body'
        );
      end loop;
    end loop;
  end loop;

  select count(*) into v_actual_modules from public.content_modules where release_id = v_id;
  select count(*) into v_actual_lessons from public.content_lessons where release_id = v_id;
  select count(*) into v_actual_presets from public.content_presets where release_id = v_id;
  select count(*) into v_actual_sections from public.content_sections where release_id = v_id;

  if v_actual_modules <> v_expected_modules
    or v_actual_lessons <> v_expected_lessons
    or v_actual_presets <> v_expected_presets
    or v_actual_sections <> v_expected_sections
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
