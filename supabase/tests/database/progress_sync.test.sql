-- Contract tests for the revisioned progress store.
--
-- These run inside a transaction that is rolled back, so the two fixture users and every row they
-- create disappear afterwards. Authentication is simulated the way PostgREST does it: switch to the
-- `authenticated` role and set `request.jwt.claims` locally, which is what `auth.uid()` reads.

begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

-- Fixture users. Created as the superuser, before dropping into the authenticated role.
insert into auth.users (id, instance_id, aud, role, email)
values
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'learner-one@shadercraft.test'
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'learner-two@shadercraft.test'
  );

-- Progress that belongs to the *other* user, seeded before RLS applies, so the isolation checks
-- below have something they must not be able to see or touch.
insert into public.lesson_progress (user_id, lesson_id, completed, revision)
values ('00000000-0000-0000-0000-000000000002', 'colors-fragment-output', true, 1);

-- Shape of the contract.
select has_table('public', 'lesson_progress', 'lesson_progress exists');
select has_table('public', 'progress_mutations', 'progress_mutations exists');
select has_function(
  'public',
  'apply_progress_mutation',
  array['uuid', 'text', 'boolean', 'bigint'],
  'apply_progress_mutation exists with the agreed signature'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.lesson_progress'::regclass),
  'row level security is enabled on lesson_progress'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.progress_mutations'::regclass),
  'row level security is enabled on progress_mutations'
);

-- Become learner one.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

-- Isolation: another learner's progress is invisible, and cannot be written to directly.
select is(
  (select count(*) from public.lesson_progress)::bigint,
  0::bigint,
  'a learner sees none of another learner''s progress'
);

select throws_ok(
  $q$ insert into public.lesson_progress (user_id, lesson_id, completed, revision)
      values ('00000000-0000-0000-0000-000000000002', 'uniforms-time', true, 1) $q$,
  '42501',
  null,
  'a learner cannot insert progress for another user id'
);

select throws_ok(
  $q$ update public.lesson_progress set completed = false $q$,
  '42501',
  null,
  'a learner cannot update progress directly, only through the RPC'
);

-- First accepted mutation: a new row starts at revision 1.
select results_eq(
  $q$ select applied, conflict, completed, revision
        from public.apply_progress_mutation(
          'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
          'coordinate-systems-uv-space',
          true,
          0::bigint
        ) $q$,
  $q$ values (true, false, true, 1::bigint) $q$,
  'a first mutation is applied and lands on revision 1'
);

-- Replaying the same mutation id is idempotent: same outcome, no new revision.
select results_eq(
  $q$ select applied, conflict, completed, revision
        from public.apply_progress_mutation(
          'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
          'coordinate-systems-uv-space',
          true,
          0::bigint
        ) $q$,
  $q$ values (true, false, true, 1::bigint) $q$,
  'replaying a mutation id returns the recorded result rather than advancing'
);

select is(
  (select revision from public.lesson_progress
     where lesson_id = 'coordinate-systems-uv-space')::bigint,
  1::bigint,
  'a replayed mutation leaves the stored revision untouched'
);

-- A stale base revision is rejected and hands back the current server state.
select results_eq(
  $q$ select applied, conflict, completed, revision
        from public.apply_progress_mutation(
          'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
          'coordinate-systems-uv-space',
          false,
          0::bigint
        ) $q$,
  $q$ values (false, true, true, 1::bigint) $q$,
  'a stale base revision conflicts and reports the current state'
);

select is(
  (select completed from public.lesson_progress
     where lesson_id = 'coordinate-systems-uv-space'),
  true,
  'a conflicting mutation changes nothing'
);

-- Rebasing onto the returned revision is accepted and takes the next one.
select results_eq(
  $q$ select applied, conflict, completed, revision
        from public.apply_progress_mutation(
          'aaaaaaaa-0000-0000-0000-000000000003'::uuid,
          'coordinate-systems-uv-space',
          false,
          1::bigint
        ) $q$,
  $q$ values (true, false, false, 2::bigint) $q$,
  'a mutation rebased onto the current revision is accepted as the next one'
);

select * from finish();

rollback;
