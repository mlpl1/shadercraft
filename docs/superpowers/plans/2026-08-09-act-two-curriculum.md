# Act 2 Curriculum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author modules 8 to 11 — sixteen ray-marching lessons, roughly 64 stages — as content only, so Act 2 ships as authored JSON plus a regenerated release with no app code.

**Architecture:** Each module is one `content/module-NN-*.json` file switched from `planned` to `published`. Every stage carries a complete runnable `mainImage` body in `source` and its module's stable machinery in `helpers`. Modules publish in order, because `LESSONS_PER_PUBLISHED_MODULE` enforces that published modules form a prefix of the syllabus.

**Tech Stack:** GLSL ES 1.00 (no `#version`), authored JSON validated by `parseCourseRelease`, Jest, TypeScript, `expo-gl` on device for the compile sweep.

**Spec:** `docs/superpowers/specs/2026-08-09-act-two-syllabus-design.md`

## Global Constraints

- **No app code.** Act 2 is content plus the release-id bump and the test constant. A task that finds itself editing `src/` outside `src/data/course/__tests__/bundled-course.test.ts` has hit something the spec did not anticipate — stop and report rather than widening scope.
- **Sandbox contract:** GLSL ES 1.00. Uniforms are `iResolution` (vec3) and `iTime` (float) only. Forbidden as bare substrings anywhere in `source` or `helpers`: `#version`, `#extension`, `precision`, `void main(`, `gl_FragColor`, `texture(`, `iMouse`, `iFrame`, `iTimeDelta`. A GLSL comment containing the word "precision" fails the build.
- **`helpers` must not contain `mainImage`** — the schema rejects it, because a stage redefining it would link-fail on device.
- **Word floors:** lesson `intro` 60+ words, each stage `body` 60+ words, lesson `takeaway` 30+ words. Floors, not targets; there are no ceilings.
- **Stages per lesson:** 3 to 5, enforced. Four is the Act 1 norm and Act 2's plan.
- **Positions are contiguous from 1** within modules, lessons and stages. Ids are globally unique, lowercase, hyphen-separated, matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`.
- **A published module** must have at least one lesson and `plannedLessonCount: 0` with `plannedTopics: []`.
- **Loop bounds must be compile-time constants.** `for (int i = 0; i < 64; i++)` is valid; `break` is permitted and was verified on device.
- **No forward references.** A lesson may use only what Act 1 introduced plus what earlier Act 2 lessons introduced. `smin` belongs to Module 9 and may not appear in Module 8.
- **Every numeric render claim is computed, not described.** Nine prose-versus-render defects have been found so far, two of them introduced while fixing another.
- **A silhouette is where the march STOPS, not where it converges.** The prelude's `march`
  returns `t` and the body tests `t < 20.0`, which accepts a 64-step march that never reached
  `d < 0.001` as a hit. Measure any "where is the edge" claim with the same predicate the
  shader uses — `t < 20.0` — not by strict convergence. The two differ by around 7×10⁻⁴, which
  is invisible on screen but silently moves the fourth decimal of every silhouette figure, and
  only shows up when two independent transcriptions are compared.
- **Sample real pixels, not the axes.** The preview is 200px tall, so rows sit at
  `p.y = ±0.005, ±0.015, …` — **`p.y = 0` is never a row**. Columns are offset by
  `0.005 − W/200 (mod 0.01)`, which is 0.005 on an even preview width and **0.000 on an odd
  one**: 280, 320 and 480 px are even, but 371px (the 411dp test emulator) is odd, so `p.x = 0`
  is a column there and is not one anywhere else. A figure measured on an axis can be off by a
  fraction of a pixel — invisible, but wrong, and wrong differently per device. Prefer a claim
  that does not depend on which pixel you landed on; if you must quote one, quote it as a
  device-named pair like every other horizontal figure. **Never quote a rim or silhouette
  pixel**: near a tangency the sampled column moves the value by more than the rounding.
- **Quote only what float32 supports.** The sandbox prepends `precision highp float;`
  (`src/shaders/shader-source.ts:23`), so the driver computes in float32 while your harness
  computes in double. Sphere tracing self-corrects, so a marched `t` is robust — but a
  **central difference is not**: `map` returns `length(p) − 1` near 1.0008, each call is
  quantised to one float32 ulp at 1.0 (1.1921e-7), and dividing by `2·ε` amplifies that into a
  ~3e-5 lattice on the painted value. A figure sitting within a quarter-quantum of a rounding
  boundary renders either way on a real device. **Check anything quoted past three decimals
  under a full `Math.fround`-per-operation model as well as in double, and drop to a precision
  both agree on.** Three decimals has been safe everywhere so far.
- **Derive the pixel coordinate the way the shader does, not algebraically.** `p.x = ((i+0.5)/W·2−1)·(W/H)`
  and the shortcut `(2i+1−W)/200` are equal in reals and **not** in float32: at W = 280 column 93
  they differ in the seventh decimal, and they disagree on 160 of 280 columns and 104 of 200 rows.
  A harness that takes the shortcut produces float32 values no driver will ever compute, and the
  error is invisible on `p.x = 0` — where the aspect multiply is exact — so a calibration anchor
  scanned up the centre column is structurally blind to it. Address pixels by index through the
  real `uv → p` chain.
- **Any figure attached to a frame-wide extremum needs a width dimension.** The extremum's
  *location* moves between grids even when its *value* rounds the same: Module 11's brightest
  pixel is (0.355, 0.385) at 24 steps on 280/320/480 and (0.360, 0.385) at 29 steps on 371.
- **Bisect with care, or do not bisect.** A distance field is not monotone in the radius, so a
  bisection over a wide bracket can latch a crossing that is not the silhouette. A fine linear
  scan found the true single hit→miss flip where a bisection over [0, 1.2] was wrong by 7×10⁻⁶.

- **The frame is a landscape band, and its width is not a constant.** A lesson preview is
  `PREVIEW_HEIGHT = 200`dp tall (`src/components/lesson-stage-block.tsx:8`) and as wide as the content
  column, `min(screenWidth, 520) − 40` (`src/components/lesson-workspace.tsx:372,378`). Measured:

  | device width | preview | aspect |
  | --- | --- | --- |
  | 320dp (small phone) | 280 × 200 | 1.40 |
  | 360dp (common Android floor) | 320 × 200 | 1.60 |
  | 411dp (test emulator) | 371 × 200 | 1.857 |
  | ≥560dp (column capped) | 480 × 200 | 2.40 |

  After `p.x *= iResolution.x / iResolution.y`, `p.y` runs −1..1 on every device but **`p.x` runs
  ±1.40 to ±2.40**. Module 8 was first authored against a portrait frame at ±0.5625 and every
  horizontal claim in it had to be rewritten; do not repeat that.

  **Anchor horizontal claims at `p.x = ±1.0`**, which is on screen at every width in the table. Do
  not anchor at ±1.5: it holds from 360dp up but falls off a 320dp screen. Never anchor at a frame
  edge or corner — those move with the device.

  | Safe to claim | Not authorable |
  | --- | --- |
  | Anything in `p` units — radii, offsets, `t` values | Any specific horizontal distance |
  | Vertical claims: `p.y` is ±1 on every device | Corner colours and corner distances |
  | `uv`-space claims — `uv` is 0..1 on both axes | A side-edge value given as one number |
  | A side-edge value given as a device-named pair: "0.731 on the narrowest phone, 0.530 on the widest" | "N per cent of the way to the side edges" |
  | "never reaches the side edges" below 1.40 | "runs off both side edges" below 2.40 |
  | "reaches the top and bottom edges" at extents ≥ 1 | Any number derived from one device's aspect |
  | "a landscape band, 1.4 to 2.4 times as wide as it is tall" | "roughly twice as wide as it is tall" |

  Two traps inside the safe column. A **side-edge midpoint is not the frame's extremum** — the
  corner is further out on both axes, so "0.731 at the side edge" does not answer "what is the
  lowest value on screen". Say which traverse you mean. And a **bound quoted at the narrow end
  must be rounded away from the value, not toward it**: 3.49833 is not "3.50 or more".

  A shape must exceed **1.40** in `p` units before it can clip horizontally on ANY device, and exceed
  **2.40** before it clips on ALL of them. Between those two figures the answer depends on the phone,
  so no clipping claim is authorable there.
- **Bump `BUNDLED_RELEASE_ID`** in `scripts/content/release-metadata.ts` in the same commit as any content change. A device that installed an id rejects a different checksum under that id permanently. Current value: `bundled-2026-08-09-3`.
- **Do not run `npm run content:publish`.** Publishing to the linked Supabase project is the user's call.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `content/module-08-raymarching.json` | Module 8, 5 lessons. Reorder `plannedTopics` first (Task 1), then author. |
| `content/module-09-3d-shape.json` | Module 9, 3 lessons. |
| `content/module-10-lighting.json` | Module 10, 5 lessons. |
| `content/module-11-performance.json` | Module 11, 3 lessons. |
| `scripts/content/release-metadata.ts` | `BUNDLED_RELEASE_ID`, bumped per content commit. |
| `src/data/course/__tests__/bundled-course.test.ts` | `LESSONS_PER_PUBLISHED_MODULE`, one entry per published module. |
| `assets/course/bundled-course.json` | Generated by `npm run content:build`. Never hand-edited. |
| `scripts/content/__scratch__/verify-act2.mjs` | Vocabulary and floor checker used by every authoring task. Created in Task 1, deleted in Task 6. |

---

### Task 1: Reorder Module 8's roadmap and build the verification script

Module 8's `plannedTopics` currently promise `march loop → camera → sphere`, an order the spec reorders because lesson 1 would depend on lessons 2 and 3. Learners can read that roadmap card today, so it is corrected before any authoring. This task also builds the checker every later task runs.

**Files:**
- Modify: `content/module-08-raymarching.json` (`plannedTopics` array only)
- Create: `scripts/content/__scratch__/verify-act2.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `node scripts/content/__scratch__/verify-act2.mjs` — exits 0 when every published module passes, prints one line per violation and exits 1 otherwise. Tasks 2 to 5 run it before committing.

- [ ] **Step 1: Reorder the planned topics**

Edit `content/module-08-raymarching.json` so `plannedTopics` reads exactly:

```json
  "plannedTopics": [
    "Camera and ray setup",
    "A 3D sphere",
    "The march loop",
    "The hit test",
    "Depth"
  ],
```

`plannedLessonCount` stays `5`. Nothing else in the file changes.

- [ ] **Step 2: Bump the release id**

`plannedTopics` is part of the release payload, so this changes the checksum. In
`scripts/content/release-metadata.ts` set:

```ts
export const BUNDLED_RELEASE_ID = "bundled-2026-08-09";
```

- [ ] **Step 3: Rebuild and verify**

Run: `npm run content:build && npm run content:check`
Expected: `Wrote ...bundled-course.json` then `Bundled course is up to date.`

- [ ] **Step 4: Write the verification script**

Create `scripts/content/__scratch__/verify-act2.mjs`:

```js
// Checks the two rules nothing else enforces: cumulative vocabulary (no lesson may use a function a
// later lesson introduces) and the word floors, reported per-field rather than as a build failure.
// Deleted in Task 6 — this is authoring scaffolding, not shipped tooling.
import { readFileSync, readdirSync } from "node:fs";

const INTRODUCED_BY_MODULE = {
  1: ["length", "sin", "cos"],
  2: ["step", "smoothstep", "mix", "clamp", "pow", "exp"],
  3: ["abs", "min", "max", "fwidth"],
  4: ["dot"],
  5: ["mat2", "atan", "fract", "floor", "mod"],
  6: [],
  7: [],
  8: ["normalize"],
  9: [],
  10: ["reflect"],
  11: [],
};

const ALWAYS = ["vec2", "vec3", "vec4", "mat2", "mat3", "float", "int", "bool", "return", "if", "for"];

const wordCount = (value) => value.trim().split(/\s+/).filter(Boolean).length;

const files = readdirSync("content").filter((name) => name.startsWith("module-")).sort();
const allowed = new Set(ALWAYS);
let problems = 0;
const report = (message) => {
  console.log(message);
  problems += 1;
};

for (const file of files) {
  const module = JSON.parse(readFileSync(`content/${file}`, "utf8"));
  for (const name of INTRODUCED_BY_MODULE[module.position] ?? []) allowed.add(name);
  if (module.status !== "published") continue;

  for (const lesson of module.lessons) {
    if (wordCount(lesson.intro) < 60) report(`SHORT intro ${lesson.id} ${wordCount(lesson.intro)}`);
    if (wordCount(lesson.takeaway) < 30) report(`SHORT takeaway ${lesson.id} ${wordCount(lesson.takeaway)}`);

    for (const stage of lesson.stages) {
      if (wordCount(stage.body) < 60) report(`SHORT body ${stage.id} ${wordCount(stage.body)}`);

      const declared = new Set(
        [...(stage.helpers ?? "").matchAll(/^\s*(?:float|vec2|vec3|vec4|mat2)\s+(\w+)\s*\(/gm)].map((m) => m[1]),
      );
      for (const text of [stage.helpers ?? "", stage.source]) {
        for (const call of new Set([...text.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)].map((m) => m[1]))) {
          if (!allowed.has(call) && !declared.has(call)) {
            report(`VOCAB ${call} in ${stage.id} (module ${module.position})`);
          }
        }
      }
      for (const name of declared) {
        const usedInHelpers = (stage.helpers ?? "").split(`${name}(`).length - 1 > 1;
        if (!usedInHelpers && !stage.source.includes(`${name}(`)) {
          report(`DEAD HELPER ${name} in ${stage.id}`);
        }
      }
    }
  }
}

console.log(problems === 0 ? "act2 checks pass" : `act2 problems: ${problems}`);
process.exit(problems === 0 ? 0 : 1);
```

- [ ] **Step 5: Run it against the existing seven modules**

Run: `node scripts/content/__scratch__/verify-act2.mjs`
Expected: `act2 checks pass` and exit 0. Act 1 already satisfies both rules, so a failure here means the script is wrong, not the content — fix the script before continuing.

- [ ] **Step 6: Run the suite and commit**

```bash
npm test && npx tsc --noEmit
git add content/module-08-raymarching.json scripts/content/release-metadata.ts \
  scripts/content/__scratch__/verify-act2.mjs assets/course/bundled-course.json
git commit -m "content(module-08): reorder the roadmap to the order the lessons arrive in"
```

---

### Task 2: Author Module 8 — Ray Marching

**Files:**
- Modify: `content/module-08-raymarching.json`
- Modify: `scripts/content/release-metadata.ts` (`BUNDLED_RELEASE_ID`)
- Modify: `src/data/course/__tests__/bundled-course.test.ts` (`LESSONS_PER_PUBLISHED_MODULE`)

**Interfaces:**
- Consumes: `verify-act2.mjs` from Task 1.
- Produces: the Module 8 prelude that Tasks 3 to 5 extend — `sdSphere(vec3 p, float r)`, `map(vec3 p)`, `march(vec3 ro, vec3 rd)`. Later modules copy these verbatim into their own `helpers` and add to them.

- [ ] **Step 1: Set the module to published**

In `content/module-08-raymarching.json` set `"status": "published"`, `"plannedLessonCount": 0`, `"plannedTopics": []`, and populate `lessons`. Keep `id`, `position`, `title`, `description` as they are.

- [ ] **Step 2: Author the five lessons**

Five lessons, `moduleId: "ray-marching"`, positions 1 to 5, four stages each. Lesson ids and stage arcs:

1. `camera-and-ray-setup` — a ray per pixel; direction painted as colour; the field of view as a number you choose; the camera orbiting on `iTime`.
2. `a-3d-sphere` — `length(p) - r` in 3D; a fixed depth slice showing the cross-section; moving the sphere; two spheres and `min`.
3. `the-march-loop` — stepping by the safe distance; the sphere appearing; what the step count buys; why it is called sphere tracing.
4. `the-hit-test` — the threshold; the step ceiling; the far plane; each one set badly.
5. `depth` — shading by `t`; near and far as colour; depth as a mask; depth driving a palette.

This is the reference prelude every stage of this module carries in `helpers`:

```glsl
float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float map(vec3 p) {
  return sdSphere(p - vec3(0.0, 0.0, 3.0), 1.0);
}

float march(vec3 ro, vec3 rd) {
  float t = 0.0;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.001) break;
    t += d;
    if (t > 20.0) break;
  }
  return t;
}
```

Lessons 1 and 2 carry only the part they need — lesson 1 needs no `map` at all — because a dead helper is a checker failure.

A representative stage body, from lesson 3:

```glsl
vec2 uv = fragCoord / iResolution.xy;
vec2 p = uv * 2.0 - 1.0;
p.x *= iResolution.x / iResolution.y;

vec3 ro = vec3(0.0, 0.0, 0.0);
vec3 rd = normalize(vec3(p, 1.5));

float t = march(ro, rd);

vec3 colour = vec3(0.05, 0.05, 0.08);
if (t < 20.0) {
  colour = vec3(0.31, 0.84, 1.0);
}

fragColor = vec4(colour, 1.0);
```

- [ ] **Step 3: Compute every render claim before writing the prose that states it**

For each stage, work out what actually appears and write the body against that. Concretely: with `ro` at the origin, `rd = normalize(vec3(p, 1.5))` and the sphere at `z = 3` with radius 1, the sphere's silhouette has angular radius `asin(1/3) = 19.47°`, so it spans `tan(19.47°) * 1.5 = 0.53` in `p` units — just over half the half-height of the frame. Claims like "fills about half the frame" must come from arithmetic like this, not from looking.

**Read the frame geometry before computing anything horizontal.** See "The frame" in Global Constraints. An earlier draft of this plan asserted a portrait preview and every horizontal claim in Module 8 had to be rewritten.

- [ ] **Step 4: Run the checker**

Run: `node scripts/content/__scratch__/verify-act2.mjs`
Expected: `act2 checks pass`. A `VOCAB` line naming a function means either a forward reference or a helper you forgot to declare.

- [ ] **Step 5: Bump the release id and the test constant**

In `scripts/content/release-metadata.ts` set `BUNDLED_RELEASE_ID` to `bundled-2026-08-09-2`.

In `src/data/course/__tests__/bundled-course.test.ts` change:

```ts
const LESSONS_PER_PUBLISHED_MODULE = [5, 5, 5, 4, 5, 5, 3, 5];
```

- [ ] **Step 6: Build and run everything**

Run: `npm run content:build && npm run content:check && npm test && npx tsc --noEmit`
Expected: build writes the asset, check reports up to date, 604+ tests pass, tsc silent.

- [ ] **Step 7: Commit**

```bash
git add content/module-08-raymarching.json scripts/content/release-metadata.ts \
  src/data/course/__tests__/bundled-course.test.ts assets/course/bundled-course.json
git commit -m "content(module-08): author Ray Marching"
```

---

### Task 3: Author Module 9 — 3D Shape & Space

**Files:**
- Modify: `content/module-09-3d-shape.json`
- Modify: `scripts/content/release-metadata.ts`
- Modify: `src/data/course/__tests__/bundled-course.test.ts`

**Interfaces:**
- Consumes: Module 8's prelude — `sdSphere`, `map`, `march` — copied verbatim into this module's `helpers`.
- Produces: `sdBox(vec3 p, vec3 b)`, `sdTorus(vec3 p, vec2 t)`, `smin(float a, float b, float k)`, added to the prelude Tasks 4 and 5 carry.

- [ ] **Step 1: Set the module to published and author three lessons**

`moduleId: "three-d-shape-and-space"`, positions 1 to 3, four stages each:

1. `box-and-torus-sdfs` — `abs` and `max` in 3D; the rounded box; the torus as a distance from a distance; both in one scene with `min`.
2. `smooth-minimum` — the crease `min` leaves; `smin` blending it; the blend radius as a control; a shape that only exists because of the blend.
3. `repetition-and-transforms-in-3d` — `fract` on a 3D coordinate; centring the cell; varying cells by their id; rotating within a cell.

This module's full prelude, carried in each stage's `helpers` — Module 8's three functions plus this
module's three. A stage carries only the part it uses, because an unused helper is a checker failure:

```glsl
float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdTorus(vec3 p, vec2 t) {
  vec2 q = vec2(length(p.xz) - t.x, p.y);
  return length(q) - t.y;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
  return sdSphere(p - vec3(0.0, 0.0, 3.0), 1.0);
}

float march(vec3 ro, vec3 rd) {
  float t = 0.0;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.001) break;
    t += d;
    if (t > 20.0) break;
  }
  return t;
}
```

Each lesson rewrites `map` to hold that lesson's scene. A representative stage body:

```glsl
vec2 uv = fragCoord / iResolution.xy;
vec2 p = uv * 2.0 - 1.0;
p.x *= iResolution.x / iResolution.y;

vec3 ro = vec3(0.0, 0.0, 0.0);
vec3 rd = normalize(vec3(p, 1.5));

float t = march(ro, rd);

vec3 colour = vec3(0.05, 0.05, 0.08);
if (t < 20.0) {
  colour = vec3(0.78, 0.96, 0.39);
}

fragColor = vec4(colour, 1.0);
```

`smin` may not appear in Module 8. Lesson 1 of this module may not use it either — it is lesson 2's subject.

- [ ] **Step 2: Compute the render claims**

The `smin` blend radius `k` is in world units, so a claim about how wide the weld looks must be converted through the camera the same way Task 2 Step 3 does. State the crease-versus-blend difference in terms of what is visible at a named `k`, not as "smoother".

- [ ] **Step 3: Run the checker**

Run: `node scripts/content/__scratch__/verify-act2.mjs`
Expected: `act2 checks pass`

- [ ] **Step 4: Bump the release id and the test constant**

`BUNDLED_RELEASE_ID` becomes `bundled-2026-08-09-3`.

```ts
const LESSONS_PER_PUBLISHED_MODULE = [5, 5, 5, 4, 5, 5, 3, 5, 3];
```

- [ ] **Step 5: Build, test and commit**

```bash
npm run content:build && npm run content:check && npm test && npx tsc --noEmit
git add content/module-09-3d-shape.json scripts/content/release-metadata.ts \
  src/data/course/__tests__/bundled-course.test.ts assets/course/bundled-course.json
git commit -m "content(module-09): author 3D Shape & Space"
```

---

### Task 4: Author Module 10 — Lighting & Materials

**Files:**
- Modify: `content/module-10-lighting.json`
- Modify: `scripts/content/release-metadata.ts`
- Modify: `src/data/course/__tests__/bundled-course.test.ts`

**Interfaces:**
- Consumes: the prelude from Tasks 2 and 3 — `sdSphere`, `sdBox`, `sdTorus`, `smin`, `map`, `march`.
- Produces: `normalAt(vec3 p)`, added to the prelude Task 5 carries.

- [ ] **Step 1: Set the module to published and author five lessons**

`moduleId: "lighting-and-materials"`, positions 1 to 5, four stages each:

1. `normals-by-gradient` — the gradient of the field; painting the normal as colour; why four extra `map` calls; the epsilon and what too small costs.
2. `diffuse` — `dot(n, l)`; clamping the back face; a light you can move on `iTime`; ambient as a floor.
3. `specular` — the reflected direction; the exponent as tightness; why it tracks the viewer; adding it to diffuse.
4. `soft-shadows` — marching toward the light; the binary shadow; closest approach as softness; the artefacts of a bad start offset.
5. `fog` — distance to colour; fog hiding the far plane; fog colour matching the sky; a finished lit sphere.

This module's full prelude, carried in each stage's `helpers`. A stage carries only what it uses:

```glsl
float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float map(vec3 p) {
  return sdSphere(p - vec3(0.0, 0.0, 3.0), 1.0);
}

float march(vec3 ro, vec3 rd) {
  float t = 0.0;
  for (int i = 0; i < 64; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    if (d < 0.001) break;
    t += d;
    if (t > 20.0) break;
  }
  return t;
}

vec3 normalAt(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    map(p + e.xyy) - map(p - e.xyy),
    map(p + e.yxy) - map(p - e.yxy),
    map(p + e.yyx) - map(p - e.yyx)
  ));
}
```

`sdBox` and `sdTorus` from Module 9 are available and may be used where a scene wants them; their
definitions are in `content/module-09-3d-shape.json`. A representative stage body, from lesson 2:

```glsl
vec2 uv = fragCoord / iResolution.xy;
vec2 p = uv * 2.0 - 1.0;
p.x *= iResolution.x / iResolution.y;

vec3 ro = vec3(0.0, 0.0, 0.0);
vec3 rd = normalize(vec3(p, 1.5));

float t = march(ro, rd);

vec3 colour = vec3(0.05, 0.05, 0.08);
if (t < 20.0) {
  vec3 hit = ro + rd * t;
  vec3 n = normalAt(hit);
  vec3 l = normalize(vec3(0.6, 0.7, -0.5));
  float diffuse = max(dot(n, l), 0.0);
  colour = vec3(0.31, 0.84, 1.0) * diffuse;
}

fragColor = vec4(colour, 1.0);
```

- [ ] **Step 2: Compute the render claims**

A normal painted directly is `n * 0.5 + 0.5`, so a sphere facing the camera reads `(0.5, 0.5, 1.0)` at its centre — a pale blue, not white. State that value. For diffuse, `dot(n, l)` at the terminator is 0 by definition, so the shadow line falls exactly where the surface turns 90° from the light; say so with the number rather than "the side away from the light goes dark".

- [ ] **Step 3: Run the checker**

Run: `node scripts/content/__scratch__/verify-act2.mjs`
Expected: `act2 checks pass`

- [ ] **Step 4: Bump the release id and the test constant**

`BUNDLED_RELEASE_ID` becomes `bundled-2026-08-09-4`.

```ts
const LESSONS_PER_PUBLISHED_MODULE = [5, 5, 5, 4, 5, 5, 3, 5, 3, 5];
```

- [ ] **Step 5: Build, test and commit**

```bash
npm run content:build && npm run content:check && npm test && npx tsc --noEmit
git add content/module-10-lighting.json scripts/content/release-metadata.ts \
  src/data/course/__tests__/bundled-course.test.ts assets/course/bundled-course.json
git commit -m "content(module-10): author Lighting & Materials"
```

---

### Task 5: Author Module 11 — Performance & Craft

**Files:**
- Modify: `content/module-11-performance.json`
- Modify: `scripts/content/release-metadata.ts`
- Modify: `src/data/course/__tests__/bundled-course.test.ts`

**Interfaces:**
- Consumes: the full prelude from Tasks 2 to 4.
- Produces: nothing later depends on. This is the last content task.

- [ ] **Step 1: Set the module to published and author three lessons**

`moduleId: "performance-and-craft"`, positions 1 to 3, four stages each:

1. `step-count-and-precision` — counting steps; the heatmap; the silhouette as the expensive part; what tightening the threshold costs.
2. `the-cost-of-branching` — a branch on a uniform versus a branch that differs per pixel; the same scene written both ways; the heatmap showing the difference.
3. `knowing-when-to-stop` — the finished scene; what each cut removes visibly; what it saves; the judgement call stated as one.

This module's full prelude. `marchCountingSteps` **replaces** `march` rather than sitting beside it,
so nothing is dead:

```glsl
float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float map(vec3 p) {
  return sdSphere(p - vec3(0.0, 0.0, 3.0), 1.0);
}

float marchCountingSteps(vec3 ro, vec3 rd, out float steps) {
  float t = 0.0;
  steps = 0.0;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    float d = map(p);
    steps += 1.0;
    if (d < 0.001) break;
    t += d;
    if (t > 20.0) break;
  }
  return t;
}

vec3 heat(float v) {
  return 0.5 + 0.5 * cos(6.28318 * (v + vec3(0.0, 0.67, 0.33)));
}
```

`out` on a function parameter is valid GLSL ES 1.00 — only stage-level `in`/`out` variables need
3.00, which is why `mainImage` itself compiles. `heat` is Module 4's cosine palette, reused so the
heatmap is read with a scale the learner already knows.

A representative stage body, from lesson 1:

```glsl
vec2 uv = fragCoord / iResolution.xy;
vec2 p = uv * 2.0 - 1.0;
p.x *= iResolution.x / iResolution.y;

vec3 ro = vec3(0.0, 0.0, 0.0);
vec3 rd = normalize(vec3(p, 1.5));

float steps = 0.0;
float t = marchCountingSteps(ro, rd, steps);

fragColor = vec4(heat(steps / 96.0), 1.0);
```

Lessons 2 and 3 may reintroduce a plain `march`, `normalAt` and the Module 9 shape functions where a
scene needs them; their definitions are in `content/module-08-raymarching.json`,
`content/module-09-3d-shape.json` and `content/module-10-lighting.json`.

- [ ] **Step 2: Reshape lesson 2 if the heatmap cannot show branch cost honestly**

The spec flags this as its weakest point. Write lesson 2's stages, render them, and check whether the two versions of the scene produce visibly different heatmaps. If they do not, the honest lesson is that branch cost is real but not visible in a step count, and the stages should say that and show what *is* visible — divergence between neighbouring pixels — rather than claiming a difference the render does not show. Report which way it went; do not assert a difference you did not see.

- [ ] **Step 3: Run the checker**

Run: `node scripts/content/__scratch__/verify-act2.mjs`
Expected: `act2 checks pass`

- [ ] **Step 4: Bump the release id and the test constant**

`BUNDLED_RELEASE_ID` becomes `bundled-2026-08-09-5`.

```ts
const LESSONS_PER_PUBLISHED_MODULE = [5, 5, 5, 4, 5, 5, 3, 5, 3, 5, 3];
```

- [ ] **Step 5: Build, test and commit**

```bash
npm run content:build && npm run content:check && npm test && npx tsc --noEmit
git add content/module-11-performance.json scripts/content/release-metadata.ts \
  src/data/course/__tests__/bundled-course.test.ts assets/course/bundled-course.json
git commit -m "content(module-11): author Performance & Craft, completing Act 2"
```

---

### Task 6: Compile every shader on a device, then remove the scaffolding

Nothing so far has compiled a single Act 2 shader. `LessonStageBlock` passes no `onCompileResult`, so a stage that fails to compile renders as an empty preview and logs nothing — indistinguishable from one that has not drawn yet. This task is the only thing that can catch that.

**Files:**
- Delete: `scripts/content/__scratch__/verify-act2.mjs`

**Interfaces:**
- Consumes: the four authored modules.
- Produces: a verified release.

- [ ] **Step 1: Install a clean build**

```bash
adb uninstall com.anonymous.shadercraft
npm run android
```

The uninstall matters: it wipes SQLite so migrations run from scratch and no previously-seeded release id lingers.

- [ ] **Step 2: Run the compile sweep**

With the app running against the dev server, open the audit route:

```bash
adb shell am start -a android.intent.action.VIEW -d "shadercraft:///shader-audit"
```

Then read the result:

```bash
adb logcat -d | grep SHADER-AUDIT
```

Expected: `SHADER-AUDIT DONE compiled=234 failed=0`. The count is 170 today plus Act 2's stages; if lessons landed on four stages each it is exactly 234. Any `SHADER-AUDIT FAIL` line names the stage id and the compiler's message with the line number already corrected into the authored body.

- [ ] **Step 3: Spot-check the claims only eyes can settle**

Compilation is not correctness. Check at least these three on screen, because each is a claim the prose makes that arithmetic cannot confirm:

- Module 10 lesson 1: a normal painted as colour reads pale blue `(0.5, 0.5, 1.0)` at the point facing the camera.
- Module 9 lesson 2: `min` leaves a visible crease where two shapes meet and `smin` removes it.
- Module 11 lesson 1: the heatmap is brightest around the silhouette, not at the centre of the shape.

- [ ] **Step 4: Delete the scaffolding**

```bash
rm scripts/content/__scratch__/verify-act2.mjs
npm test && npx tsc --noEmit
git add -A
git commit -m "chore(content): remove the Act 2 authoring checker"
```

- [ ] **Step 5: Report what was verified and what was not**

State plainly: how many shaders compiled, which spot-checks were made, and which of the 64 stages were never looked at. Do not describe Act 2 as verified beyond what was actually observed.

---

## Not in this plan

- **Tutorials for modules 8 to 11.** Their own smaller piece, written against finished lessons.
- **`iMouse`, a frame-time readout, the `requires-app-update` UI, tutorial progress sync.** All out of scope per the spec.
- **`npm run content:publish`.** Publishing to the linked Supabase project is the user's call, not a plan step.
