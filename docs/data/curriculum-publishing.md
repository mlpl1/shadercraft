# Publishing curriculum releases to Supabase

**Publishing is currently broken and must not be run.** `supabase/migrations/202608030002_curriculum_releases.sql:47-52`
still declares `content_lessons.concept_title`, `concept_lede`, `try_hint`, and `preview_caption`
`NOT NULL`. Those fields belonged to the retired preset-based lesson shape and have no equivalent
in the current stage-based `CourseLesson` (see `src/data/course/types.ts`), so any payload built
from current content omits them and `publish_course_release` fails its `NOT NULL` constraints. Do
not run `npm run content:publish` until a migration adds the stage schema
(`content_lesson_stages` or equivalent) and drops those retired `NOT NULL` columns. The bundled,
on-device curriculum described in
[`docs/data/local-curriculum.md`](local-curriculum.md) is unaffected — this only blocks the remote
path this document describes below.

This document covers the remote publishing layer on top of the local curriculum pipeline
described in [`docs/data/local-curriculum.md`](local-curriculum.md): how an authored, checksummed
release gets from `content/*.json` into the `content_releases` tables in Supabase, how a device
picks it up, what CI checks before and during a publish, and how to roll one back. Nothing here
changes authoring — version-controlled JSON under `content/` remains the only source of truth;
publishing only copies a release that already passed `content:build`/`content:check` into a second
place devices can read it from without an app-store update.

## The publishing contract

A published release, and every row nested under it (`content_modules`, `content_lessons`,
`content_presets`, `content_sections`), is **immutable** once it exists
(`supabase/migrations/202608030002_curriculum_releases.sql`). A trigger
(`reject_published_mutation`) rejects every `UPDATE` and `DELETE` against these tables outright,
except for one field: `content_releases.active`, which is how the currently-served release moves
from one id to another. There is no supported way to edit a published release's content — the
trigger's whole purpose is to make that structurally impossible, not just discouraged.

Publishing itself only happens through `publish_course_release(p_payload jsonb)`, a
`security definer` Postgres function restricted to the `service_role` JWT. Every other caller,
including a signed-in learner, gets `42501` (insufficient privilege) if it calls this function —
mobile clients never hold that credential, so the RPC is unreachable from the app. `service_role`
itself has no table-level write grant on the content tables (only `select`, to let the publisher
confirm a publish landed); it reaches them exclusively through this one RPC, which runs with the
function owner's privileges. Reads (`get_active_course_manifest`, `get_course_release`) are open to
`anon` and `authenticated`, because published curriculum is not per-user data.

`publish_course_release` behaves in one of three ways for a given release id:

- **Unseen id** — inserts the release and every nested row, verifies the inserted counts
  (modules/lessons/presets/sections) against counts derived independently from the payload's own
  JSON structure, and only then flips `active`: the previous active release is deactivated first
  (the schema's partial unique index allows at most one active row at a time), then the new one is
  activated. If the count check fails, the partially inserted release is torn down inside the same
  transaction and the whole call rolls back — nothing is left half-published.
- **Same id, same checksum** — a no-op that still activates the release and returns success. This
  makes a retried publish (e.g. after a network blip on the first attempt) safe to run again: if the
  first attempt actually landed, the second does nothing but confirm it.
- **Same id, different checksum** — refused with `23505` (unique violation). A release id names one
  immutable payload forever; this is what makes "correct a mistake" impossible without a new id (see
  [Rollback](#rollback-and-corrections) below).

## Authoring → generation → pull-request checks

1. Edit `content/module-*.json` as usual (see
   [`docs/data/local-curriculum.md`](local-curriculum.md) for the schema and constraints — preview
   keys, preview parameters, stable ids, planned vs. published modules all apply identically to a
   remotely published release, because publishing sends the exact same `CourseRelease` shape the
   bundled seed uses).
2. Run `npm run content:build`, commit the regenerated `assets/course/bundled-course.json`.
3. Open a pull request. `.github/workflows/content-check.yml` runs on any change under `content/**`,
   `scripts/content/**`, `src/data/course/**`, or the generated bundle:
   ```bash
   npm run content:check
   npm test -- --runInBand src/data/course scripts/content
   npx tsc --noEmit
   ```
   A publish is never triggered by this workflow or by merging — it only validates that the content
   is well-formed and that the tracked bundle matches it.

## Release id naming

A release id must match `^[a-z0-9]+(?:-[a-z0-9]+)*$` (enforced client-side by
`scripts/content/publish-course.ts` before any network call, so a malformed id never reaches
Supabase). The bundled release shipped in the app follows a `bundled-YYYY-MM-DD` convention (see
`scripts/content/build-course.ts`); a remotely published release can use any id matching the
pattern, but reusing the date-stamped convention (or a similar, sortable scheme) keeps `npx supabase
status` / Studio listings and support conversations legible. **Whatever the scheme, an id is
permanent the moment it is published** — see [Rollback](#rollback-and-corrections).

## Manual approval and publishing

`.github/workflows/publish-course.yml` is `workflow_dispatch`-only, with a required `release_id`
input. There is no automatic trigger — nothing about merging to `main`, tagging a release, or
editing `content/*.json` publishes anything on its own. To publish:

1. From the Actions tab, run "Publish course release" with the release id to publish.
2. The job re-runs the same three content checks as the pull-request workflow (`content:check`, the
   content Jest suites, `tsc --noEmit`), because it can be triggered from any ref, not only one that
   already passed `content-check.yml`.
3. The job is bound to a protected `production-course` GitHub environment. Configuring that
   environment with required reviewers means a human has to approve the run *before* the job's
   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` environment secrets are ever read — GitHub's
   environment protection is the approval gate on the credential, not a script.
4. Once approved, the job runs:
   ```bash
   npm run content:publish -- --release "$RELEASE_ID"
   ```
   which loads the current authored `content/*.json` (the same `loadAuthoredModules` `content:build`
   uses), computes its checksum with `node:crypto`, validates the result against the same Zod schema
   the app uses, and calls `publish_course_release` with a `service_role` client.

Credential discipline this workflow depends on:

- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are ordinary GitHub Actions secrets, scoped to the
  `production-course` environment — never repository- or organization-wide, so no other workflow can
  read them.
- They are deliberately **not** named `EXPO_PUBLIC_*`. Only `EXPO_PUBLIC_*` variables are inlined
  into the Expo app bundle at build time; anything else named differently can never end up shipped to
  a device by accident.
- The publish step never echoes, logs, or otherwise prints `SUPABASE_SERVICE_ROLE_KEY`. GitHub's own
  secret redaction is a second line of defense, not the guarantee — the workflow simply never writes
  it anywhere.
- Mobile clients are configured with only the public Supabase URL and the **publishable** key (see
  [`docs/data/progress-sync.md`](progress-sync.md)); the service-role key never appears in
  `.env.local`, `app.config`, or any `EXPO_PUBLIC_*` variable.

## Compatibility rules a publish is checked against

`publish_course_release` validates structure and immutability; it does not know anything about which
app versions can read a release. That is entirely the installed app's decision, made by
`CourseSyncEngine` (`src/data/sync/course-sync-engine.ts`) from two fields every release carries:

- `schemaVersion` — the one content schema version the installed app can parse
  (`SUPPORTED_CONTENT_SCHEMA_VERSION`, currently `1`, enforced by `parseCourseRelease`'s
  `z.literal(1)`). A manifest advertising a newer schema version than the app supports is reported as
  `requires-app-update` before any payload is downloaded.
- `minimumAppVersion` — compared numerically (not lexically) against the running app's version
  (`Constants.expoConfig?.version`). A build with no stated version, or one whose version cannot be
  parsed as strict `x.y.z`, is treated exactly like a build that is too old — the safer assumption,
  since guessing wrong risks installing curriculum the app cannot render, while refusing just means
  the device keeps its current, working release.

Neither check costs a payload download: both are decided from the lightweight manifest
(`get_active_course_manifest`) before `get_course_release` is ever called.

### Current limitation: nothing tells a learner about `requires-app-update`

`CourseSyncEngine` computes `requires-app-update` and `CourseSyncScheduler`/`sync-context.tsx` hold
it in `courseUpdate.requiredAppVersion`, but **no screen currently reads or renders it**. A learner
on a build too old for the active published release gets no message; the sync check simply finds
itself unable to install and the device keeps running its current release, exactly as it would for
any other sync failure. This is a real, present gap — not a hypothetical — and should be treated as
one when deciding whether a release's `minimumAppVersion` is safe to raise: raising it currently
means older builds silently stop receiving remote content updates rather than being told to upgrade.

### Current behavior: an app update's own bundled release can outrun a stale remote one — while offline

`ReleaseInstaller.stageAndActivate` (`src/data/course/release-installer.ts`) only skips activating
an already-*installed* release under the `only-when-none-active` policy the bundled seed uses. A
**new** bundled release id — the ordinary result of an app update that ships newer bundled content —
has never been installed on that device before, so it is inserted and activated unconditionally on
the very next cold start, even if the device's active release right before the update was a newer
one downloaded remotely.

For a device that is online at that next startup, this self-corrects within seconds:
`CourseSyncEngine`'s background check compares the newly bundled release against the still-published
remote manifest, and since they differ it downloads and reactivates the remote release again. But a
learner who updates the app and then **stays offline** is stranded on the older bundled curriculum
indefinitely — there is no local signal that a newer release exists, and nothing retries until the
device is online again. No progress is lost either way: progress is keyed by lesson id, which is
stable across releases (see [Stable IDs](local-curriculum.md#stable-ids)), so a lesson completed
under the remote release still reads as complete under the bundled one and vice versa.

## Inspecting a checksum

To confirm what is actually published before or after a run, `npx supabase status` prints
`STUDIO_URL` for the local stack; a deployed project's Studio works the same way. The table editor on
`content_releases` shows `id`, `checksum`, `active`, and `published_at` directly. To compare a
release's checksum against the currently authored content without publishing anything:

```bash
npm run content:build   # regenerates assets/course/bundled-course.json
```

and read its `"checksum"` field — `scripts/content/build-course.ts` and
`scripts/content/publish-course.ts` compute the checksum the same way
(`calculateNodeReleaseChecksum` over `releaseChecksumInput`), so the two are directly comparable. A
published release's checksum is also returned by `get_active_course_manifest`/`get_course_release`,
which any `anon` client can call.

## Rollback and corrections

Because published rows are immutable, there is no "edit a release" or "delete a release" operation
available to correct a mistake — the migration's triggers reject both, and `service_role` has no
write path around them. The only supported correction is to **publish a prior validated payload
under a new release id**:

1. Restore (or re-author) the known-good `content/*.json` state.
2. Run `npm run content:build` / `npm run content:check` to confirm it is exactly what was published
   before.
3. Give it a new release id — the previous one stays published, inactive, and untouched.
4. Run the publish workflow with that new id. `publish_course_release` activates it, deactivating
   whatever was active (including the mistaken release), atomically.

Every device that already downloaded the mistaken release keeps it installed (immutability applies
on the server; nothing forces a device to delete anything), but the next successful background sync
activates the rollback release the same way it would activate any other update — see
[`docs/data/local-curriculum.md`](local-curriculum.md) and `CourseSyncEngine` for exactly how a
device decides a release is current.

## Further reading

- [`docs/data/local-curriculum.md`](local-curriculum.md) — authoring source of truth, the
  `content:build`/`content:check` workflow, schema constraints, and release id/checksum rules for
  the bundled seed.
- [`docs/data/progress-sync.md`](progress-sync.md) — the local Supabase stack, RLS, and credential
  discipline this document borrows its conventions from.
- `supabase/migrations/202608030002_curriculum_releases.sql` — the tables, triggers, RLS policies,
  and RPCs this document describes.
- `scripts/content/publish-course.ts` — the CLI the publish workflow runs.
- `src/data/sync/course-sync-engine.ts` — the device-side compatibility and activation decision.
