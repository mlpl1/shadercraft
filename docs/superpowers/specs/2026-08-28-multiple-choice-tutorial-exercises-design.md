# Multiple-choice tutorial exercises

## Goal

Replace free-form GLSL editing in tutorial exercises with approachable, Duolingo-like multiple-choice questions. A learner should identify a missing shader fragment from four plausible options, see the selected fragment rendered, retry after a wrong answer, or skip to reveal the answer. Completion must be saved per learner and remain compatible with the existing step-based progress model.

## Scope and constraints

- Applies to every authored tutorial step, including the currently bundled exercises.
- Each step has exactly one blank and exactly four authored answer choices.
- Choices are code fragments, not complete shader sources. Distractors are hand-authored and should represent likely conceptual or numeric mistakes.
- Choice order is shuffled once when a step screen opens and remains fixed for that visit. Reopening the step creates a new order.
- The target preview remains visible. The learner's preview is built from the selected fragment.
- A correct answer and a skipped answer both mark the step complete. Completion is persisted through the existing `TutorialProgressRepository` and remains local-only.
- Free-form source editing, source drafts, and the old reveal-editor interaction are removed from the tutorial screen. Existing draft rows may remain in the database and are ignored.
- This is a pre-release schema/content change. The course release schema version remains `1`; old published releases must either be migrated by the authoring conversion or rejected as legacy tutorial content before publication.

## Content model

`TutorialStep` changes from two complete sources to a template and choices:

```ts
type TutorialChoice = {
  id: string;
  fragment: string;
};

type TutorialStep = {
  id: string;
  position: number;
  title: string;
  brief: string;
  sourceTemplate: string;
  answerChoices: TutorialChoice[];
  correctChoiceId: string;
  helpers?: string;
  hint?: string;
};
```

`sourceTemplate` contains exactly one reserved marker, `/*__SHADERCRAFT_BLANK__*/`. The marker is replaced with a selected choice fragment to produce a complete shader body. The marker is never sent to the shader compiler. The correct fragment is also used to construct the target source, so the target and answer cannot drift.

Schema validation must enforce:

- exactly one marker in `sourceTemplate`;
- exactly four choices with unique ids and non-empty fragments;
- `correctChoiceId` names exactly one choice;
- the template with every choice substituted satisfies the existing shader-source restrictions;
- the correct substitution differs from at least one distractor substitution;
- existing id, position, brief, helper, and hint rules continue to apply.

The generated release, checksum, Supabase tables, RPC payloads, SQLite installer, and repository mapper all carry the new fields. Because tutorial rows are immutable once published, the authored content conversion must produce a new release id. Existing step ids remain unchanged so previously stored completion rows continue to match.

## Runtime flow

When the tutorial screen enters a step:

1. Load the step and existing completion state.
2. Create a local shuffled copy of the four choices. The shuffle is performed only when the step id changes or the screen is newly opened, never after a wrong attempt.
3. Render the target using `sourceTemplate` plus the correct fragment.
4. Render the learner preview using the selected fragment; before selection, show the starter/blank state without compiling the marker.
5. On selection, show the selected code fragment and enable “Check answer”.
6. On check, show success and persist completion for the correct choice, or show “Not quite” and leave all options available for another attempt.
7. “Skip” inserts the correct fragment, marks the step complete, and shows a revealed-answer state. It does not require a later correct attempt.
8. Navigation to another step discards the local choice order; returning to the step reshuffles it while retaining completion.

The target remains visible throughout. The answer feedback is deliberately generic so distractors can be reused without embedding misleading explanations; the brief and hint carry the teaching context.

## UI changes

`src/app/tutorial.tsx` will no longer mount `GlslInput` or autosave source drafts. It will add:

- a read-only code context view with the blank visually distinguished;
- four accessible answer buttons with selected, incorrect, correct, and disabled states;
- “Check answer” and “Skip” actions;
- concise feedback for incorrect, correct, and skipped outcomes;
- the existing target/learner previews, step navigation, and completion indicator.

The screen remains usable offline and with no authenticated profile. When no progress repository is available, the UI still functions, but completion is not durable—matching the existing repository contract.

## Persistence and release plumbing

`TutorialProgressRepository.setCompleted` remains the completion write path; no new table is required. Draft methods can remain for compatibility with existing database versions but are no longer called by the tutorial UI. Completion is written on both correct and skip paths, and the in-memory completed set updates optimistically as it does today.

The content schema, canonicalization, release installer, SQLite repository mapper, Supabase migration/query functions, and publishing tests must be updated together. The migration must preserve immutable release semantics and nested tutorial/step row counts.

## Content conversion

Convert each current step by choosing the smallest meaningful code span that addresses its task, replacing that span in the source with the marker, and authoring three plausible distractors. Numeric constants such as `0.25` should be choices in their own right. The correct substituted source must remain the existing target render. Existing briefs should be revised where necessary so they describe selecting a fragment rather than typing code.

## Testing

- Unit tests for template substitution, marker validation, choice validation, deterministic shuffle injection, and correct/incorrect/skip state transitions.
- Screen tests for target and learner sources, fixed order across retries, new order on reopen, feedback, skip completion, and persisted completion calls.
- Release/schema tests for malformed markers, wrong choice ids, duplicate choices, invalid substitutions, and round-trip storage through SQLite/Supabase-shaped payloads.
- Content checks (`npm run content:check`) and the full Jest suite after conversion.

## Out of scope

- Pixel-based grading or automatic render comparison.
- Multiple blanks in one step; a complex task should be split into sequential steps.
- Remote synchronization of tutorial completion.
- Generated distractors at runtime.
