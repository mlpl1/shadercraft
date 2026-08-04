-- Contract tests for immutable curriculum releases.
--
-- Publishing happens only through `publish_course_release`, which is restricted to the
-- `service_role` JWT (the publishing tool / CI credential). Everyone else, including signed-in
-- learners, only ever reads. Role simulation mirrors PostgREST: switch `role` and set
-- `request.jwt.claims` locally, which is what the JWT-role checks below read from.
--
-- Runs inside a transaction that is rolled back, so every fixture release disappears afterwards.

begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

-- A minimal, schema-valid release payload. Matches `CourseRelease` in
-- src/data/course/types.ts / schema.ts: camelCase keys, release -> modules -> lessons ->
-- (presets, sections).
create or replace function pg_temp.fixture_payload(p_id text, p_checksum text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'id', p_id,
    'schemaVersion', 1,
    'minimumAppVersion', '1.0.0',
    'checksum', p_checksum,
    'modules', jsonb_build_array(
      jsonb_build_object(
        'id', 'colors',
        'position', 1,
        'status', 'published',
        'title', 'Colors',
        'description', 'Intro to color.',
        'plannedLessonCount', 0,
        'plannedTopics', jsonb_build_array(),
        'lessons', jsonb_build_array(
          jsonb_build_object(
            'id', 'fragment-output',
            'moduleId', 'colors',
            'position', 1,
            'title', 'Fragment output',
            'shortTitle', 'Fragment',
            'intro', 'intro',
            'conceptTitle', 'concept',
            'conceptLede', 'lede',
            'tryHint', 'hint',
            'takeaway', 'takeaway',
            'previewCaption', 'caption',
            'presets', jsonb_build_array(
              jsonb_build_object(
                'id', 'basic',
                'position', 1,
                'label', 'Basic',
                'previewKey', 'solid-color',
                'previewParameters', jsonb_build_object(),
                'value', 'red',
                'filename', 'main.glsl',
                'codeLines', jsonb_build_array('line one'),
                'highlightedLines', jsonb_build_array(1)
              )
            ),
            'sections', jsonb_build_array(
              jsonb_build_object(
                'id', 'section-one',
                'position', 1,
                'title', 'Section',
                'body', 'body'
              )
            )
          )
        )
      )
    )
  );
$$;

-- Shape of the contract.
select has_table('public', 'content_releases', 'content_releases exists');
select has_table('public', 'content_modules', 'content_modules exists');
select has_table('public', 'content_lessons', 'content_lessons exists');
select has_table('public', 'content_presets', 'content_presets exists');
select has_table('public', 'content_sections', 'content_sections exists');

select has_function(
  'public', 'get_active_course_manifest', array[]::text[],
  'get_active_course_manifest exists'
);
select has_function(
  'public', 'get_course_release', array['text'],
  'get_course_release exists'
);
select has_function(
  'public', 'publish_course_release', array['jsonb'],
  'publish_course_release exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.content_releases'::regclass),
  'row level security is enabled on content_releases'
);

-- Public clients cannot publish, even as a signed-in learner.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-anon', repeat('a', 64))) $q$,
  '42501',
  null,
  'anon cannot publish a release'
);

reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-auth', repeat('a', 64))) $q$,
  '42501',
  null,
  'an authenticated learner cannot publish a release'
);

reset role;

-- Publish as the service role, the only accepted caller.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-a', repeat('a', 64))) $q$,
  'service_role can publish a valid release'
);

select is(
  (select count(*) from public.content_releases where id = 'release-a')::int,
  1,
  'publishing inserts the release row'
);
select is(
  (select count(*) from public.content_modules where release_id = 'release-a')::int,
  1,
  'publishing inserts the module row'
);
select is(
  (select count(*) from public.content_lessons where release_id = 'release-a')::int,
  1,
  'publishing inserts the lesson row'
);
select is(
  (select count(*) from public.content_presets where release_id = 'release-a')::int,
  1,
  'publishing inserts the preset row'
);
select is(
  (select count(*) from public.content_sections where release_id = 'release-a')::int,
  1,
  'publishing inserts the section row'
);
select is(
  (select active from public.content_releases where id = 'release-a'),
  true,
  'publishing a release activates it transactionally'
);

-- Idempotent republish with the same checksum.
select lives_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-a', repeat('a', 64))) $q$,
  'republishing the same release id with the same checksum is idempotent'
);
select is(
  (select count(*) from public.content_releases where id = 'release-a')::int,
  1,
  'idempotent republish does not duplicate the release row'
);

-- Republish with a different checksum fails.
select throws_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-a', repeat('b', 64))) $q$,
  null,
  null,
  'republishing the same release id with a different checksum fails'
);

-- Publish release B and confirm activation flips atomically.
select lives_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-b', repeat('c', 64))) $q$,
  'service_role can publish a second release'
);

select is(
  (select active from public.content_releases where id = 'release-a'),
  false,
  'activating release B deactivates release A'
);
select is(
  (select active from public.content_releases where id = 'release-b'),
  true,
  'activating release B makes B active'
);
select is(
  (select count(*) from public.content_releases where id = 'release-a')::int,
  1,
  'release A''s row survives deactivation'
);

reset role;

-- Public reads of the active manifest and payload.
select results_eq(
  $q$ select id from public.get_active_course_manifest() $q$,
  $q$ values ('release-b'::text) $q$,
  'anon can read the active manifest and it names the active release'
);

select ok(
  (select public.get_course_release('release-b') -> 'modules') is not null,
  'anon can read the active release payload'
);

-- Direct mutation of published content is rejected, including for an authenticated user.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $q$ update public.content_releases set checksum = repeat('d', 64) where id = 'release-b' $q$,
  '42501',
  null,
  'an authenticated user cannot update a published release row'
);

select throws_ok(
  $q$ delete from public.content_releases where id = 'release-b' $q$,
  '42501',
  null,
  'an authenticated user cannot delete a published release row'
);

select * from finish();

rollback;
