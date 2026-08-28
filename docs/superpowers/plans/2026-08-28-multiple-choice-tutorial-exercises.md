# Multiple-choice Tutorial Exercises Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-form tutorial editing with four-choice, single-blank shader questions that render selections, permit retries or skipping, and save completion.

**Architecture:** Tutorial content stores one source template, four authored fragments, and the correct choice id. A focused pure helper substitutes and shuffles choices; the tutorial screen owns only visit-scoped selection/feedback state, while the existing progress repository remains the durable completion boundary. Local SQLite and Supabase release storage change together so bundled and remotely published course payloads round-trip the same model.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript, Zod, expo-router, SQLite, Supabase/PostgreSQL, Jest, React Native Testing Library

**Spec:** `docs/superpowers/specs/2026-08-28-multiple-choice-tutorial-exercises-design.md`

## Global Constraints

- Read the exact Expo SDK 57 documentation at `https://docs.expo.dev/versions/v57.0.0/` before implementation code.
- Every tutorial step has exactly one `/*__SHADERCRAFT_BLANK__*/` marker and exactly four authored choices.
- Choice order shuffles once per opened step, stays fixed through retries, and reshuffles when reopened.
- Target preview remains visible; the learner preview compiles only a substituted source, never the marker.
- Correct and skipped steps both persist as completed through `TutorialProgressRepository.setCompleted`.
- Existing tutorial step ids remain unchanged so existing completion rows survive.
- No pixel grading, multiple blanks, remote completion sync, runtime-generated distractors, or new dependencies.

## File structure

- Create `src/data/course/tutorial-exercise.ts`: marker constant, template substitution, correct-source lookup, and injectable Fisher-Yates shuffle.
- Create `src/data/course/__tests__/tutorial-exercise.test.ts`: pure exercise behavior tests.
- Modify `src/data/course/types.ts` and `src/data/course/schema.ts`: new domain fields and authoring validation.
- Modify `src/data/database/migrations.ts`, `src/data/course/release-installer.ts`, and `src/data/course/sqlite-course-repository.ts`: local release storage and reconstruction.
- Create `supabase/migrations/202608280001_multiple_choice_tutorials.sql`: immutable remote schema/RPC update.
- Modify `src/app/tutorial.tsx` and `src/app/__tests__/tutorial.test.tsx`: multiple-choice interaction and completion behavior.
- Modify `src/app/shader-audit.tsx`: compile all four substitutions for every tutorial step.
- Modify `content/module-01-fragments.json` through `content/module-07-composition.json`: convert all current exercises.
- Modify `docs/data/tutorials.md`, `docs/data/curriculum-publishing.md`, and affected fixtures/tests: document and verify the new contract.

---

### Task 1: Pure tutorial exercise model and schema

**Files:**
- Create: `src/data/course/tutorial-exercise.ts`
- Create: `src/data/course/__tests__/tutorial-exercise.test.ts`
- Modify: `src/data/course/types.ts`
- Modify: `src/data/course/schema.ts`
- Modify: `src/data/course/__tests__/schema.test.ts`
- Modify: `src/data/course/__tests__/tutorial-model.test.ts`
- Modify: `src/app/__tests__/tutorials.test.tsx`

**Interfaces:**
- Produces: `SHADERCRAFT_BLANK`, `fillTutorialTemplate(template, fragment): string`, `getCorrectTutorialSource(step): string`, and `shuffleTutorialChoices(choices, random?): TutorialChoice[]`.
- Produces: `TutorialChoice { id: string; fragment: string }` and the new `TutorialStep` fields from the spec.
- Consumes: existing shader source restrictions in `schema.ts`.

- [ ] **Step 1: Write failing pure-helper tests**

```ts
import {
  SHADERCRAFT_BLANK,
  fillTutorialTemplate,
  getCorrectTutorialSource,
  shuffleTutorialChoices,
} from "../tutorial-exercise";

test("fills exactly the authored blank", () => {
  expect(fillTutorialTemplate(`float radius = ${SHADERCRAFT_BLANK};`, "0.25")).toBe(
    "float radius = 0.25;",
  );
});

test("derives the target from the correct choice", () => {
  expect(getCorrectTutorialSource(step({ correctChoiceId: "quarter" }))).toContain("0.25");
});

test("shuffles without mutating authored choices", () => {
  const authored = choices();
  expect(shuffleTutorialChoices(authored, () => 0)).not.toEqual(authored);
  expect(authored.map(({ id }) => id)).toEqual(["quarter", "half", "one", "zero"]);
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `npx jest src/data/course/__tests__/tutorial-exercise.test.ts --runInBand`

Expected: FAIL because `tutorial-exercise.ts` does not exist.

- [ ] **Step 3: Add the new types and minimal pure helper**

```ts
export const SHADERCRAFT_BLANK = "/*__SHADERCRAFT_BLANK__*/";

export function fillTutorialTemplate(template: string, fragment: string): string {
  return template.replace(SHADERCRAFT_BLANK, fragment);
}

export function getCorrectTutorialSource(step: TutorialStep): string {
  const choice = step.answerChoices.find(({ id }) => id === step.correctChoiceId);
  if (!choice) throw new Error(`Tutorial step ${step.id} has no correct choice`);
  return fillTutorialTemplate(step.sourceTemplate, choice.fragment);
}

export function shuffleTutorialChoices(
  choices: readonly TutorialChoice[],
  random: () => number = Math.random,
): TutorialChoice[] {
  const shuffled = [...choices];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
}
```

- [ ] **Step 4: Run the helper tests and verify GREEN**

Run: `npx jest src/data/course/__tests__/tutorial-exercise.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Replace schema fixtures and add failing validation tests**

Add cases proving rejection of zero/two markers, three/five choices, duplicate choice ids, blank fragments, an unknown `correctChoiceId`, forbidden tokens after substitution, and duplicate rendered substitutions. Update unrelated tutorial fixtures to use:

```ts
sourceTemplate: `fragColor = vec4(${SHADERCRAFT_BLANK});`,
answerChoices: [
  { id: "white", fragment: "1.0" },
  { id: "black", fragment: "0.0" },
  { id: "half", fragment: "0.5" },
  { id: "quarter", fragment: "0.25" },
],
correctChoiceId: "white",
```

- [ ] **Step 6: Run schema/model suites and verify RED**

Run: `npx jest src/data/course/__tests__/schema.test.ts src/data/course/__tests__/tutorial-model.test.ts src/app/__tests__/tutorials.test.tsx --runInBand`

Expected: new validation cases FAIL while fixture-only failures identify every remaining old field.

- [ ] **Step 7: Implement strict Zod and semantic validation**

Define a strict `tutorialChoiceSchema`; require `.length(4)` for `answerChoices`; count marker occurrences; validate choice ids globally within the step; substitute each fragment and pass it to `validateStageSource`; reject duplicate rendered sources with a `Set`; require the correct id to resolve. Remove `starterSource` and `solutionSource` from `TutorialStep` and its Zod object.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `npx jest src/data/course/__tests__/tutorial-exercise.test.ts src/data/course/__tests__/schema.test.ts src/data/course/__tests__/tutorial-model.test.ts src/app/__tests__/tutorials.test.tsx --runInBand`

Run: `npx tsc --noEmit`

Expected: Jest PASS; TypeScript failures are limited to storage, screen, audit, and authored content paths intentionally handled by later tasks.

- [ ] **Step 9: Commit the domain boundary**

```powershell
git add src/data/course/types.ts src/data/course/schema.ts src/data/course/tutorial-exercise.ts src/data/course/__tests__/tutorial-exercise.test.ts src/data/course/__tests__/schema.test.ts src/data/course/__tests__/tutorial-model.test.ts src/app/__tests__/tutorials.test.tsx
git commit -m "feat(tutorials): model single-blank answer choices"
```

### Task 2: Local SQLite release round-trip

**Files:**
- Modify: `src/data/database/migrations.ts`
- Modify: `src/data/database/__tests__/migrations.test.ts`
- Modify: `src/data/course/release-installer.ts`
- Modify: `src/data/course/sqlite-course-repository.ts`
- Modify: `src/data/course/__tests__/release-installer.test.ts`
- Modify: `src/data/course/__tests__/course-repository.test.ts`

**Interfaces:**
- Consumes: `TutorialStep` from Task 1.
- Stores: `source_template TEXT`, `answer_choices_json TEXT`, and `correct_choice_id TEXT`.
- Produces: repository output that exactly reconstructs the authored `TutorialStep`.

- [ ] **Step 1: Add failing migration and round-trip assertions**

Assert the latest migrated `tutorial_steps` columns include the three new fields; install a fixture with four choices; query its raw JSON; then read the active release and expect the original `sourceTemplate`, `answerChoices`, and `correctChoiceId`.

- [ ] **Step 2: Run the focused storage tests and verify RED**

Run: `npx jest src/data/database/__tests__/migrations.test.ts src/data/course/__tests__/release-installer.test.ts src/data/course/__tests__/course-repository.test.ts --runInBand`

Expected: FAIL because the columns and mappings do not exist.

- [ ] **Step 3: Add a forward-only SQLite migration**

Append a migration version after the current latest version that creates a replacement table, copies release/tutorial identity fields, drops the obsolete release-scoped tutorial step rows, and renames the replacement. Keep `tutorial_step_progress` and `tutorial_step_drafts` untouched so step completion survives. Because released content is reinstalled from a new immutable release, do not synthesize choices from old sources.

The final table shape must include:

```sql
source_template TEXT NOT NULL,
answer_choices_json TEXT NOT NULL,
correct_choice_id TEXT NOT NULL
```

- [ ] **Step 4: Update installer and repository mapping**

Installer values:

```ts
step.sourceTemplate,
JSON.stringify(step.answerChoices),
step.correctChoiceId,
```

Repository values:

```ts
sourceTemplate: step.source_template,
answerChoices: JSON.parse(step.answer_choices_json) as TutorialChoice[],
correctChoiceId: step.correct_choice_id,
```

Let `parseCourseRelease` validate parsed JSON rather than trusting database contents.

- [ ] **Step 5: Run storage tests and verify GREEN**

Run: `npx jest src/data/database/__tests__/migrations.test.ts src/data/course/__tests__/release-installer.test.ts src/data/course/__tests__/course-repository.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit local persistence**

```powershell
git add src/data/database/migrations.ts src/data/database/__tests__/migrations.test.ts src/data/course/release-installer.ts src/data/course/sqlite-course-repository.ts src/data/course/__tests__/release-installer.test.ts src/data/course/__tests__/course-repository.test.ts
git commit -m "feat(tutorials): persist answer-choice exercises"
```

### Task 3: Remote curriculum publishing contract

**Files:**
- Create: `supabase/migrations/202608280001_multiple_choice_tutorials.sql`
- Modify: `supabase/tests/database/curriculum_releases.test.sql`
- Modify: `scripts/content/__tests__/publish-course.test.ts`
- Modify: `docs/data/curriculum-publishing.md`

**Interfaces:**
- Consumes: release JSON field names from Task 1.
- Produces: `publish_course_release(jsonb)` and `get_course_release(text)` that round-trip choice steps without changing immutable release/count semantics.

- [ ] **Step 1: Change pgTAP fixtures/assertions to the new payload**

Replace old step sources with `sourceTemplate`, four `answerChoices`, and `correctChoiceId`. Assert the stored template, JSON choice array, and correct id; assert `get_course_release` returns them unchanged.

- [ ] **Step 2: Run database tests and verify RED**

Run: `npm run db:test`

Expected: FAIL on missing remote columns/RPC fields.

- [ ] **Step 3: Add the Supabase migration**

Within the migration, add `source_template`, `answer_choices jsonb`, and `correct_choice_id`; remove obsolete source columns only after the project is confirmed pre-release; replace both RPCs so inserts and JSON reconstruction use the new camelCase payload fields. Preserve service-role checks, immutability triggers, row-level security, active-release behavior, and expected/actual nested counts.

- [ ] **Step 4: Update publisher fixtures and documentation**

Make publishing tests use a valid four-choice step and revise the curriculum publishing field description. Do not add a separate network format or conversion layer.

- [ ] **Step 5: Run publishing and database tests**

Run: `npx jest scripts/content/__tests__/publish-course.test.ts --runInBand`

Run: `npm run db:test`

Expected: PASS.

- [ ] **Step 6: Commit remote persistence**

```powershell
git add supabase/migrations/202608280001_multiple_choice_tutorials.sql supabase/tests/database/curriculum_releases.test.sql scripts/content/__tests__/publish-course.test.ts docs/data/curriculum-publishing.md
git commit -m "feat(tutorials): publish answer-choice exercises"
```

### Task 4: Multiple-choice tutorial interaction

**Files:**
- Modify: `src/app/tutorial.tsx`
- Modify: `src/app/__tests__/tutorial.test.tsx`
- Create: `src/components/tutorial-source-template.tsx`
- Create: `src/components/__tests__/tutorial-source-template.test.tsx`

**Interfaces:**
- Consumes: Task 1 helpers and `TutorialStep`.
- Produces: `TutorialSourceTemplate({ template, selectedFragment })`, a read-only accessible code view.
- Persists: `repository.setCompleted(profileId, step.id, true)` on correct check and skip.

- [ ] **Step 1: Write failing source-template component tests**

Assert that the component renders prefix, a visible `Choose an answer` blank before selection, the selected fragment after selection, suffix, and an accessibility label containing the complete readable expression.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npx jest src/components/__tests__/tutorial-source-template.test.tsx --runInBand`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the read-only template component**

Split with `template.indexOf(SHADERCRAFT_BLANK)` and render prefix/blank/suffix using the existing monospace/editor colors. Do not mount `GlslInput` and do not compile the marker.

- [ ] **Step 4: Add failing screen interaction tests**

Cover:

```ts
fireEvent.press(screen.getByRole("button", { name: "0.5" }));
fireEvent.press(screen.getByRole("button", { name: "Check answer" }));
expect(screen.getByText("Not quite")).toBeTruthy();
expect(repository.setCompleted).not.toHaveBeenCalled();

fireEvent.press(screen.getByRole("button", { name: "0.25" }));
fireEvent.press(screen.getByRole("button", { name: "Check answer" }));
expect(repository.setCompleted).toHaveBeenCalledWith("profile-a", "pulse-s1", true);
```

Also test target source derivation, learner preview substitution, disabled check before selection, unlimited retry, skip/reveal completion, completed-step display, no draft writes, stable option order after wrong checks, and reshuffle after unmount/remount.

- [ ] **Step 5: Run the tutorial screen tests and verify RED**

Run: `npx jest src/app/__tests__/tutorial.test.tsx --runInBand`

Expected: FAIL because the editor/reveal UI still exists.

- [ ] **Step 6: Implement visit-scoped exercise state**

Use state for `shuffledChoices`, `selectedChoiceId`, and feedback (`"idle" | "incorrect" | "correct" | "skipped"`). Reset and reshuffle when `step.id` changes. Derive target with `getCorrectTutorialSource`; derive learner source only when selected. On a wrong check, retain selection and choices but allow another selection. On correct/skip, optimistically add the id to `completedStepIds` and call `setCompleted(..., true)`.

- [ ] **Step 7: Remove editor/draft behavior and finish accessible styles**

Remove `GlslInput`, compile-error/editor settings state, debounce timers, draft restore/save, reveal source mutation, and manual completion toggle. Give every option a button role, selected state, and clear correct/incorrect styling that does not rely on color alone. Keep target/yours previews and previous/next navigation.

- [ ] **Step 8: Run component and screen tests**

Run: `npx jest src/components/__tests__/tutorial-source-template.test.tsx src/app/__tests__/tutorial.test.tsx --runInBand`

Expected: PASS.

- [ ] **Step 9: Commit the interaction**

```powershell
git add src/components/tutorial-source-template.tsx src/components/__tests__/tutorial-source-template.test.tsx src/app/tutorial.tsx src/app/__tests__/tutorial.test.tsx
git commit -m "feat(tutorials): add multiple-choice exercise flow"
```

### Task 5: Convert every authored exercise and shader audit

**Files:**
- Modify: `content/module-01-fragments.json`
- Modify: `content/module-02-shaping.json`
- Modify: `content/module-03-distance-fields.json`
- Modify: `content/module-04-colour.json`
- Modify: `content/module-05-space.json`
- Modify: `content/module-06-noise.json`
- Modify: `content/module-07-composition.json`
- Modify: `src/app/shader-audit.tsx`
- Modify: `docs/data/tutorials.md`
- Modify: `scripts/content/release-metadata.ts`
- Regenerate: `assets/course/bundled-course.json`

**Interfaces:**
- Consumes: new schema and substitution helper from Task 1.
- Produces: a new immutable bundled release in which every tutorial choice compiles and the correct substitution matches the former solution source exactly.

- [ ] **Step 1: Add/adjust audit coverage before content conversion**

Change `collectSources` so each tutorial step contributes four entries named `choice:<choice-id>`, each built with `fillTutorialTemplate`. Export or unit-test collection if needed so a test proves all four choices are included, not only the correct one.

- [ ] **Step 2: Run content check and audit-related tests to establish RED**

Run: `npm run content:check`

Run: `npx tsc --noEmit`

Expected: FAIL while authored JSON still carries the old fields.

- [ ] **Step 3: Convert modules 1–7**

For every step, diff `starterSource` against `solutionSource`, select one concept-bearing span, replace it with the marker in `sourceTemplate`, preserve the former solution span as the correct fragment, and author three unique plausible mistakes. Keep all existing tutorial/step ids and positions. If a step changes multiple concepts, split it into sequential steps while preserving the original id on the first step and giving new globally unique ids to additions.

- [ ] **Step 4: Verify each converted correct source matches its former target**

Before deleting conversion notes, compare each generated correct source byte-for-byte with the old `solutionSource`. Resolve differences by narrowing the template blank, not by silently changing the target shader.

- [ ] **Step 5: Update authoring docs and release metadata**

Rewrite `docs/data/tutorials.md` around templates, four authored distractors, fixed-per-visit shuffling, correct/skip completion, and no drafts. Bump `BUNDLED_RELEASE_ID` once because immutable course content changed.

- [ ] **Step 6: Regenerate and validate bundled content**

Run: `npm run content:build`

Run: `npm run content:check`

Expected: both PASS and `assets/course/bundled-course.json` contains no `starterSource` or `solutionSource` keys.

- [ ] **Step 7: Run schema/content/UI suites**

Run: `npx jest src/data/course/__tests__ src/app/__tests__/tutorial.test.tsx src/app/__tests__/tutorials.test.tsx --runInBand`

Expected: PASS.

- [ ] **Step 8: Commit content conversion**

```powershell
git add content assets/course/bundled-course.json src/app/shader-audit.tsx docs/data/tutorials.md scripts/content/release-metadata.ts
git commit -m "content: convert tutorials to answer choices"
```

### Task 6: Full verification and release-readiness check

**Files:**
- Modify only files required by concrete failures found below.

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: verified app, content, database, and publishing behavior with no legacy tutorial fields.

- [ ] **Step 1: Scan for stale fields and behaviors**

Run: `rg -n "starterSource|solutionSource|starter_source|solution_source|Reveal solution|Mark done" src scripts content assets docs supabase`

Expected: no production/content hits; historical design/plan documents may retain explanatory references.

- [ ] **Step 2: Run static checks**

Run: `npm run lint`

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 3: Run content checks and full Jest suite**

Run: `npm run content:check`

Run: `npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 4: Run Supabase database tests**

Run: `npm run db:test`

Expected: PASS. If the local Supabase runtime is unavailable, report this verification separately rather than treating skipped database coverage as passing.

- [ ] **Step 5: Perform device shader audit and interaction smoke test**

Open the hidden shader-audit route on an Android emulator/device and confirm every stage and every answer choice compiles. Open at least one tutorial and confirm target visibility, stable choice order through a wrong retry, success persistence after reopening, skip persistence, and reshuffle after reopening.

- [ ] **Step 6: Inspect final diff and commit only evidence-backed fixes**

Run: `git diff --check`

Run: `git status --short`

If verification required fixes, commit them with a message naming the concrete defect. Do not create an empty verification commit.

