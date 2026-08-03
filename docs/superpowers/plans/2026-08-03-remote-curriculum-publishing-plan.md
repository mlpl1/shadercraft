# Remote Curriculum Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish immutable, source-controlled curriculum releases to Supabase and activate compatible releases atomically in the local SQLite database without requiring an app-store release.

**Architecture:** The existing validated module JSON remains the authoring source. A service-role publishing command canonicalizes and uploads one complete release through a transactional Supabase RPC. The mobile app fetches a small manifest, validates and checksums the full payload, stages it in SQLite, then switches the active release in one transaction.

**Tech Stack:** Expo SDK 57, Expo SQLite, Expo Crypto, Supabase Postgres/RLS/RPCs, Supabase JavaScript client, Zod curriculum schema, `tsx` publishing tools, GitHub Actions.

## Global Constraints

- Complete the Local SQLite Curriculum and Supabase Progress Sync plans first.
- Version-controlled JSON remains the only authoring source.
- Published releases are immutable; corrections create new release IDs.
- The service-role credential is accepted only by publishing tools and CI.
- Mobile clients receive only the public Supabase URL and publishable key.
- Unknown preview keys, invalid highlights, checksum mismatches, and incompatible versions prevent activation.
- The previous active SQLite release remains available through every failure.
- Remote content cannot add arbitrary executable GLSL behavior.
- Every task ends in a focused commit and leaves the app usable offline.

---

## File Structure

- `supabase/migrations/202608030002_curriculum_releases.sql` — immutable release tables, RLS, manifest/read RPCs, and transactional publish RPC.
- `supabase/tests/database/curriculum_releases.test.sql` — release immutability, visibility, and activation tests.
- `src/data/course/canonicalize.ts` — deterministic canonical JSON and checksum input.
- `scripts/content/node-checksum.ts` — Node SHA-256 implementation for build and publishing tools.
- `scripts/content/publish-course.ts` — validated service-role publisher.
- `src/data/sync/course-remote.ts` — remote manifest/release protocol.
- `src/data/sync/supabase-course-remote.ts` — public Supabase implementation.
- `src/data/course/release-installer.ts` — staged SQLite insertion and atomic activation.
- `src/data/sync/course-sync-engine.ts` — compatibility, download, validation, and activation orchestration.
- `src/data/sync/course-sync-scheduler.ts` — startup/foreground/manual release checks.
- `.github/workflows/content-check.yml` — pull-request validation.
- `.github/workflows/publish-course.yml` — manually approved publishing workflow.

---

### Task 1: Add immutable curriculum releases to Supabase

**Files:**
- Create: `supabase/migrations/202608030002_curriculum_releases.sql`
- Create: `supabase/tests/database/curriculum_releases.test.sql`

**Interfaces:**
- Produces: curriculum tables, `get_active_course_manifest()`, `get_course_release(id)`,
  `publish_course_release(payload)`.
- Consumes: Supabase roles and the validated release shape from the local plan.

- [ ] **Step 1: Write failing database tests**

Verify:

- Anonymous/public clients can read the active published manifest and payload.
- Public clients cannot insert, update, delete, or activate releases.
- Publishing a valid release inserts every nested record and makes it active transactionally.
- Publishing a duplicate release ID with the same checksum is idempotent.
- Publishing a duplicate release ID with a different checksum fails.
- Activating release B deactivates A while preserving A's immutable rows.
- Direct updates/deletes of published content fail, including with an authenticated user token.

- [ ] **Step 2: Run the test and verify failure**

Run: `npx supabase test db`

Expected: FAIL because curriculum release tables and RPCs do not exist.

- [ ] **Step 3: Create release-scoped tables**

Implement the approved schema with these database requirements:

- `content_releases.id` is text primary key.
- `schema_version` is positive integer.
- `minimum_app_version` is non-empty text.
- `checksum` matches 64 lowercase hexadecimal characters.
- `published_at` is assigned by Postgres.
- `active` is boolean with a unique partial index permitting at most one active row.
- Modules, lessons, presets, and sections use `(release_id, id)` primary keys.
- Composite foreign keys include `release_id` and cascade only when deleting an unpublished failed
  release inside the publishing transaction.
- JSONB columns store planned topics, preview parameters, code lines, and highlighted lines.
- A trigger rejects deletion of a published release and rejects changes to its ID, schema version,
  minimum app version, checksum, publication time, or child records. The release's `active` flag is
  the only mutable publication field.

- [ ] **Step 4: Add read and publish RPCs**

`get_active_course_manifest()` returns exactly:

```sql
table (
  id text,
  schema_version integer,
  minimum_app_version text,
  checksum text,
  published_at timestamptz
)
```

`get_course_release(p_release_id text)` returns one nested JSONB payload matching `CourseRelease`.
It returns only a published release row.

`publish_course_release(p_payload jsonb)` rejects callers whose JWT role is not `service_role`,
inserts normalized rows, verifies expected nested counts, and switches `active` in the same
transaction. Revoke function execution from `anon` and `authenticated`.

- [ ] **Step 5: Add RLS**

Enable RLS on all curriculum tables. Public select policies allow rows belonging to published
releases. No public write policies exist.

- [ ] **Step 6: Verify the database contract**

Run:

```bash
npx supabase test db
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations supabase/tests
git commit -m "feat(content): store immutable curriculum releases in Supabase"
```

### Task 2: Share deterministic canonicalization and implement the publisher

**Files:**
- Create: `src/data/course/canonicalize.ts`
- Create: `src/data/course/__tests__/canonicalize.test.ts`
- Create: `scripts/content/node-checksum.ts`
- Create: `scripts/content/publish-course.ts`
- Create: `scripts/content/__tests__/publish-course.test.ts`
- Modify: `scripts/content/build-course.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `canonicalizeRelease(release)`, `releaseChecksumInput(release)`,
  `calculateNodeReleaseChecksum(release)`, and
  `npm run content:publish -- --release course-2026-08-03`.
- Consumes: authoring parser, Supabase publish RPC, service-role environment values.

- [ ] **Step 1: Write failing canonicalization tests**

Assert that object key insertion order does not change canonical output or checksum, array order does,
and the checksum field is excluded from its own checksum input.

```ts
expect(canonicalizeRelease(releaseA)).toBe(canonicalizeRelease(releaseB));
expect(calculateNodeReleaseChecksum(releaseA)).toMatch(/^[a-f0-9]{64}$/);
```

- [ ] **Step 2: Write failing publisher tests**

With a fake Supabase admin client, verify the publisher:

- Refuses missing `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`.
- Runs the existing content validation before network access.
- Refuses a release ID not matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- Sends exactly one `publish_course_release` RPC with the checksummed payload.
- Exits successfully when the server reports the same release already published.
- Never logs the service-role key.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
npm test -- --runInBand src/data/course/__tests__/canonicalize.test.ts
npm test -- --runInBand scripts/content/__tests__/publish-course.test.ts
```

Expected: FAIL because canonicalization and publisher do not exist.

- [ ] **Step 4: Implement one canonical serializer for build and publish**

Recursively sort object keys, preserve array order, normalize no semantic values, and serialize with
`JSON.stringify`. In Node publishing/build code, calculate SHA-256 with `node:crypto`. Export the
checksum input separately so mobile code can use the same bytes with Expo Crypto in Task 4.

Refactor `build-course.ts` to use this canonicalizer, proving the bundled release checksum does not
change from object construction order.

- [ ] **Step 5: Implement the service-role publisher**

Require:

```dotenv
SUPABASE_URL=https://project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_example_do_not_use
```

The command loads current authoring JSON, replaces the release ID with the explicit CLI argument,
recalculates the checksum, invokes the publish RPC, prints only release ID/checksum/counts, and exits
nonzero on validation or RPC failure.

Add:

```json
"content:publish": "tsx scripts/content/publish-course.ts"
```

- [ ] **Step 6: Verify**

Run:

```bash
npm run content:build
npm run content:check
npm test -- --runInBand src/data/course scripts/content
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/course scripts/content package.json assets/course/bundled-course.json
git commit -m "feat(content): publish validated checksummed course releases"
```

### Task 3: Add the public curriculum remote adapter

**Files:**
- Create: `src/data/sync/course-remote.ts`
- Create: `src/data/sync/supabase-course-remote.ts`
- Create: `src/data/sync/__tests__/supabase-course-remote.test.ts`

**Interfaces:**
- Produces: `CourseRemote`, `SupabaseCourseRemote`.
- Consumes: public Supabase client and `parseCourseRelease`.

- [ ] **Step 1: Write failing adapter tests**

Mock RPC responses and verify valid manifest/payload mapping, no-active-release, malformed manifest,
malformed payload, Supabase error, and unexpected multiple-row behavior.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/sync/__tests__/supabase-course-remote.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Define the protocol**

```ts
export type CourseReleaseManifest = {
  id: string;
  schemaVersion: number;
  minimumAppVersion: string;
  checksum: string;
  publishedAt: string;
};

export interface CourseRemote {
  getActiveManifest(): Promise<CourseReleaseManifest | null>;
  getRelease(releaseId: string): Promise<CourseRelease>;
}
```

- [ ] **Step 4: Implement strict RPC mapping**

Call `get_active_course_manifest` and `get_course_release`. Validate the full payload with
`parseCourseRelease` before returning it. A missing active manifest is a valid `null`; missing payload
for a manifest ID is a protocol failure.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --runInBand src/data/sync/__tests__/supabase-course-remote.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/sync
git commit -m "feat(content): read published curriculum releases from Supabase"
```

### Task 4: Stage and atomically activate downloaded SQLite releases

**Files:**
- Create: `src/data/course/release-installer.ts`
- Create: `src/data/course/__tests__/release-installer.test.ts`
- Modify: `src/data/database/seed.ts`
- Modify: `src/data/course/sqlite-course-repository.ts`

**Interfaces:**
- Produces: `ReleaseInstaller.stageAndActivate(release)` and `verifyReleaseChecksum(release)`.
- Consumes: canonical checksum input, Expo Crypto, existing bundled installer.

- [ ] **Step 1: Write failing release-installer tests**

Test:

- Same active release/checksum is a no-op.
- Same release ID/different checksum is rejected.
- Invalid highlighted lines or preview key are rejected before SQL writes.
- Simulated insert failure leaves the old active release ID unchanged.
- Successful install changes the active ID and notifies course subscribers once.
- Old release rows remain until explicit cleanup.
- Cleanup retains the bundled release, active release, and most recently active prior downloaded
  release while deleting older inactive downloaded releases.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/course/__tests__/release-installer.test.ts`

Expected: FAIL because remote release installation is absent.

- [ ] **Step 3: Implement mobile checksum verification**

Use the shared canonical checksum input and:

```ts
Crypto.digestStringAsync(
  Crypto.CryptoDigestAlgorithm.SHA256,
  canonicalReleaseWithoutChecksum,
);
```

Compare lowercase hexadecimal output with both payload and manifest checksums.

- [ ] **Step 4: Generalize installation**

Refactor bundled seed installation to call the same release installer. Validate before opening the
transaction. Inside one transaction, insert every release-scoped row and update
`app_metadata.active_release_id` last. Notify repository subscribers only after commit.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --runInBand src/data/course
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/course src/data/database/seed.ts
git commit -m "feat(content): activate downloaded course releases atomically"
```

### Task 5: Implement compatibility checks and background curriculum synchronization

**Files:**
- Create: `src/data/sync/course-sync-engine.ts`
- Create: `src/data/sync/course-sync-scheduler.ts`
- Create: `src/data/sync/__tests__/course-sync-engine.test.ts`
- Create: `src/data/sync/__tests__/course-sync-scheduler.test.ts`
- Modify: `src/context/sync-context.tsx`

**Interfaces:**
- Produces: `CourseSyncEngine.checkForUpdate()`, scheduled background checks.
- Consumes: `CourseRemote`, `ReleaseInstaller`, current app version and schema version.

- [ ] **Step 1: Write failing engine tests**

Cover:

- No remote active release.
- Manifest matches local ID/checksum.
- Manifest requires a higher content schema.
- Manifest requires a higher semantic app version.
- Downloaded payload ID/checksum differs from manifest.
- Unknown preview capability.
- Successful compatible activation.
- Progress percentage recalculates when the published lesson set changes.
- Transport/validation failure preserves the previous release.

- [ ] **Step 2: Write failing scheduler tests**

With fake timers, verify checks on ready startup, foreground after six hours, manual retry, and no
duplicate concurrent check. Failed checks use the existing bounded backoff and do not change
progress-sync status to blocking.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/sync/__tests__/course-sync*.test.ts`

Expected: FAIL because engine and scheduler are absent.

- [ ] **Step 4: Implement compatibility and activation flow**

Read the installed app version from `expo-constants`. Compare strict three-component semantic
versions numerically. Return one of:

```ts
type CourseSyncResult =
  | { kind: "current" }
  | { kind: "updated"; releaseId: string }
  | { kind: "requires-app-update"; minimumAppVersion: string }
  | { kind: "failed"; category: "network" | "protocol" | "validation" | "database" };
```

Never pass an incompatible payload to `ReleaseInstaller`.

- [ ] **Step 5: Integrate scheduling and UI refresh**

Run release checks after local database readiness, not before. On successful activation,
`CourseRepository` invalidation refreshes Course, Home, and an open lesson. If the current lesson was
removed, the lesson route resolves to the current unlocked lesson without crashing.

After activation succeeds, schedule inactive-release cleanup. Never run cleanup inside the
activation transaction and never delete the bundled release, active release, or most recently active
prior downloaded release.

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- --runInBand src/data/sync
npm test -- --runInBand src/data/course
npx tsc --noEmit
git diff --check
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/sync src/context/sync-context.tsx
git commit -m "feat(content): synchronize compatible course releases in background"
```

### Task 6: Add content CI, publishing operations, and acceptance verification

**Files:**
- Create: `.github/workflows/content-check.yml`
- Create: `.github/workflows/publish-course.yml`
- Modify: `README.md`
- Create: `docs/data/curriculum-publishing.md`

**Interfaces:**
- Consumes: content scripts, Supabase migrations, and all prior tasks.
- Produces: reviewed validation and manual release publishing workflow.

- [ ] **Step 1: Add pull-request content validation**

The workflow checks out the repository, installs the Node version from project requirements, runs
`npm ci`, then:

```bash
npm run content:check
npm test -- --runInBand src/data/course scripts/content
npx tsc --noEmit
```

Trigger it for changes under `content/**`, `scripts/content/**`, `src/data/course/**`, or the generated
bundle.

- [ ] **Step 2: Add manually approved publishing**

Use `workflow_dispatch` with required `release_id`. Read `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` from GitHub environment secrets, run the full content check, then:

```bash
npm run content:publish -- --release "$RELEASE_ID"
```

Bind the job to a protected `production-course` environment so GitHub approval gates the service
credential.

- [ ] **Step 3: Document publishing and rollback**

Document authoring, generation, pull-request checks, release ID naming, manual approval, checksum
inspection, compatibility rules, and rollback by re-publishing a prior validated payload under a new
release ID. Explicitly state that published rows are immutable.

- [ ] **Step 4: Run full automated verification**

Run:

```bash
npm run content:check
npm test -- --runInBand
npx supabase test db
npx tsc --noEmit
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Run release acceptance checks**

Against a non-production Supabase project:

1. Install and open the bundled release offline.
2. Publish a text-only compatible release and verify background atomic activation.
3. Interrupt a release download and verify the previous release remains active.
4. Publish a release with an unknown preview key and verify publishing validation rejects it.
5. Simulate a manifest requiring app version `999.0.0` and verify the client reports an app update
   without downloading or activating it.
6. Restore the compatible manifest and verify update succeeds after retry.
7. Relaunch in airplane mode and verify the downloaded release remains complete.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows README.md docs/data/curriculum-publishing.md
git commit -m "ci(content): validate and publish immutable course releases"
```
