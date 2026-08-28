# Concept-sized tutorial choices and Confirm flow follow-up

Date: 2026-08-29

## Outcome

The follow-up is implemented on main. Selecting a choice now highlights only that option. It does
not fill the source listing, create or change the learner preview, or evaluate correctness.
Confirm applies the selected fragment and evaluates it. A wrong confirmation renders the wrong
shader, shows “Not quite”, and remains retryable. Skip applies the authored correct fragment and
completes the step. The target remains visible throughout, and the existing profile-scoped
completion flow is unchanged.

All 21 authored steps in Modules 1–7 now ask for a single concept-sized expression or literal.
Every one of the 84 answer fragments is single-line. Shared declarations and result assignments
are visible in sourceTemplate instead of being repeated in each choice.

## Required documentation read

Before code changes, I read the exact Expo SDK 57 reference at:

https://docs.expo.dev/versions/v57.0.0/

No Expo API or dependency changes were needed. The implementation remains ordinary React state in
the existing Expo Router screen.

## Implementation

### UI behavior

- src/app/tutorial.tsx now keeps selectedChoiceId separate from confirmedChoiceId.
- learnerSource and TutorialSourceTemplate derive only from the confirmed choice.
- Confirm copies the selected id into confirmed state before evaluating it.
- Wrong answers remain rendered until another answer is confirmed.
- Skip sets both selected and confirmed ids to correctChoiceId and completes the step.
- Step changes clear both selection and confirmed result.
- Terminal correct/skipped guards and progress persistence were preserved.
- The primary action is now labelled “Confirm”.

### Authored content

The narrowed decisions include coordinates such as uv.x and uv.y; literal thresholds and radii
such as 0.75, 0.5, and 0.3; a band animation driver; union and derivative expressions; blend
factors and a palette phase vector; a cell-centering literal, rotation expression, and per-cell
phase; hash/noise inputs and a warp sample; and vignette, disc-mask, and one-dimensional horizon
expressions.

The source produced by every correct choice is byte-for-byte identical to the source produced
before this follow-up. Tutorial and step ids are unchanged, so saved completion remains keyed to
the same 21 step ids.

The immutable bundled release id was advanced from bundled-2026-08-28-21 to
bundled-2026-08-28-22, and assets/course/bundled-course.json was regenerated.

docs/data/tutorials.md now requires the narrowest meaningful expression or literal, disallows
multiline answer blocks, and documents selection versus confirmation.

## Strict TDD evidence

RED:

    npx jest src/app/__tests__/tutorial.test.tsx --runInBand

Result before production changes: 8 failed, 8 passed. The new behavior test observed two
sandbox-source nodes immediately after selection instead of one, and confirmation tests could not
find a button named Confirm. These were the intended missing behaviors.

GREEN after the minimal confirmed-choice implementation:

    npx jest src/app/__tests__/tutorial.test.tsx --runInBand

Result: 16 passed, 0 failed. The suite emitted the existing non-failing React act warning from the
asynchronous progress fetch.

Fresh final focused run:

    npx jest src/app/__tests__/tutorial.test.tsx --runInBand --silent

Result: 1 suite passed, 16 tests passed, exit 0.

## Verification evidence

- npm run content:build — exit 0; regenerated the bundled release.
- npm run content:check — exit 0; “Bundled course is up to date.”
- Independent HEAD-versus-worktree invariant script — PASS: 21 stable steps, 84 choices, exactly
  one marker per step, all fragments single-line, prior correct targets byte-identical, and no
  duplicate rendered choices.
- npx jest --runInBand --silent — 66 suites passed, 916 tests passed, 0 failures, exit 0.
- git diff --check — exit 0.
- npx tsc --noEmit --pretty false — exit 2 only for the known unrelated error at
  src/app/__tests__/settings.test.tsx:64. That fixture supplies a zero-argument Jest mock where the
  repository type requires one string argument. No changed file appears in the diagnostic.

## Commits

The verified UI behavior was checkpointed as 70d76f1:

    feat(tutorials): apply choices only on confirm

The authored content, regenerated bundle, release metadata, documentation, and this report are
committed together immediately after the report is written.

## Concerns

There are no known task-specific failures. The repository still has the unrelated TypeScript
settings mock diagnostic described above. The non-silent tutorial Jest run also retains the
pre-existing asynchronous act warning, while all assertions pass.
