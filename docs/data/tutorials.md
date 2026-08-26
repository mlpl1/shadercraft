# Tutorials

Lessons teach and grade nothing. Tutorials are where a learner is asked to build something, and
where they can get stuck. This document is the contract for authoring them.

If you are writing shader source for a tutorial step, read `shader-sandbox.md` first — every rule
there applies here too, to both of a step's two sources.

## The shape

A tutorial hangs off a module rather than sitting in a flat list, because it unlocks when **that
module** is complete. Modules carry an optional `tutorials` array; a module with no exercises omits
the key entirely rather than carrying an empty one, so "none" has exactly one representation.

```
CourseModule
└── tutorials?: Tutorial[]
    └── steps: TutorialStep[]
```

A step carries:

| Field | Required | What it is |
| --- | --- | --- |
| `title` | yes | Names the move, not the result. "Drive the radius from time", not "Step 2". |
| `brief` | yes | What to do and why. 25 words minimum. |
| `starterSource` | yes | What the editor is seeded with. A complete runnable body. |
| `solutionSource` | yes | The answer — **and the target render**. |
| `helpers` | no | GLSL declared above `mainImage`, shared by both sources. |
| `hint` | no | Offered before the learner gives up and reveals. |

## The solution is the target

There is no separate "expected image". The step's `solutionSource` compiles the reference render the
learner compares against **and** is what the Reveal control hands them. That is deliberate: a target
stored separately from the answer can drift from it, and the first anyone would know is a learner
chasing a picture the given solution does not produce.

Both previews compile through the same wrapper and share the step's `helpers`, so the only
difference between the two shaders is the body — which is exactly what the learner is changing.

## Nothing is checked

The learner decides when their render matches and marks the step done. There is no pixel comparison,
no tolerance, and no pass condition anywhere in the code.

This is a deliberate choice rather than a missing feature. Comparing renders automatically means
reading pixels back and picking a tolerance, and both are device-specific: too tight and correct
answers fail on some GPUs, too loose and wrong ones pass. Self-assessment costs the learner nothing
and cannot be wrong in a way they will not notice.

The consequence for authoring: **a step must be visually unambiguous**. If a learner cannot tell at a
glance whether their render matches, the step is badly specified, because nothing else will tell
them.

## Authoring rules

Enforced by `parseCourseRelease`, so a violation fails `content:build` rather than reaching a device:

- **Both sources obey the sandbox contract.** `solutionSource` is the easy one to forget — it is
  compiled every time the target renders, so a forbidden token there breaks the *reference* image
  and reads to the learner as their own mistake.
- **`starterSource` may not equal `solutionSource`.** A step whose answer is what it hands you
  teaches nothing, and this is the likeliest slip when a step is written by copying the one before.
- **No tutorials on a planned module.** It would be permanently unreachable rather than merely early,
  since a planned module can never be completed.
- **Ids are globally unique** across tutorials and steps, and positions are contiguous from 1.
- **`brief` is 25+ words, `summary` is 20+.** Lower than a stage body's 60 on purpose: a brief sets a
  task rather than explaining a shader, and padding it buries the ask. What it cannot be is a bare
  imperative.

Not enforced, and still required:

- **Stay inside the module's vocabulary.** A tutorial may use anything its own module or an earlier
  one introduced, and nothing later. Nothing checks this; the authoring pass for the existing seven
  verified it with a script that walks every call in every source against a cumulative allow-list.
- **Chain the steps.** Each step's `starterSource` should be the previous step's `solutionSource`, so
  a learner who reveals one still begins the next from working code.

## Progress

Completion is a per-step toggle the learner sets, stored in `tutorial_step_progress`. Drafts live in
`tutorial_step_drafts`, keyed by profile and step, and autosave debounced so a keystroke is not a
write.

Both are **local only**. `lesson_progress` syncs through the outbox; steps do not, because the outbox
and the remote schema know only about lessons. A reinstall loses which exercises were finished.
Teaching the sync path about steps is a separate change and has not been made.

Saved shader sketches follow the same rule: they are profile-scoped device data, not synced course
state. The Settings export action can write one sketch's exact GLSL source out as a `.frag` file,
but it does not make sketches, tutorial drafts, or tutorial completion part of the remote account
model.
