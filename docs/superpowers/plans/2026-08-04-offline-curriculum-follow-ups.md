# Offline Curriculum Migration — Follow-Up Findings

Date: 2026-08-04
Source: final whole-branch review of `feat/offline-curriculum-sync` (merged to `main` at `b446dc1`)

The local SQLite curriculum plan is complete and merged. These items were raised during review,
triaged as non-blocking, and deliberately deferred. They are recorded here because they were
found by whole-branch analysis that per-task review could not do, and several matter before the
two remaining plans (Supabase progress sync, remote curriculum publishing) are implemented.

Ordered roughly by value.

## 1. Cache the parsed release; make `getModules()` the read primitive

`SqliteCourseRepository.getActiveRelease()` runs the full `parseCourseRelease` — Zod plus every
cross-record rule — on **every** read. `getModules()`, `getLesson()`, and
`getPublishedLessonIds()` all funnel through it with no caching.

Consequences: `CourseProvider.refresh` calls `getModules()` and `getActiveRelease()` in
`Promise.all`, so it performs two complete 4-table reads and two full validation passes for
byte-identical data. `SqliteProgressRepository.getCompletedLessonIds` calls
`getPublishedLessonIds()`, so **every progress refresh triggers a full curriculum read plus
revalidation** — including on every completion toggle.

Not a correctness bug at 14 lessons, but it scales badly with the curriculum. Cache the parsed
release and invalidate from `notifySubscribers`. This also subsumes the redundant re-sort in
`isModuleUnlocked` (which re-sorts modules on every call, after `buildNavigationModel` already
sorted them).

## 2. Add a driver-level transaction mutex — and fix the plans that mandated the wrong API

**Do this before the sync service lands.** Three call sites open transactions
(`setLessonCompleted`, `importLegacyCompletions`, `getOrCreateActiveProfile`) and `driver.transaction`
has no mutual exclusion. Neither driver supports nesting, so a second `BEGIN` throws. Today safety
is an emergent property of five files — `DataProvider` sequences initialization strictly and the UI
serializes completion presses through optimistic state — not an enforced invariant.

Separately, Expo SDK 57's own documentation warns that `withTransactionAsync` (which
`ExpoSqliteDriver.transaction` uses) includes *any* query running while the transaction is open,
"including query statements that are outside of the scope function", and recommends
`withExclusiveTransactionAsync` for predictable boundaries. So the spec's atomicity guarantee is
looser in practice than intended, and unrelated concurrent reads get swept into write transactions.

**This is a plan/spec defect, not only an implementation one** — the implementation plan specified
the non-exclusive variant verbatim. Both remaining plans inherited the same choice and should be
corrected before they are executed, since the sync service introduces genuinely concurrent
transaction openers (upload batches racing UI writes).

Cheap sufficient mitigation: chain `transaction()` calls through a stored promise so at most one is
ever open, making nesting structurally impossible. Adopting `withExclusiveTransactionAsync` is the
fuller fix but changes how queries must be routed — check its callback contract first.

## 3. `seed.ts` activates the bundled release unconditionally

`installBundledRelease` writes `active_release_id` whenever the bundled release is newly inserted,
with no comparison against what is already active. Correct today. Once remote publishing ships, a
device that activated remote release `R2` and then takes an app update carrying bundle `B2` will be
**silently downgraded** to `B2` on next launch.

Gate on "no active release", or compare recency. Note `published_at` exists in the schema but is
never written or read, so there is currently no field to compare on.

## 4. Two dead lesson-lookup APIs

`SqliteCourseRepository.getLesson` and `CourseProvider.getLesson` each have **zero** production
consumers — only tests and fakes. The lesson route wrote a third lookup (`findTarget`) because it
needs the enclosing module and index too. Task 5 mandated the repository method and Task 7 the
provider method; neither task was wrong individually.

Either delete both, or widen `CourseProvider.getLesson` to return the `{ lesson, module, index }`
shape the route actually needs and have the route consume it.

## 5. Four plan-specified schema rules have no negative test

The plan listed eight cross-record validation rules; four are implemented but untested: the ID
pattern, non-contiguous positions, duplicate module/preset/section IDs, the `minimumAppVersion`
format, and the `lesson.moduleId !== module.id` check. All are one-line negative tests against the
existing `copyModules()` fixture.

## 6. Release compatibility is only half-enforced

`minimumAppVersion` is format-checked but never *compared* against the app version, and the
checksum is never verified against content at runtime — `installBundledRelease` treats it purely as
an identity token, and `content:check` is the only enforcement. Acceptable while content ships
inside the app bundle; the spec explicitly requires both checks on the remote activation path, so
close this as part of the publishing plan.

## 7. Dead code

Seven orphaned styles in `src/app/course.tsx` (`subtitle`, `overviewCard`, `overviewHeader`,
`overviewLabel`, `overviewProgress`, `overviewTitle`, `overviewCopy`); an unused `findLesson` helper
in `src/app/__tests__/lesson.test.tsx`; `SqliteCourseRepository.notifySubscribers` is `protected` on
a class nothing extends and is never called, so `subscribe` is permanently inert; the now-redundant
`?? lessons[lessons.length - 1]` fallback in `course.tsx`'s `openModule`; `NavigationModel.progressPercent`
is computed but unused (both screens read `progressPercent` from `useProgress()`); `published_at` is
never written; and a stale `GLView key="shape-synthesis-v1"` constant left over from the deleted
Module 3 screen.

## 8. `course-module-card` derives per-lesson state from a count

`complete = index < completedLessonCount` mislabels lessons after a mid-module undo — complete
lessons 1 and 2, undo lesson 1, and lesson 1 still renders as complete. Pre-existing, but
`NavigationModuleViewModel.lessons[].isComplete` now exists and would fix it cheaply. Also
`key={topic}` collides if two lessons ever share a title.

## 9. Two files bundle separable concerns

`src/components/lesson-workspace.tsx` is ~690 lines (~340 logic/markup plus co-located styles) and
contains five visually independent cards — preview, preset switcher, source listing, concept
sections, action bar — that would extract cleanly. It replaced ~2000 lines across three screens and
review judged it maintainable as written, so this needs its own task rather than an ad-hoc split.

`src/context/data-context.tsx` mixes initialization orchestration with a fully-styled
`StartupStatus` component and its `StyleSheet`; extracting the UI is a mechanical move.

## 10. Fragile type and layering configuration

`tsconfig.json` sets `"types": ["jest"]`, which suppresses automatic `@types/node`. The
`import … from "node:sqlite"` in the test driver therefore typechecks *only* because
`scripts/content/build-course.ts` carries a `/// <reference types="node" />` and is inside
`include`. Deleting that one line silently breaks typechecking of an unrelated file.

Nothing enforces the layering the architecture depends on. It holds today (verified: no React
imports under `src/data`, `expo-sqlite` imported in exactly two files, the Node test driver imported
only under `__tests__`), but a lint boundary rule — `eslint-plugin-import` zones or equivalent —
would make it durable rather than conventional.

## 11. Module 4 gained two invented roadmap topics

`content/module-04-textures.json` lists `"Fractal Brownian Motion"` and `"Domain Warping"`, which
did not exist before the migration. The pre-migration screen had 3 topics with a lesson count of 5,
and the schema requires `plannedLessonCount === plannedTopics.length`, so two labels had to be
invented. The Course screen now renders 5 timeline rows for Module 4 instead of 3. Replace the
placeholders with the real intended lesson titles when Module 4 is planned properly.

## 12. The sync outbox is never pruned

The legacy import intentionally retains progress rows for unknown/retired lesson IDs, and enqueues
outbox mutations for them. Once the sync service exists those will fail permanently and trip the
sync-attention state. Negligible today — all 14 legacy IDs are current — but the sync plan should
handle unknown-entity mutations explicitly.

## Process note

Three of these findings (1, 4, and parts of 7) are duplication or dead code created because two
tasks each satisfied their own brief correctly. An interface-reconciliation step after the provider
and UI tasks — grep every newly produced public API for at least one production consumer — would
have caught all three before they landed.
