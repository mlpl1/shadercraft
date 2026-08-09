# Act 2 syllabus design — modules 8 to 11

## Why now

`docs/superpowers/specs/2026-08-06-curriculum-syllabus-design.md` committed the eleven-module arc but
deliberately left Act 2's lessons unwritten: "specified in a later spec", because specifying
ray-marching lessons before a 2D course existed would have been guessing at what a learner arrives
knowing. Act 1 now exists — seven modules, 32 lessons, 128 stages — and has been walked on a device.
This is that later spec.

It covers **the sixteen lessons of modules 8 to 11**. Tutorials for those modules are deliberately
excluded (see Not in scope), the same order Act 1 was built in: modules first, exercises afterwards
against lessons that already exist.

## What was verified before designing

Act 2 rests on shader features Act 1 never used, so they were compiled on the real driver before any
of this was written rather than assumed. A representative ray marcher — helper functions calling
helper functions, a 64-iteration loop with two `break` statements, `normalize`, `dot`, vec3 swizzles
(`e.xyy`), and an `if` block in the body — compiles and links on the Android emulator's GL stack.

That settles the structural question: **Act 2 needs no app change.** Unlike Module 3, which needed
the `GL_OES_standard_derivatives` directive, and Module 6, which needed the per-stage `helpers`
field, Act 2 ships as authored JSON plus a regenerated release. The capability it depends on already
landed for Module 6.

## Decisions

### The camera is driven by time, not touch

3D wants a camera you can move, and `iMouse` was considered. It was rejected because a lesson is one
long scrolling article in which roughly 40% of the height is preview: if dragging a preview orbited
the camera, previews would become scroll dead-zones exactly where a thumb lands. On a phone that is a
worse daily cost than a fixed camera.

Act 2 cameras therefore orbit on `iTime`, like every animated stage since Module 1. The learner sees
every side of a shape without touching anything, and the sandbox contract is unchanged: `iResolution`
and `iTime`, nothing more.

### Cost is taught by rendering it

Module 11 is about step count, precision and branching, but the sandbox exposes no timing, so a
learner cannot observe cost directly. Adding a frame-time readout was rejected for the same reason as
`iMouse` — app work — and because the number would be meaningless: four previews on one page each run
their own march loop, and emulator figures swing wildly.

Instead the march's **step count is painted per pixel as a heatmap**. Cost stops being an assertion
and becomes an image: silhouettes glow, grazing rays are expensive, empty space is cheap, and
tightening the hit threshold visibly lights the whole outline. This is a standard ray-marching
diagnostic and needs no capability the sandbox lacks.

### Independent modules, one closing assembly

Each module stands alone and is reviewable on its own — the Course tab is used that way — but Act 2
ends on a finished, lit, optimised scene. This mirrors Act 1 exactly, where Modules 1–6 were
independent and Module 7 assembled them.

Act 2's assembler is Module 11, which fits better than it first appears: "knowing when to stop" is
precisely the lesson where you look at a complete scene and decide it is done. Judgement needs
something concrete to be exercised on.

### The prelude carries the machinery, the body carries the idea

3D has heavy fixed machinery — camera, march loop, normals — and repeating it inside every stage's
`source` would bury each lesson in boilerplate. Instead each module carries a **stable prelude** in
every stage's `helpers`, and the body changes only what that lesson is about.

| Module | Prelude gains |
| --- | --- |
| 8 | `sdSphere`, `map`, `march` |
| 9 | `sdBox`, `sdTorus`, `smin` |
| 10 | `normalAt`, `lighting` |
| 11 | step-counting instrumentation |

The prelude is **repeated in full in each stage rather than referenced**, because a stage must
compile alone — the same duplication `source` already accepts between neighbouring stages, and for
the same reason: the code on screen is the code that renders.

The payoff is that a stage's diff is the lesson. Module 10's specular stage differs from its diffuse
stage by one term, not by thirty lines of camera setup.

## The lessons

Sixteen lessons. The schema allows three to five stages each; Act 1 settled on four everywhere, and
Act 2 plans for the same, so **64 stages** is the working figure rather than a rule. A lesson that
genuinely needs five takes five.

### Module 8 · Ray Marching (5 lessons)

Goal: a learner can march a ray through space and find where it hits a 3D shape.

The committed `plannedTopics` order was `march loop → camera → sphere`. **This spec reorders the
first three**, because as committed lesson 1 depends on lessons 2 and 3: you cannot march before you
have a ray, and you cannot see a sphere before you march. The topics are unchanged; only their order
is.

That reorder has a concrete consequence: `content/module-08-raymarching.json` currently ships those
topics in the old order, and a learner can read them today on the Course tab's roadmap card. Its
`plannedTopics` array must be reordered to match before or alongside authoring, so the roadmap never
promises a different order from the one that arrives.

1. **Camera and ray setup** — one ray per pixel, from an origin through an image plane. Nothing
   marches yet; the ray direction is painted as colour, which is both a real picture and a real check
   that the rays fan out the way they should.
2. **A 3D sphere** — `length(p) - r` in three dimensions, evaluated on a fixed depth slice so the
   shape is visible as a cross-section without marching. Module 3's field, one dimension up.
3. **The march loop** — step along the ray by the distance the field says is safe. The sphere
   appears, and the reason the algorithm is called sphere tracing becomes visible.
4. **The hit test** — the threshold, the step ceiling and the far plane, and what each one gets wrong
   when set badly: banding, dissolved silhouettes, shapes that vanish at distance.
5. **Depth** — shade by `t`. The marcher knows *how far*, not merely *whether*, and that number is
   worth something on its own.

### Module 9 · 3D Shape & Space (3 lessons)

Goal: a learner can describe and combine three-dimensional shapes in ray-marched space.

1. **Box and torus SDFs** — `abs` and `max` in 3D, unchanged in spirit from Module 3's box; the torus
   as a distance measured from a distance.
2. **Smooth minimum** — `min` welds two shapes with a visible crease; `smin` blends them into one
   surface. This is the lesson Act 1 deliberately withheld, which is why Module 7's composition used a
   plain `min`.
3. **Repetition and transforms in 3D** — `fract` on a 3D coordinate gives infinite copies for the cost
   of one, and the same inverse rule from Module 5 applies to a coordinate with three components.

### Module 10 · Lighting & Materials (5 lessons)

Goal: a learner can light 3D surfaces with normals, shading, shadows and fog.

1. **Normals by gradient** — the surface direction recovered from four extra `map` calls. Painted as
   colour first, because a normal is an image before it is an input.
2. **Diffuse** — `dot(n, l)`: Module 4's dot product returning to do geometry rather than luma.
3. **Specular** — the highlight, and why it moves with the viewer when diffuse does not.
4. **Soft shadows** — march from the surface toward the light; the closest approach along that march
   gives softness for no extra structure.
5. **Fog** — distance turned into colour, which is Module 4's `mix` driven by Module 8's depth.

### Module 11 · Performance & Craft (3 lessons)

Goal: a learner can keep ray-marched shaders fast and precise, and can tell when a shader is done.

1. **Step count and precision** — the heatmap. Where the marcher works hardest, and what tightening
   the threshold costs.
2. **The cost of branching** — a branch on a uniform is free; a branch that differs between
   neighbouring pixels is not, because they execute together. Shown as cost rather than asserted.
3. **Knowing when to stop** — the closing assembly: the finished lit scene, judged and trimmed.

## Constraints that bite

- **Vocabulary is cumulative and forward references are forbidden.** Act 2 may use anything Act 1
  introduced plus what its own earlier lessons introduce. New to Act 2: `normalize`, `reflect`, 3D
  swizzles, and constant-bound loops with `break`. Nothing checks this automatically; the Act 1
  authoring passes verified it with a script walking every call against a cumulative allow-list, and
  Act 2 must do the same.
- **`smin` belongs to Module 9.** No earlier module may use it, and Module 7 already respects this.
- **Loop bounds must be compile-time constants.** GLSL ES 1.00 requires it. `break` is permitted and
  was verified on device.
- **The sandbox contract is unchanged.** `iResolution` and `iTime` only; no `#version`, no
  `precision`, no `#extension` in authored content.
- **Word floors are unchanged**: intro 60+, stage body 60+, takeaway 30+. Three to five stages per
  lesson.
- **Every numeric render claim is computed, not described.** Six prose-versus-render defects have been
  found so far, one of them introduced while fixing another. 3D arithmetic is harder to hold in the
  head than 2D, so this matters more here, not less.
- **The release id and content move together.** A device that installed an id rejects a different
  checksum under that id permanently.

## Verification

Per commit:

```
npm run content:build
npm run content:check
npm test
npx tsc --noEmit
```

Then on a device, which is the only thing that can catch a shader that does not compile:

```
adb uninstall com.anonymous.shadercraft
npm run android
```

Open the `shader-audit` route, which compiles every source the release contains through one real GL
context and reports failures. It sweeps 170 sources today and will sweep 234 once Act 2 lands. A stage
that fails to compile is otherwise invisible: `LessonStageBlock` passes no `onCompileResult`, so a
broken stage renders as an empty preview and logs nothing.

Compilation is not correctness. Claims that only eyes can settle — the step-count heatmap lighting up
silhouettes, `smin` removing a crease that `min` leaves, a normal painted as colour matching the
surface it describes — need visual spot-checks.

`LESSONS_PER_PUBLISHED_MODULE` in `src/data/course/__tests__/bundled-course.test.ts` gains one entry
per module as it publishes, reaching `[5, 5, 5, 4, 5, 5, 3, 5, 3, 5, 3]` when Act 2 is complete. That
constant also enforces something worth keeping: published modules must form a prefix of the syllabus,
so modules 8 to 11 publish in order rather than whichever is finished first.

## Not in scope

- **Tutorials for modules 8–11.** Their own smaller piece, written against finished lessons — the
  order Act 1 followed.
- **`iMouse`**, and any touch-driven camera. See Decisions.
- **A frame-time readout.** See Decisions.
- **Surfacing `requires-app-update`.** The sync engine computes it and refuses incompatible content
  correctly; nothing shows the learner why. A real gap, unrelated to Act 2.
- **Tutorial progress sync.** Step completion is local-only.

## Success criteria

- Sixteen lessons exist across modules 8 to 11, each with an intro, three to five stages and a
  takeaway meeting the word floors.
- Every stage's source compiles under the sandbox contract, proven by the `shader-audit` sweep rather
  than by inspection.
- No lesson uses a technique a later lesson introduces, verified mechanically against a cumulative
  allow-list.
- Module 11 renders cost rather than describing it.
- Act 2 ships as content only: no app code, no schema change, no store release.
