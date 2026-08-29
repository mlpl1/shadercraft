# Tutorial Exercise UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved dark playful learning-flow redesign for the mobile tutorial exercise screen without changing exercise correctness, persistence, or navigation behavior.

**Architecture:** Keep `TutorialScreen` as the state owner and split only visual responsibilities into small presentational components: progress rail, answer tile, feedback/comparison block, and action dock. Derive every visual state from the existing pending/confirmed choice and feedback state; keep shader rendering and persistence behind the existing callbacks.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19.2, Expo Router, TypeScript, Jest with `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-08-29-tutorial-exercise-ui-redesign.md`

## Global Constraints

- Preserve four randomized choices, answer correctness, optimistic completion, profile isolation, and all tutorial/step IDs.
- Selection alone must never fill the code blank or update the learner preview.
- Confirm applies the selected fragment; Skip reveals the correct fragment and completes the step.
- Use only the existing dark theme tokens in `src/constants/theme.ts`; add no UI dependency.
- Maintain accessible roles, selected/disabled states, text status labels, and minimum 44px touch targets.
- Target Expo SDK 57 / React Native 0.86 APIs only.

---

### Task 1: Add failing tests for the redesigned state-driven layout

**Files:**
- Modify: `src/app/__tests__/tutorial.test.tsx`
- Test: `src/app/__tests__/tutorial.test.tsx`

**Interfaces:**
- Consumes the current `TutorialScreen` test harness and existing fake course/progress providers.
- Produces explicit behavioral expectations for later visual component work.

- [ ] **Step 1: Write the failing tests**

Add tests that assert:

```tsx
it("shows the challenge and code before the first answer, without an empty learner preview", () => {
  renderTutorial();
  expect(screen.getByText(/Choose an answer/)).toBeTruthy();
  expect(screen.queryByText("Yours")).toBeNull();
  expect(screen.getByText("Confirm")).toBeDisabled();
});

it("marks a pending choice without applying it to the source or preview", async () => {
  renderTutorial();
  await user.press(screen.getByRole("button", { name: /uv\.x/ }));
  expect(screen.getByText("Selected")).toBeTruthy();
  expect(screen.getByText(/Choose an answer/)).toBeTruthy();
  expect(screen.queryByText("Yours")).toBeNull();
});

it("reveals comparison and feedback only after confirmation", async () => {
  renderTutorial();
  await user.press(screen.getByRole("button", { name: /uv\.x/ }));
  await user.press(screen.getByRole("button", { name: "Confirm" }));
  expect(screen.getByText("Target")).toBeTruthy();
  expect(screen.getByText("Yours")).toBeTruthy();
  expect(screen.getByText(/Continue/)).toBeTruthy();
});

it("keeps retry confirmation available after an incorrect answer", async () => {
  renderTutorial();
  await user.press(screen.getByRole("button", { name: /wrong/ }));
  await user.press(screen.getByRole("button", { name: "Confirm" }));
  expect(screen.getByText(/Not quite/)).toBeTruthy();
  expect(screen.getByText("Try another answer")).toBeTruthy();
});
```

Adapt the answer labels to the fixture’s actual fragments; do not assert implementation-only class names.

- [ ] **Step 2: Run the focused test file and verify RED**

Run: `npx jest src/app/__tests__/tutorial.test.tsx --runInBand`

Expected: the new assertions fail because the current screen still renders the old preview/choice/action arrangement.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/app/__tests__/tutorial.test.tsx
git commit -m "test(tutorials): specify redesigned exercise states"
```

### Task 2: Build focused presentational exercise components

**Files:**
- Create: `src/components/tutorial-progress-rail.tsx`
- Create: `src/components/tutorial-answer-tile.tsx`
- Create: `src/components/tutorial-feedback.tsx`
- Create: `src/components/tutorial-action-dock.tsx`
- Test: `src/components/__tests__/tutorial-exercise-ui.test.tsx`

**Interfaces:**
- `TutorialProgressRail({ total, current, completed })` renders segmented progress and exposes `testID="tutorial-progress-rail"`.
- `TutorialAnswerTile({ marker, fragment, selected, status, disabled, onPress })` renders one accessible answer button with marker and status.
- `TutorialFeedback({ state, explanation, targetSource, learnerSource, helpers })` renders no comparison for `idle`, and comparison/feedback for `incorrect`, `correct`, or `skipped`.
- `TutorialActionDock({ state, canConfirm, onConfirm, onSkip, onHint, onContinue, onRetry })` renders the correct stable action set for each state.

- [ ] **Step 1: Write presentational tests first**

Assert four progress segments with active/completed accessibility states, A–D markers, 44px-plus answer targets, no comparison in idle/selected state, comparison after confirmation, and action labels for idle/incorrect/correct/skipped.

- [ ] **Step 2: Run the component tests and verify RED**

Run: `npx jest src/components/__tests__/tutorial-exercise-ui.test.tsx --runInBand`

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the minimal components**

Use `StyleSheet`, `Pressable`, `Text`, and `View`; use only `Colors`, `Spacing`, and `Radius`. Keep all callbacks and state passed in; do not add correctness or persistence logic.

- [ ] **Step 4: Run the component tests and verify GREEN**

Run: `npx jest src/components/__tests__/tutorial-exercise-ui.test.tsx --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit the component slice**

```bash
git add src/components/tutorial-progress-rail.tsx src/components/tutorial-answer-tile.tsx src/components/tutorial-feedback.tsx src/components/tutorial-action-dock.tsx src/components/__tests__/tutorial-exercise-ui.test.tsx
git commit -m "feat(tutorials): add focused exercise UI components"
```

### Task 3: Integrate the redesigned layout into TutorialScreen

**Files:**
- Modify: `src/app/tutorial.tsx`
- Modify: `src/components/tutorial-source-template.tsx`
- Test: `src/app/__tests__/tutorial.test.tsx`

**Interfaces:**
- Preserve `selectedChoiceId`, `confirmedChoiceId`, `feedback`, `completeStep`, `checkAnswer`, and `skipAndReveal` semantics.
- Pass `confirmedChoice?.fragment` only to code/preview components.
- Pass pending `selectedChoiceId` only to answer tile selection styling.

- [ ] **Step 1: Replace the old layout with the component composition**

Render in order: compact header/back, progress rail, challenge title/brief, source template card, answer tiles, feedback/comparison when confirmed, and action dock. Move Previous/Next into the compact navigation area and add content bottom padding equal to the dock height plus safe-area inset.

- [ ] **Step 2: Update source-template visual states**

Add a `state` prop with `idle | selected | incorrect | correct | skipped`; keep the blank visible in idle and style the confirmed fragment by state. Do not change marker substitution behavior.

- [ ] **Step 3: Wire terminal actions and retry behavior**

The dock must call existing handlers. Continue advances to the next step or returns to the tutorial list on the final step. Selecting another answer after incorrect resets only pending feedback/action styling; it must not clear the confirmed preview until the next Confirm.

- [ ] **Step 4: Run focused app tests and verify GREEN**

Run: `npx jest src/app/__tests__/tutorial.test.tsx src/components/__tests__/tutorial-exercise-ui.test.tsx --runInBand`

Expected: all tests PASS; the existing React `act(...)` warning may remain if it is unchanged from the baseline.

- [ ] **Step 5: Commit the integrated screen**

```bash
git add src/app/tutorial.tsx src/components/tutorial-source-template.tsx src/app/__tests__/tutorial.test.tsx
git commit -m "feat(tutorials): redesign exercise learning flow"
```

### Task 4: Verify the full app and document the handoff

**Files:**
- Modify: `docs/superpowers/sdd/2026-08-28-multiple-choice-tutorial-exercises/progress.md`

- [ ] **Step 1: Run the full test suite**

Run: `npx jest --runInBand`

Expected: all suites pass; report any pre-existing warnings separately.

- [ ] **Step 2: Validate bundled content**

Run: `npm run content:check`

Expected: PASS; no exercise content is changed by this UI-only work.

- [ ] **Step 3: Run static checks**

Run: `npx tsc --noEmit` and `npm run lint`.

Expected: no new errors attributable to the redesign. Existing unrelated settings-test TypeScript and library lint issues must be classified if still present.

- [ ] **Step 4: Perform Android visual verification**

Run: `npm run android` with a cold-booted Pixel emulator. Verify unselected, selected, incorrect, correct, skipped, and final-step states; confirm the bottom dock does not cover answer tiles and the keyboard/window insets are stable.

- [ ] **Step 5: Record verification evidence**

Append the commands, counts, known warnings, and Android result to the SDD progress ledger.

- [ ] **Step 6: Commit the verification record**

```bash
git add docs/superpowers/sdd/2026-08-28-multiple-choice-tutorial-exercises/progress.md
git commit -m "docs(tutorials): record exercise UI verification"
```
