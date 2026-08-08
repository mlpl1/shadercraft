-- Adds tutorials to the published curriculum release.
--
-- Tutorials ride inside the same `CourseRelease` payload as lessons rather than getting a release
-- and checksum of their own: an exercise is only unlocked by completing its module, so the two are
-- versioned together by definition, and one publish path is one thing to keep correct.
--
-- Without this migration the failure would be silent rather than loud. `publish_course_release`
-- ignores payload keys it does not read, so a release carrying tutorials would publish, report
-- success, and arrive on a device with every exercise missing. The nested-count check would not
-- catch it either, because it only counted what the insert loop already wrote. Extending both is the
-- point of this file.

create table public.content_tutorials (
  release_id text not null references public.content_releases (id) on delete cascade,
  id text not null,
  module_id text not null,
  position integer not null,
  title text not null,
  summary text not null,
  primary key (release_id, id),
  foreign key (release_id, module_id) references public.content_modules (release_id, id) on delete cascade
);

-- `solution_source` is both the answer and the reference image: the same text compiles the target
-- render the learner compares against and the code the Reveal control shows them, so the two can
-- never disagree. `helpers` and `hint` are optional and nullable, matching the device schema.
create table public.content_tutorial_steps (
  release_id text not null references public.content_releases (id) on delete cascade,
  id text not null,
  tutorial_id text not null,
  position integer not null,
  title text not null,
  brief text not null,
  starter_source text not null,
  solution_source text not null,
  helpers text,
  hint text,
  primary key (release_id, id),
  foreign key (release_id, tutorial_id) references public.content_tutorials (release_id, id) on delete cascade
);

-- Same immutability rule as every other content table: no update, no delete, except through the
-- session-local teardown guard `publish_course_release` uses to roll back its own partial insert.
create trigger content_tutorials_immutable
  before update or delete on public.content_tutorials
  for each row execute function public.reject_published_mutation();

create trigger content_tutorial_steps_immutable
  before update or delete on public.content_tutorial_steps
  for each row execute function public.reject_published_mutation();

alter table public.content_tutorials enable row level security;
alter table public.content_tutorial_steps enable row level security;

create policy content_tutorials_select_all
  on public.content_tutorials for select to anon, authenticated using (true);
create policy content_tutorial_steps_select_all
  on public.content_tutorial_steps for select to anon, authenticated using (true);

revoke all on public.content_tutorials, public.content_tutorial_steps from anon, authenticated;
grant select on public.content_tutorials, public.content_tutorial_steps to anon, authenticated;
grant select on public.content_tutorials, public.content_tutorial_steps to service_role;

/**
 * Reassembles one published release as a `CourseRelease`-shaped JSONB document. Unchanged from the
 * previous migration except that a module now also carries its `tutorials`.
 *
 * `tutorials` is emitted as SQL NULL rather than an empty array when a module has none, so
 * `jsonb_strip_nulls` drops the key entirely. That is deliberate and matches the authored shape:
 * `parseCourseRelease` rejects an empty tutorial list precisely so "no exercises" has exactly one
 * representation. Lessons differ — a module always has a `lessons` key, empty for planned modules —
 * which is why only this one uses a null-when-absent aggregate.
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
          ), '[]'::jsonb),
          'tutorials', (
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'moduleId', t.module_id,
                'position', t.position,
                'title', t.title,
                'summary', t.summary,
                'steps', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', ts.id,
                      'position', ts.position,
                      'title', ts.title,
                      'brief', ts.brief,
                      'starterSource', ts.starter_source,
                      'solutionSource', ts.solution_source,
                      'helpers', ts.helpers,
                      'hint', ts.hint
                    ) order by ts.position
                  )
                  from public.content_tutorial_steps ts
                  where ts.release_id = r.id and ts.tutorial_id = t.id
                ), '[]'::jsonb)
              ) order by t.position
            )
            from public.content_tutorials t
            where t.release_id = r.id and t.module_id = m.id
          )
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
 * Publishes one immutable curriculum release. Unchanged from the previous migration except that
 * tutorials and their steps are inserted, and both are counted.
 *
 * The counts matter more here than anywhere else in this function. Tutorials are optional per
 * module, so a payload that carries none is legitimate and a payload that carries some must not
 * silently lose them — and "silently" is exactly what would happen without a count, since the insert
 * loop skips a missing `tutorials` key without complaint. As everywhere else, the expected counts
 * are derived from the payload's own JSON structure rather than tallied inside the insert loop, so
 * the two numbers can genuinely disagree.
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
  v_tutorial jsonb;
  v_step jsonb;
  v_expected_modules integer := jsonb_array_length(coalesce(p_payload -> 'modules', '[]'::jsonb));
  v_expected_lessons integer;
  v_expected_stages integer;
  v_expected_tutorials integer;
  v_expected_steps integer;
  v_actual_modules integer;
  v_actual_lessons integer;
  v_actual_stages integer;
  v_actual_tutorials integer;
  v_actual_steps integer;
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
  -- again — in particular, never incremented from inside the insert loop below.
  select coalesce(sum(jsonb_array_length(coalesce(module -> 'lessons', '[]'::jsonb))), 0)
    into v_expected_lessons
    from jsonb_array_elements(coalesce(p_payload -> 'modules', '[]'::jsonb)) as module;

  select coalesce(sum(jsonb_array_length(coalesce(lesson -> 'stages', '[]'::jsonb))), 0)
    into v_expected_stages
    from jsonb_array_elements(coalesce(p_payload -> 'modules', '[]'::jsonb)) as module,
         jsonb_array_elements(coalesce(module -> 'lessons', '[]'::jsonb)) as lesson;

  select coalesce(sum(jsonb_array_length(coalesce(module -> 'tutorials', '[]'::jsonb))), 0)
    into v_expected_tutorials
    from jsonb_array_elements(coalesce(p_payload -> 'modules', '[]'::jsonb)) as module;

  select coalesce(sum(jsonb_array_length(coalesce(tutorial -> 'steps', '[]'::jsonb))), 0)
    into v_expected_steps
    from jsonb_array_elements(coalesce(p_payload -> 'modules', '[]'::jsonb)) as module,
         jsonb_array_elements(coalesce(module -> 'tutorials', '[]'::jsonb)) as tutorial;

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

    for v_tutorial in
      select * from jsonb_array_elements(coalesce(v_module -> 'tutorials', '[]'::jsonb))
    loop
      insert into public.content_tutorials (
        release_id, id, module_id, position, title, summary
      ) values (
        v_id,
        v_tutorial ->> 'id',
        v_tutorial ->> 'moduleId',
        (v_tutorial ->> 'position')::integer,
        v_tutorial ->> 'title',
        v_tutorial ->> 'summary'
      );

      for v_step in select * from jsonb_array_elements(coalesce(v_tutorial -> 'steps', '[]'::jsonb))
      loop
        insert into public.content_tutorial_steps (
          release_id, id, tutorial_id, position, title, brief, starter_source, solution_source,
          helpers, hint
        ) values (
          v_id,
          v_step ->> 'id',
          v_tutorial ->> 'id',
          (v_step ->> 'position')::integer,
          v_step ->> 'title',
          v_step ->> 'brief',
          v_step ->> 'starterSource',
          v_step ->> 'solutionSource',
          v_step ->> 'helpers',
          v_step ->> 'hint'
        );
      end loop;
    end loop;
  end loop;

  select count(*) into v_actual_modules from public.content_modules where release_id = v_id;
  select count(*) into v_actual_lessons from public.content_lessons where release_id = v_id;
  select count(*) into v_actual_stages from public.content_stages where release_id = v_id;
  select count(*) into v_actual_tutorials from public.content_tutorials where release_id = v_id;
  select count(*) into v_actual_steps from public.content_tutorial_steps where release_id = v_id;

  if v_actual_modules <> v_expected_modules
    or v_actual_lessons <> v_expected_lessons
    or v_actual_stages <> v_expected_stages
    or v_actual_tutorials <> v_expected_tutorials
    or v_actual_steps <> v_expected_steps
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
