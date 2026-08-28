# Tutorials

Lessons teach and grade nothing. Tutorials ask the learner to complete a shader by choosing one of
four authored source fragments. This document is the contract for authoring them.

If you are writing shader source for a tutorial step, read `shader-sandbox.md` first. Every rule
there applies to the source produced by every answer choice, not only the correct one.

## The shape

A tutorial hangs off a module because it unlocks when that module is complete. Modules carry an
optional `tutorials` array; a module with no exercises omits the key rather than carrying an empty
array.

```
CourseModule
+-- tutorials?: Tutorial[]
    +-- steps: TutorialStep[]
```

A step carries:

| Field | Required | What it is |
| --- | --- | --- |
| `title` | yes | Names the move, not the result. "Drive the radius from time", not "Step 2". |
| `brief` | yes | What to do and why. 25 words minimum. |
| `sourceTemplate` | yes | A complete runnable body containing exactly one `/*__SHADERCRAFT_BLANK__*/` marker. |
| `answerChoices` | yes | Exactly four authored fragments: one correct answer and three unique, plausible mistakes. |
| `correctChoiceId` | yes | The id of the choice that reconstructs the target shader. |
| `helpers` | no | GLSL declared above `mainImage`, shared by every filled choice. |
| `hint` | no | Offered before the learner skips and reveals the correct answer. |

## The correct choice is the target

There is no separately authored target source or expected image. The app fills `sourceTemplate`
with the fragment named by `correctChoiceId`, then compiles that exact source for the reference
render. Selecting the same fragment therefore produces the same shader by construction.

Keep the blank as narrow as the concept permits. A one-expression decision should not hide a whole
shader, while a coherent multiline move may be one fragment when its declarations and result need
to stay together. Filling any of the four choices must leave a complete, runnable `mainImage`
body.

## Author all four choices

Choices are content, never runtime-generated variants. Give each one a stable id and a distinct GLSL
fragment. The three distractors should be mistakes a learner could reasonably make after the module:
swapped arguments, a missing coordinate transform, an inverted mask, or a fixed width where a
pixel-scaled width is required. Avoid arbitrary syntax errors and joke answers.

The schema validates the four filled sources against the sandbox contract, and the on-device Shader
Audit compiles every `choice:<choice-id>` substitution against the real GL driver. A correct target
that compiles does not excuse a broken distractor; every option can reach the learner preview.

## Choice order and checking

The app shuffles the four choices once when a step screen is visited. That order remains fixed while
the learner retries, so a wrong answer does not move underneath them. A later visit shuffles again.
Authored order must therefore carry no meaning, and logic must use choice ids rather than positions.

Checking a selected correct choice completes the step. An incorrect choice leaves the step available
for another attempt. "Skip and reveal answer" selects the correct fragment, shows it, and also
completes the step. There is no pixel comparison or tolerance: correctness is the authored
`correctChoiceId`.

## Authoring rules

Enforced by `parseCourseRelease`, so a violation fails `content:build` rather than reaching a
device:

- `sourceTemplate` contains exactly one blank marker.
- `answerChoices` contains exactly four entries with unique ids, non-blank fragments, and distinct
  rendered sources.
- `correctChoiceId` resolves to one of those four entries.
- Every filled source and optional helper obeys the shader sandbox contract.
- Planned modules do not carry tutorials.
- Tutorial and step ids are globally unique, and positions are contiguous from 1.
- A `brief` has at least 25 words and a tutorial `summary` has at least 20.

Not enforced, and still required:

- Stay inside the module's vocabulary. A tutorial may use anything its own module or an earlier one
  introduced, and nothing later.
- Keep the target visually unambiguous so a learner can understand what the correct fragment changes.
- Preserve existing tutorial and step ids when revising content; progress is keyed by step id.
- When converting an older target, verify that filling the correct fragment reproduces the former
  shader byte-for-byte. Narrow the blank if it does not.

## Progress

Completion is stored locally per profile and step in `tutorial_step_progress`. Tutorial exercises
have no editable draft, autosave, or persisted source: the learner selects from the authored choices
and retries in place. Lesson progress syncs remotely; tutorial-step completion remains device-local.

Saved shader sketches are separate profile-scoped device data. The Settings export action can write
one sketch's exact GLSL source to a `.frag` file, but sketches and tutorial completion are not part
of the remote account model.

## Release workflow

Authored tutorial changes are immutable course-content changes. Bump `BUNDLED_RELEASE_ID` once,
run `npm run content:build`, and commit the regenerated
`assets/course/bundled-course.json`. Finish with `npm run content:check` so the checked-in bundle
is proven current.
