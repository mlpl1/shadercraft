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

select plan(46);

-- A minimal, schema-valid release payload. Matches `CourseRelease` in
-- src/data/course/types.ts / schema.ts: camelCase keys, release -> modules -> lessons -> stages.
--
-- Deliberately omits the two optional fields (`tryThis` on the lesson, `helpers` on the stage) so
-- the null-stripping assertions below have something absent to check. The multi fixture supplies
-- both.
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
            'takeaway', 'takeaway',
            'stages', jsonb_build_array(
              jsonb_build_object(
                'id', 'flat-colour',
                'position', 1,
                'title', 'One colour',
                'body', 'body',
                'source', 'fragColor = vec4(1.0, 0.0, 0.0, 1.0);'
              )
            )
          )
        )
      )
    )
  );
$$;

-- Two lessons in one module, with two stages and one stage respectively — deliberately not the same
-- count per lesson, so a stage-counting regression that summed per-lesson and multiplied, or that
-- only ever looked at the first lesson, would not accidentally agree. The second lesson carries
-- `tryThis`, and its stage carries `helpers`, so both optional fields have a present case.
create or replace function pg_temp.fixture_payload_multi(p_id text, p_checksum text)
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
            'takeaway', 'takeaway',
            'stages', jsonb_build_array(
              jsonb_build_object(
                'id', 'flat-colour',
                'position', 1,
                'title', 'One colour',
                'body', 'body',
                'source', 'fragColor = vec4(1.0, 0.0, 0.0, 1.0);'
              ),
              jsonb_build_object(
                'id', 'ramp',
                'position', 2,
                'title', 'A ramp',
                'body', 'body',
                'source', 'fragColor = vec4(vec3(uv.x), 1.0);'
              )
            )
          ),
          jsonb_build_object(
            'id', 'noise',
            'moduleId', 'colors',
            'position', 2,
            'title', 'Noise',
            'shortTitle', 'Noise',
            'intro', 'intro',
            'takeaway', 'takeaway',
            'tryThis', 'Change the multiplier.',
            'stages', jsonb_build_array(
              jsonb_build_object(
                'id', 'hashed',
                'position', 1,
                'title', 'A hash',
                'body', 'body',
                'source', 'fragColor = vec4(vec3(hash(uv)), 1.0);',
                'helpers', 'float hash(vec2 p) {' || chr(10) || '  return fract(sin(p.x) * 43758.5453);' || chr(10) || '}'
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
select has_table('public', 'content_stages', 'content_stages exists');

-- The retired shape is gone rather than merely unused: leaving these behind would let a stale
-- publisher keep writing rows nothing reads.
select hasnt_table('public', 'content_presets', 'content_presets is gone');
select hasnt_table('public', 'content_sections', 'content_sections is gone');

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
select ok(
  (select relrowsecurity from pg_class where oid = 'public.content_stages'::regclass),
  'row level security is enabled on content_stages'
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
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-auth', repeat('b', 64))) $q$,
  '42501',
  null,
  'an authenticated learner cannot publish a release'
);

reset role;

-- Publish as the service role, the only accepted caller.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-a', repeat('c', 64))) $q$,
  'service_role can publish a release'
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
  (select count(*) from public.content_stages where release_id = 'release-a')::int,
  1,
  'publishing inserts the stage row'
);
select is(
  (select source from public.content_stages where release_id = 'release-a' and id = 'flat-colour'),
  'fragColor = vec4(1.0, 0.0, 0.0, 1.0);',
  'a stage stores its runnable source verbatim'
);
select is(
  (select active from public.content_releases where id = 'release-a'),
  true,
  'a freshly published release becomes active'
);

-- Idempotent republish with the same checksum.
select lives_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-a', repeat('c', 64))) $q$,
  'republishing an identical release is a no-op rather than an error'
);
select is(
  (select count(*) from public.content_stages where release_id = 'release-a')::int,
  1,
  'republishing does not duplicate child rows'
);

-- Republish with a different checksum fails.
select throws_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload('release-a', repeat('d', 64))) $q$,
  '23505',
  null,
  'republishing an id with a different checksum is refused'
);

-- A release with two lessons carrying two stages and one stage exercises the nested-row count check
-- with something more than "one of everything". A regression that decoupled the expected/actual
-- derivation incorrectly would show up here first.
select lives_ok(
  $q$ select public.publish_course_release(pg_temp.fixture_payload_multi('release-multi', repeat('e', 64))) $q$,
  'service_role can publish a release with multiple lessons and uneven stage counts'
);
select is(
  (select count(*) from public.content_lessons where release_id = 'release-multi')::int,
  2,
  'publishing a multi-lesson release inserts every lesson row'
);
select is(
  (select count(*) from public.content_stages where release_id = 'release-multi')::int,
  3,
  'publishing a multi-lesson release inserts every stage row across both lessons'
);
select is(
  (select active from public.content_releases where id = 'release-a'),
  false,
  'publishing a newer release deactivates the previous one'
);
select is(
  (select count(*) from public.content_releases where id = 'release-a')::int,
  1,
  'release A''s row survives deactivation'
);

select is(
  (select helpers from public.content_stages where release_id = 'release-multi' and id = 'hashed'),
  'float hash(vec2 p) {' || chr(10) || '  return fract(sin(p.x) * 43758.5453);' || chr(10) || '}',
  'a stage stores multi-line helpers verbatim, newlines included'
);
select is(
  (select helpers from public.content_stages where release_id = 'release-multi' and id = 'flat-colour'),
  null,
  'a stage that declares no helpers stores NULL rather than an empty string'
);

reset role;

-- Public reads of the active manifest and payload.
select results_eq(
  $q$ select id from public.get_active_course_manifest() $q$,
  $q$ values ('release-multi'::text) $q$,
  'anon can read the active manifest and it names the active release'
);

select ok(
  (select public.get_course_release('release-multi') -> 'modules') is not null,
  'anon can read the active release payload'
);

-- Ordering is part of the contract: the client renders stages in array order and does not re-sort.
select is(
  (public.get_course_release('release-multi')
    -> 'modules' -> 0 -> 'lessons' -> 0 -> 'stages' -> 1 ->> 'id'),
  'ramp',
  'stages come back ordered by position'
);

select is(
  (public.get_course_release('release-multi')
    -> 'modules' -> 0 -> 'lessons' -> 1 -> 'stages' -> 0 ->> 'helpers'),
  'float hash(vec2 p) {' || chr(10) || '  return fract(sin(p.x) * 43758.5453);' || chr(10) || '}',
  'helpers survive the round trip through the payload'
);

select is(
  (public.get_course_release('release-multi') -> 'modules' -> 0 -> 'lessons' -> 1 ->> 'tryThis'),
  'Change the multiplier.',
  'a present tryThis survives the round trip'
);

-- `parseCourseRelease` uses `.strict()` schemas with `z.string().optional()`, which accepts a
-- missing key but throws on an explicit JSON null. The RPC must therefore omit absent optional
-- fields entirely rather than emit them as null, which `jsonb_strip_nulls` is responsible for.
select ok(
  not ((public.get_course_release('release-multi')
    -> 'modules' -> 0 -> 'lessons' -> 0) ? 'tryThis'),
  'an absent tryThis is omitted from the payload rather than emitted as null'
);
select ok(
  not ((public.get_course_release('release-multi')
    -> 'modules' -> 0 -> 'lessons' -> 0 -> 'stages' -> 0) ? 'helpers'),
  'an absent helpers is omitted from the payload rather than emitted as null'
);
select ok(
  (public.get_course_release('release-multi')
    -> 'modules' -> 0 -> 'lessons' -> 0 -> 'stages' -> 0) ? 'source',
  'a stage always carries its source, which is never optional'
);

-- Direct mutation of published content is rejected for every table, not just content_releases, and
-- for both an authenticated learner and the service_role credential — service_role publishes through
-- the RPC, but is not itself exempt from the immutability trigger on a raw table statement.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $q$ update public.content_releases set checksum = repeat('d', 64) where id = 'release-multi' $q$,
  '42501',
  null,
  'an authenticated user cannot update a published release row'
);

select throws_ok(
  $q$ delete from public.content_releases where id = 'release-multi' $q$,
  '42501',
  null,
  'an authenticated user cannot delete a published release row'
);

select throws_ok(
  $q$ update public.content_modules set title = 'HACKED' where release_id = 'release-multi' $q$,
  '42501',
  null,
  'an authenticated user cannot update a published module row'
);

select throws_ok(
  $q$ delete from public.content_modules where release_id = 'release-multi' $q$,
  '42501',
  null,
  'an authenticated user cannot delete a published module row'
);

reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $q$ update public.content_modules set title = 'HACKED' where release_id = 'release-multi' $q$,
  '42501',
  null,
  'service_role cannot update a published module row outside publish_course_release'
);

select throws_ok(
  $q$ delete from public.content_modules where release_id = 'release-multi' $q$,
  '42501',
  null,
  'service_role cannot delete a published module row outside publish_course_release'
);

-- Stages are covered by the same trigger, which is worth asserting separately because it is the one
-- table this migration introduced and a missing trigger there would be invisible above.
select throws_ok(
  $q$ update public.content_stages set source = 'HACKED' where release_id = 'release-multi' $q$,
  '42501',
  null,
  'service_role cannot update a published stage row outside publish_course_release'
);

select throws_ok(
  $q$ delete from public.content_stages where release_id = 'release-multi' $q$,
  '42501',
  null,
  'service_role cannot delete a published stage row outside publish_course_release'
);

reset role;

select * from finish();

rollback;
