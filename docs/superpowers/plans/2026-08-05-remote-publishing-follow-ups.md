# Remote Curriculum Publishing — Follow-Up Findings

Date: 2026-08-05
Source: final whole-branch review of `feat/remote-curriculum-publishing`

The remote curriculum publishing plan is complete: 8 commits, 423 Jest tests across 32 suites,
57 pgTAP assertions, `tsc` and `content:check` clean. The final review passed the branch as safe
to merge with no Critical findings. The items below were raised during review, triaged as
non-blocking, and deliberately deferred. They are recorded here because whole-branch analysis
found them and per-task review structurally could not.

Ordered by value.

## 1. Nothing surfaces `requires-app-update` to the learner

`CourseSyncEngine` computes `requires-app-update` and `sync-context.tsx` holds it in state, but no
screen renders it. A learner on a build older than a release's `minimumAppVersion` gets no
message — the update simply never applies, indistinguishable from "up to date".

Sharper than it first appears: `course-sync-engine.ts` also returns `requires-app-update` when the
running app version is unreadable (`Constants.expoConfig?.version` is `null`). So a build where
that value is missing silently stops accepting curriculum forever, and reports nothing. The
behaviour is conservative rather than destructive — no data is lost and no wrong content is
installed — which is why it ships. But it needs a quiet banner, and the unreadable-version case
deserves a distinct signal from the genuinely-too-old case.

## 2. `publish_course_release` never re-derives the checksum it stores

The RPC stores the client-supplied checksum verbatim and never recomputes it from its own
reassembly of the payload. The pgTAP suite asserts structure but never checksum identity, and the
publishing workflow never reads the release back.

The failure this permits: someone adds a field to the RPC's insert loop but forgets it in
`get_course_release`'s `jsonb_build_object`. Every device then re-hashes a payload that differs
from what was checksummed at publish time, rejects the release, and **every future update fails on
every device** — with all CI green, and fixable only by a new migration.

Verified correct as of this branch (the final review published the real 14-lesson curriculum to the
local stack and confirmed all four checksums identical). The fix is cheap: have
`scripts/content/publish-course.ts` read the release back through `get_course_release` after
publishing and assert the checksum still matches. Highest-value follow-up here.

## 3. The publisher hardcodes `minimumAppVersion: "1.0.0"`

`scripts/content/publish-course.ts` sets `minimumAppVersion` to `"1.0.0"` for every publish, so
the compatibility gate Task 5 built is currently unreachable in production — no release can require
a newer build.

Two-sided: it also makes the catastrophic case unreachable, since an operator cannot publish a
release that locks out every existing build. Promote it to a CLI flag when a content schema bump
first needs it, and not before.

## 4. A new bundled release outranks an active downloaded release

An app update ships a new bundled release id, which activates over an active downloaded release.
An online device self-corrects on the next startup check within seconds. A learner who updates the
app and then stays **offline** is stranded on the older bundled curriculum indefinitely.

No progress is lost — progress is keyed by lesson id, not by release. Accepted because
`content_releases` has no ordering key (ids are opaque and `publishedAt` is remote-only) and the
bundled release is compatible-by-construction with the binary carrying it. Fixing it properly means
giving releases a comparable ordering, which is a schema change.

## 5. Editing content without bumping the bundled release id throws

`build-course.ts` hardcodes the bundled release id (`bundled-2026-08-04`). Editing content without
bumping it makes `release-installer.ts` reject the install — same id, different checksum — leaving
`data-context.tsx` in a permanent error state that retries in a loop.

**Pre-existing, not a branch regression**: the base commit throws identically in
`src/data/database/seed.ts`. Worth fixing where authors will actually hit it — either derive the id
from the content hash or fail at build time with an explanatory message.

## 6. Re-download loop when the manifest disagrees with a non-active installed release

`CourseSyncEngine` compares the manifest against the *active* release only, so a release that is
installed but not active can be downloaded repeatedly. Barely reachable in practice: the server
refuses a same-id/different-checksum publish with `23505`, so the manifest and the installed rows
cannot normally disagree. Cheap to make robust by checking installed releases, not just the active
one.

## 7. YAGNI leftovers

- `CourseSyncScheduler.failureCategory` — published, no consumer outside tests.
- `sync-context.tsx`'s `checkForCourseUpdate` — exposed, no caller.
- `CourseSyncEngine.supportedSchemaVersion` — a test-only seam on a production options type.
- Two `SqliteCourseRepository` notification methods where one would do.

Items 1 and 2 would each give the first three a consumer, so resolve those before deleting anything.

## Verification still owed to a human

The plan's Step 5 release acceptance checks are 1/7 done. The one that passed — publishing a
release with an unknown preview key is rejected — ran against the local Supabase stack. The other
six need on-device observation and/or a hosted non-production Supabase project, neither available
during implementation. Exact steps are in the Task 6 report; the substance is:

1. Install and open the bundled release offline.
2. Publish a text-only compatible release; verify background atomic activation.
3. Interrupt a release download; verify the previous release stays active.
4. Simulate a manifest requiring app version `999.0.0`; verify the client neither downloads nor
   activates it (note item 1 above — it will also show the learner nothing).
5. Restore the compatible manifest; verify the update succeeds after retry.
6. Relaunch in airplane mode; verify the downloaded release is still complete.

Also unverified on a device: the `expo-crypto` digest (the canonical input bytes are proven
identical to Node's, and `node:crypto` agreement is proven, so only the native digest itself is
untested), `ExpoSqliteDriver` transaction rollback (all tests use the Node driver), and durability
across process death. On the CI side, GitHub Actions secret redaction at runtime and the
`production-course` environment's required reviewers are repo settings nobody has configured yet —
the publishing workflow is inert until an admin does.
