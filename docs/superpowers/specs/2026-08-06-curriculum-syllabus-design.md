# Curriculum Syllabus Design

Date: 2026-08-06
Status: approved design, not yet planned

## Summary

The existing curriculum is a prototype, not a baseline. Its concept sequencing is sound, but three
published modules carry 14 lessons averaging ~165 words and ~16 lines of GLSL each, teach randomness
and noise nowhere at all, and never once show a complete runnable shader. The code a lesson displays
is a hand-written paraphrase of a branch in a 440-line `u_mode` chain the learner cannot see, and
nothing validates that the two agree.

This design replaces it. All existing modules and lessons are discarded rather than migrated — the app
is pre-release with no progress worth preserving — and the syllabus is redesigned around the live
shader sandbox built in sub-project 1.

The course runs in two acts: seven 2D modules, then four 3D ray-marching modules. This spec commits
the full eleven-module arc and specifies Act 1 lesson by lesson. Act 2 gets its own spec once the
lesson format has been read by a real learner on a real device.

## Scope

### Included

- The complete eleven-module arc: titles, order, and learning goals.
- Act 1 in detail: seven modules, 32 lessons, each with its teaching goal and stage arc.
- The anatomy of a lesson, which is the contract the content schema must carry.
- Progression rules, and the constraint that forces sub-project 2 to land as a single change.

### Excluded

- Act 2 lesson and stage detail. Modules 8–11 ship as `planned` with real topic lists.
- The content schema implementation, the `lesson_stages` table, and the deletion of the old preview
  machinery. All of that is sub-project 2, which this spec constrains but does not design.
- The Tutorials section — exercises, targets, and per-module unlocking. Sub-project 3.
- Prose and shader source for individual stages. Those are authored against this spec, not in it.

## Guiding Decisions

1. **Lessons teach; exercises live in Tutorials.** A lesson asks nothing of the learner and grades
   nothing. An optional `tryThis` prompt may invite experimentation, but it has no target, no
   solution, and no check. This is why linear unlocking stays safe (see Progression).
2. **A lesson is built from progressive stages of one shader.** Three to five stages, each adding one
   idea, each carrying complete runnable source.
3. **Every stage's source is a complete `mainImage` body.** Not a fragment, not a diff.
4. **The full arc is committed; only Act 1 is detailed.** Specifying ray-marching lessons before a 2D
   lesson has been read on a phone is guesswork, and guessing is what made the old course thin.
5. **Randomness gets a whole module.** The old course name-dropped noise as a tool ("distance, noise,
   time, or a shape mask can all become `t`") while teaching it nowhere, deferring it to a module that
   never shipped. It is the gate to everything procedural.
6. **Antialiasing arrives with `fwidth`, at the point the problem first appears.** The old course
   correctly diagnosed that `step` shimmers, then prescribed hand-placed `smoothstep` thresholds that
   break under scaling, and never mentioned the actual fix.
7. **Progression stays strictly linear.** Unchanged from `isModuleUnlocked` and `isLessonUnlocked` in
   `src/data/course/domain.ts`.

## Lesson Anatomy

```
Lesson
├── title, position
├── intro          60–100 words: what this is for, why it matters
├── stages[3–5]
│   ├── title      e.g. "Threshold it into an edge"
│   ├── body       60–120 words explaining this stage
│   └── source     a complete, runnable mainImage body
├── takeaway       30–50 words: the thing to remember
└── tryThis?       optional prompt. No target, no solution, no check.
```

A lesson therefore runs **roughly 400–700 words plus 3–5 real shaders**, against the old average of
~165 words. The depth fix is a number, not an aspiration.

Three to five stages is a rule, not a preference: a lesson that seems to need six is teaching two
things and should be split. A lesson that needs only two is probably a stage of its neighbour.

### Why every stage carries complete source

The single most important property. It means the sandbox compiles a stage directly, the learner can
edit any stage and watch it run, and the code on screen *is* the code that renders.

The cost is duplication — stage 3 repeats most of stage 2 — and that is accepted deliberately. A
diff-based model would make individual stages un-runnable, require diff-application logic, and break
the moment a learner edits stage 2 before advancing.

### What leaves the schema

`previewKey`, `previewParameters`, `codeLines`, `highlightedLines`, `filename`,
`previewValueLabel`, and the preset concept entirely. Stages replace presets.

### Constraints every stage's source must satisfy

Set by the sandbox contract in `docs/data/shader-sandbox.md`:

- A `mainImage` body only. No `precision`, no `main()`, no `#version`.
- GLSL ES 1.00. No stage-level `in`/`out`; `texture2D` rather than `texture` if sampling ever arrives.
- `iResolution` (`vec3`) and `iTime` (`float`) are the only uniforms. No `iMouse`, `iFrame`, or
  `iTimeDelta`.
- No technique that a later lesson introduces.

## Act 1

Thirty-two lessons across seven modules.

### Module 1 — Fragments & Coordinates (5 lessons)

Goal: a learner understands what code runs where, and can put a deliberate colour at a deliberate
place.

1. **What a fragment shader is** — one function, run once per pixel, returning a colour.
2. **From pixels to UV** — `gl_FragCoord / iResolution.xy`, and why you normalise. Notes that other
   code calls this `u_resolution` and declares it `vec2`, so it appears there as `iResolution.xy`.
3. **Centre and aspect** — remap to −1…1, correct x by the aspect ratio, so circles stay round on any
   screen.
4. **Time as an input** — `iTime`, `sin` for motion, multiplying to control speed, and why elapsed
   seconds rather than frame count. Notes the `u_time` and `iGlobalTime` names found elsewhere.
5. **Reading shaders from elsewhere** — the complete program a `mainImage` body compiles into, and the
   conventions met outside this app.

Lesson 5 exists because the wrapper hides four things at once — `precision`, `main()`,
`gl_FragColor`, and the `mainImage` signature — so a learner who copies working code into a bare WebGL
page finds it does not compile and cannot see why. Its stages are: the body you write → the whole
program it becomes → the same shader in `u_*` naming → what changes under GLSL ES 3.00. It also
resolves the old course's oddity of teaching `gl_FragCoord.xy` in prose while every snippet wrote
`fragCoord`, and it is the first complete runnable shader a learner sees.

### Module 2 — Shaping Values (5 lessons)

Goal: a learner can turn any continuous measurement into a controlled visual signal.

1. **Hard edges with `step`** — a binary decision, and where it is the right tool.
2. **Soft edges with `smoothstep`** — a controllable transition, and where the two thresholds go.
3. **Blending with `mix`** — channel-wise interpolation, and that the design decision is the factor
   fed in, not the endpoints.
4. **Keeping values in range** — `clamp`, and what unbounded values actually break downstream.
5. **Remapping and easing** — moving between ranges, `pow` and `exp` curves, building a ramp by hand.

Lesson 4 closes a specific defect: the old Module 3 prose instructed the learner to "clamp when later
operations require a bounded signal", and `clamp` appeared in none of the 234 lines of shader code.

### Module 3 — Distance Fields (5 lessons)

Goal: a learner can describe a shape as a reusable field and give it any edge treatment.

1. **Distance as a field** — `length(p)`, signed versus unsigned, and why keeping the measurement
   continuous makes it reusable.
2. **A circle you control** — subtract a radius; parameterise position and size.
3. **Boxes and rounded boxes** — `abs` to mirror quadrants, `max` for the corner, and the rounding
   trick.
4. **Combining shapes** — `min` unites, `max` intersects, negation subtracts.
5. **Edges that survive scaling** — `fwidth` antialiasing, and why a hand-tuned `smoothstep` width
   breaks the moment the shape is scaled or the resolution changes.

### Module 4 — Colour (4 lessons)

Goal: a learner can drive colour from any scalar field the shader produces.

1. **Colour as three numbers** — `vec3`, the 0–1 range, and the gamma caveat stated rather than
   glossed.
2. **Mixing across space** — driving `mix` with a field instead of a constant.
3. **Brightness that matches vision** — Rec. 709 luma weights, contrast around a pivot, and clamping
   the result.
4. **Palettes as functions** — cosine palettes, their four parameters, and feeding them any scalar.

### Module 5 — Space (5 lessons)

Goal: a learner can transform, tile, and vary coordinate space before a shape is ever evaluated.

1. **Moving the coordinate system** — translation, and why it feels inverse to moving an object.
2. **Rotation and scale** — `mat2`, and why centring comes first.
3. **Polar coordinates** — `atan` and `length`, and angle-driven pattern.
4. **Tiling with `fract`** — folding the plane into repeating cells.
5. **Cell identity** — `floor` for a per-cell ID, deterministic per-cell variation, mirroring with
   `abs`.

### Module 6 — Randomness & Noise (5 lessons)

Goal: a learner can generate and shape procedural randomness. This is the module the old course
promised and never delivered.

1. **Deterministic randomness** — a hash from a coordinate, why `fract(sin(dot(...)))` works, and why
   determinism matters when there is no state between frames.
2. **Value noise** — a random value per cell, then interpolation, smoothed with the tools from Module
   2.
3. **Gradient noise** — random directions rather than random values, and why the result reads better.
4. **Fractal noise** — summing octaves; amplitude and frequency as the two controls.
5. **Domain warping** — feeding noise back into the coordinates.

### Module 7 — Composition (3 lessons)

Goal: a learner can assemble independent parts into one deliberate image.

1. **Layers and order** — an image as deliberately ordered masks.
2. **Masks as reusable signals** — one field, many treatments.
3. **Assembling a finished piece** — a complete composition walked through end to end.

### Not in Act 1

- Texture sampling. No sampler uniforms exist, and none are planned.
- Vertex shaders. The sandbox is fragment-only by design.
- Pointer interaction. `iMouse` was deliberately deferred in sub-project 1.
- Anything 3D.

## Act 2

Committed order and goals; lessons specified in a later spec. These ship as `planned` modules whose
`plannedTopics` are the goals below — real learning goals, which is the honest version of a rule that
previously forced Module 4 to invent two topic names as padding.

- **8 · Ray Marching** — the march loop; camera and ray setup; a 3D sphere; the hit test; depth.
- **9 · 3D Shape & Space** — box and torus SDFs; smooth minimum; repetition and transforms in 3D.
- **10 · Lighting & Materials** — normals by gradient; diffuse; specular; soft shadows; fog.
- **11 · Performance & Craft** — step count and precision; the cost of branching; knowing when to stop.

## Progression

Unchanged: strictly linear. A module unlocks when every prior module is complete
(`isModuleUnlocked`); lessons unlock in sequence within a module (`isLessonUnlocked`).

Strict gating is safe here specifically because lessons no longer test anybody. Completion is a
self-reported toggle with no assessment behind it, so gating on it communicates the intended order
rather than enforcing mastery — and since a lesson asks nothing of the learner, there is nothing to
get stuck on. The material that *can* stump someone is in Tutorials, which sits after the gate rather
than inside it.

The dependency chain is also genuine rather than administrative: no ray marching without SDFs, no SDFs
without `smoothstep`, no fractal noise without a hash. The order the gate enforces is the order the
subject requires.

## The Boot-Order Constraint

`DataProvider` will not mount children without a bundled release, and that release is generated from
`content/*.json` by `content:build`. Deleting the old content therefore breaks the app, and the new
schema is a breaking change because the release installer and course repository read `lesson_presets`
rows that stages replace.

There is no intermediate state where the app boots, so **sub-project 2 must land as one coherent
change**, not a sequence:

1. Schema: lessons carry `stages`; `presets` and `previewKey` validation removed.
2. Database: `lesson_stages` replaces `lesson_presets`; the migration chain collapses to a single
   version 1, which is free to do now and awkward later (every device wipes regardless).
3. Repository, release installer, and canonicalisation updated for stage rows.
4. `lesson-workspace.tsx` renders `ShaderSandbox` with stage navigation instead of a preset switcher.
5. Module 1 authored in the new format — 5 lessons, roughly 20 shaders — replacing `content/*.json`.
   The four old module files are deleted in this same step, because a release cannot be generated from
   a mix of both shapes.
6. Bundled release regenerated.
7. `preview-registry.ts`, `live-shader-preview.tsx` and `src/app/bonus-scanline.tsx` deleted.
   `bonus-scanline.tsx` is the only other consumer of the preview chain; its four `logo-*` shaders are
   reauthored as a tutorial in sub-project 3 or dropped.
8. Supabase `publish_course_release` and `get_course_release` updated, with their pgTAP tests.

The payoff is worth naming: after that lands, **modules 2–7 are pure content**. Each is authored JSON
plus a regenerated release — no app code, no store release. That is exactly what the curriculum
publishing pipeline was built for and has not yet been used for.

Because the app is pre-release with no installs, `minimumAppVersion` gating and surfacing
`requires-app-update` remain backlog items rather than prerequisites for this breaking change.

## Success Criteria

- Thirty-two Act 1 lessons exist with titles, teaching goals, and stage arcs.
- Every stage's source compiles under the sandbox contract: GLSL ES 1.00, `iResolution` and `iTime`
  only, no `precision` or `main()`.
- No lesson uses a technique a later lesson introduces.
- Every technique the old course taught has a home, plus randomness and noise, `fwidth`
  antialiasing, `clamp`, and a complete runnable program.
- Word targets met per lesson: intro 60–100, each stage body 60–120, takeaway 30–50.
- Modules 8–11 present as `planned` with topic lists drawn from real learning goals.

## Technical References

- `docs/data/shader-sandbox.md` — the authoring contract every stage's source must satisfy.
- `docs/superpowers/specs/2026-08-06-shader-sandbox-editor-design.md` — sub-project 1, which built the
  sandbox this syllabus targets.
- `src/data/course/domain.ts` — `isModuleUnlocked` and `isLessonUnlocked`, the progression rules this
  design leaves unchanged.
- `docs/data/local-curriculum.md` — the authoring rules sub-project 2 will rewrite.
