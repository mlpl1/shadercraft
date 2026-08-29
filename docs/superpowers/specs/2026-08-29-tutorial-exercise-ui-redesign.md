# Tutorial Exercise UI Redesign

## Goal

Turn the tutorial exercise screen into a focused mobile learning flow. The learner should understand the challenge, inspect the relevant code, choose a concept-level answer, confirm it, understand the result, and continue without scanning a long undifferentiated page.

The selected visual direction is the Superdesign draft “Shadercraft Tutorial Redesign” (`63a3c474-7ef3-47ae-b167-259beef9c048`). It keeps Shadercraft’s dark technical identity while adding clearer progress, tactile choices, contextual feedback, and a stable action dock.

## Scope

This redesign changes the presentation and state-dependent layout of `src/app/tutorial.tsx` and supporting tutorial UI components. It does not change tutorial content, answer randomization, answer correctness, progress persistence, shader compilation, or navigation identifiers.

## Experience structure

### Header

- Replace the text-like back link with an accessible back control that still includes the tutorial/module title.
- Show a segmented progress rail with one segment per step.
- Completed steps use lime, the current step uses cyan or a clearly distinct active treatment, and future steps use the raised surface color.
- Keep the header compact and sticky only if it does not reduce usable vertical space on small Android screens.

### Challenge

- Show the step title as the main heading and the brief immediately below it.
- Preserve inline code emphasis where it can be derived safely from authored text; do not invent parser-driven rich text in this pass.
- Completed status is communicated by the progress rail and feedback state rather than a detached badge beside the title.

### Code card

- Move the source template before previews and answer choices.
- Render it in a raised, rounded code card with comfortable monospace line height.
- Before confirmation, emphasize the blank as the task’s focal point.
- Selecting a choice highlights the corresponding answer tile but does not fill the code blank or update the learner preview.
- Confirming fills the code fragment. Correct uses lime; incorrect uses coral; skipped uses a neutral/revealed treatment.
- Any pulse treatment must respect reduced-motion settings and should be omitted if no existing motion preference is available.

### Answer choices

- Keep four randomized choices.
- Prefix them with stable display markers A–D based on their current shuffled order; these markers are not persisted and do not affect correctness.
- Each tile has a minimum 52px touch height, a monospace fragment, and explicit selected/correct/incorrect text or iconography in addition to color.
- Pending selection uses cyan. Confirmed correct uses lime. Confirmed incorrect uses coral.
- After terminal success or skip, non-selected options de-emphasize but remain legible.

### Feedback and previews

- Do not render an empty “Yours” preview before the first confirmation.
- After confirmation, reveal a compact comparison section with Target and Yours side by side when width permits. On very narrow screens, preserve usable preview dimensions while keeping the two labels explicit.
- Incorrect feedback explains that the rendered result came from the confirmed choice and invites another attempt.
- Correct feedback includes a short authored hint/explanation when available. Do not fabricate GLSL explanations from answer text.
- Skip reveals the correct fragment, target comparison, and a neutral “Answer revealed” message.

### Bottom action dock

- Add a stable bottom dock inside the safe area.
- Initial state: primary Confirm button disabled until a choice is selected; Hint and Skip remain secondary actions.
- Incorrect state: primary action remains Confirm after another choice is selected; the learner may retry.
- Correct state: primary action becomes Continue and advances to the next step. On the final step it returns to the tutorial list.
- Skipped state: primary action becomes Continue with the same navigation behavior.
- Previous-step navigation moves to a small secondary control near the header or action dock; remove the large duplicate Previous/Next button row.

## State model

The existing state remains authoritative:

- `selectedChoiceId` is the pending selection.
- `confirmedChoiceId` is the fragment applied to the code and preview.
- `feedback` is `idle`, `incorrect`, `correct`, or `skipped`.
- Completion persists only for correct or skipped terminal states.

Derived presentation states:

1. **Unselected:** blank code, no learner preview, Confirm disabled.
2. **Selected:** cyan answer tile, blank code, no learner preview, Confirm enabled.
3. **Incorrect:** coral confirmed tile and code fragment, comparison visible, retry guidance; selecting another tile returns controls to a pending retry without changing the confirmed preview.
4. **Correct:** lime tile and code fragment, comparison and explanation visible, controls locked, Continue enabled.
5. **Skipped:** correct fragment revealed, comparison visible, neutral reveal feedback, controls locked, Continue enabled.

## Component boundaries

- `TutorialScreen` continues to own navigation, answer state, persistence, and step transitions.
- `TutorialSourceTemplate` gains explicit visual state props rather than inferring all styling from fragment presence.
- Extract small presentational components only where they reduce complexity: segmented progress, answer tile, feedback/comparison section, and bottom action dock. They receive data and callbacks; they do not own correctness or persistence.
- `ShaderSandbox` remains unchanged unless a purely visual radius/container prop is necessary. Prefer wrapping it rather than expanding its API.

## Accessibility

- Preserve button roles and selected/disabled states.
- Answer labels include their A–D marker, fragment, and status.
- Feedback is announced as a live-region/accessibility alert where React Native support permits.
- Do not rely on color alone.
- Maintain at least 44px controls and sufficient contrast using existing tokens.
- The fixed dock must not cover scroll content; content receives matching bottom padding plus safe-area inset.

## Error and edge handling

- Missing tutorials retain the existing recoverable Back state.
- A shader compile failure continues to use `ShaderSandbox`’s placeholder behavior.
- A tutorial with one step renders one full progress segment and routes Continue back to the tutorial list.
- Long answer fragments wrap without pushing status icons outside the tile.
- Existing optimistic completion and profile isolation remain unchanged.

## Testing

- Update tutorial screen tests for initial, selected, incorrect, correct, skipped, retry, Continue, and final-step navigation states.
- Add presentational tests for progress segments, A–D markers, hidden pre-confirmation previews, code-fragment status styling, and dock actions.
- Preserve tests proving that selection alone does not fill code or update previews.
- Run focused tutorial tests, full Jest, content validation, TypeScript, and Android/web visual inspection where available.

## Acceptance criteria

- The initial viewport prioritizes challenge, code, and choices; it contains no empty learner preview.
- Confirm remains the only action that applies a selected fragment.
- Feedback and previews appear only after confirmation or reveal.
- A single stable primary action guides Confirm → retry/Confirm → Continue.
- All 21 exercises use the same state-driven layout without content-specific UI branches.
- Existing completion persistence, randomized choices, correctness, and target shader output remain intact.
