# Editing the Shadercraft curriculum

The curriculum is authored as version-controlled JSON, compiled into a single checksummed
release, and installed into an on-device SQLite database on first launch. SQLite is the only
runtime source screens read from — nothing in `src/app` or `src/components` reads the JSON
directly. This document covers what a contributor needs to safely author a lesson.

A lesson is prose plus three to five **stages**, each carrying a complete, runnable shader. There
is no preset, no preview key, and no hand-written paraphrase of a shader the learner cannot see:
the source in a stage is the source the sandbox compiles and the learner reads, always. If you are
about to write lesson 2 of Module 1, this document plus
[`docs/data/shader-sandbox.md`](shader-sandbox.md) is everything you need.

## 1. Where content lives

One file per module, in `content/`, in position order. `scripts/content/build-course.ts` lists
them explicitly and reads them in this order:

- `content/module-01-fragments.json` — **published**
- `content/module-02-shaping.json` — planned
- `content/module-03-distance-fields.json` — planned
- `content/module-04-colour.json` — planned
- `content/module-05-space.json` — planned
- `content/module-06-noise.json` — planned
- `content/module-07-composition.json` — planned
- `content/module-08-raymarching.json` — planned
- `content/module-09-3d-shape.json` — planned
- `content/module-10-lighting.json` — planned
- `content/module-11-performance.json` — planned

Each file is a single module object: metadata (`id`, `position`, `status`, `title`,
`description`) plus its `lessons` array. See [Published versus planned modules](#7-published-versus-planned-modules)
below for what each `status` requires.

## 2. The lesson shape

A `CourseLesson` (`src/data/course/types.ts`) is:

```ts
{
  id, moduleId, position, title, shortTitle,
  intro: string,
  takeaway: string,
  tryThis?: string,       // optional. No target, no solution, nothing checks it.
  stages: LessonStage[],  // 3 to 5
}
```

and a `LessonStage` is:

```ts
{ id, position, title, body: string, source: string }
```

`src/data/course/schema.ts` enforces this beyond the types:

- **3 to 5 stages per lesson.** Fewer or more fails with `must have between 3 and 5 stages`. A
  lesson that seems to need six is teaching two things and should be split; one that needs only
  two probably belongs inside a neighbouring lesson.
- **Word minimums, checked by counting whitespace-separated words:** lesson `intro` ≥ 40 words,
  each stage `body` ≥ 40 words, lesson `takeaway` ≥ 20 words. Falling short fails with e.g.
  `Lesson <id> intro must be at least 40 words`.
- Module, lesson, and stage `id`s must be unique and match `^[a-z0-9]+(?:-[a-z0-9]+)*$`; module,
  lesson, and stage `position`s must be contiguous starting at 1 within their parent.

These rules run whenever `npm run content:build` or `npm run content:check` parses your JSON — see
[The build workflow](#5-the-build-workflow). There is no separate lint step; a violation is a
build failure with the message quoted above.

`content/module-01-fragments.json` is the one authored lesson and the reference example throughout
this document. Its first stage:

```json
{
  "id": "one-colour-everywhere",
  "position": 1,
  "title": "One colour, everywhere",
  "body": "The simplest possible shader ignores position entirely and returns the same colour for every pixel. …",
  "source": "fragColor = vec4(0.85, 0.28, 0.22, 1.0);"
}
```

### Stable ids

Module, lesson, and stage `id` fields are permanent identifiers, not display strings. **Never
reuse or repurpose an id once it has shipped** — SQLite progress rows are keyed by lesson id, and
reassigning an id to different content would silently corrupt a learner's history. Titles, body
text, and `position` values may be changed freely; they do not affect stored progress.

## 3. Writing a stage's source

A stage's `source` is the **body of `mainImage`** — not a whole shader, not a fragment, and not
anything that needs a `void main()` of its own. The app supplies the prologue, the uniforms, and
the epilogue that calls your body and writes the result. Read
[`docs/data/shader-sandbox.md`](shader-sandbox.md) before writing your first stage; it is the
authoring contract, not a restatement of the rules below.

What you can rely on, precisely:

- **Language:** GLSL ES 1.00, not 3.00, even though `ExpoWebGLRenderingContext` extends
  `WebGL2RenderingContext` and 3.00 looks available. Do not write `#version`, and do not declare
  stage-level `in`/`out` (they are only valid as **function parameter** qualifiers here, which is
  how the wrapper's own `mainImage` signature uses them).
- **Uniforms, exactly these two:** `iResolution` (`vec3`; `.xy` is width and height in real
  pixels, `.z` is always `1.0`) and `iTime` (`float`, seconds since the sandbox started). Nothing
  else exists — no `iMouse`, no `iFrame`, no `iTimeDelta`, no `iChannel0`–`iChannel3`, no sampler
  uniforms of any kind.
- **`fragCoord`** is handed to you already, in real framebuffer pixels.

### Forbidden tokens

`SHADER_SOURCE_FORBIDDEN_TOKENS`, exported from `src/data/course/schema.ts`, is checked with a
plain substring search against every stage's `source`:

```
#version, precision, void main(, gl_FragColor, texture(, iMouse, iFrame, iTimeDelta
```

The first four exist because the wrapper already supplies them — writing your own would either
duplicate or fight what the app assembles around your body:

- `#version` — the wrapper never emits one; it targets GLSL ES 1.00 implicitly.
- `precision` — the wrapper's prologue already declares `precision highp float;`.
- `void main(` — the wrapper's epilogue defines `main()` and calls your `mainImage` body from it.
- `gl_FragColor` — the wrapper's `main()` writes through a local `vec4` and assigns it to
  `gl_FragColor` itself; your body writes to the `fragColor` out-parameter instead.

The remaining four name capability this build does not have, mirroring what used to be the preview
registry's job of rejecting a preview behaviour the app couldn't render — the schema now rejects a
uniform or language feature the app doesn't provide instead:

- `texture(` — there are no sampler uniforms or input textures. (Use `texture2D` if sampling is
  ever added later; it isn't forbidden today only because it does nothing useful without a
  sampler.)
- `iMouse`, `iFrame`, `iTimeDelta` — deliberately not implemented; see the uniform contract above.

A stage failing any of these fails with `Stage <id> source must not contain <token>`. An empty or
whitespace-only `source` fails separately with `Stage <id> source must not be empty`.

### A current rough edge: `precision` matches any substring

The check is `source.includes("precision")` — a plain substring test, not a search for the
declaration `precision highp float;`. That means **a GLSL comment that merely mentions the word
"precision" is rejected**, e.g.:

```glsl
// improves precision of the antialiased edge
```

fails to build even though it never redeclares the directive. This only affects a stage's
`source`; prose fields (`intro`, `body`, `takeaway`, `tryThis`) are unaffected — you can use the
word freely there. If you hit this, reword the comment (e.g. "improves accuracy") rather than lose
time hunting for a real bug. It is a known limitation, not a sign your shader is malformed.

## 4. Why stages duplicate each other

Each stage's `source` is complete and independently runnable — never a diff against the stage
before it. Look at `content/module-01-fragments.json`: stages 3 and 4 of "What a fragment shader
is" both declare `vec2 uv = fragCoord / iResolution.xy;` before doing anything new. That repetition
is deliberate, not an oversight to clean up.

The payoff: the sandbox can compile any stage directly with no diff-application logic, a learner
can jump to any stage and see it render, can edit one stage without needing the others in a
particular state first, and the code shown on screen is *always* the code producing the image —
never a hand-written paraphrase of a branch the learner can't see, which is exactly the property
the old preset/preview-key model lacked. The cost is that later stages repeat earlier ones; that
trade was made deliberately in
[the syllabus design](../superpowers/specs/2026-08-06-curriculum-syllabus-design.md#why-every-stage-carries-complete-source).

## 5. The build workflow

```bash
npm run content:build   # regenerate assets/course/bundled-course.json from content/module-*.json
npm run content:check   # fail if the tracked asset doesn't match what content:build produces
npm test                # full Jest suite, including content/schema assertions
npx tsc --noEmit        # project-wide type check
```

After editing any `content/module-*.json` file:

1. Run `npm run content:build`. This validates every module against `src/data/course/schema.ts`
   (the rules in sections 2 and 3 above) and writes the compiled result to
   `assets/course/bundled-course.json`.
2. **Commit the regenerated `assets/course/bundled-course.json` together with your content
   change.** It is a tracked, checked-in file, not a build artifact ignored by git — the app reads
   it directly as the bundled seed for SQLite, so a stale copy ships stale content.
3. Run `npm run content:check` before opening a PR. It fails (exit 1) if
   `assets/course/bundled-course.json` is not exactly what `content:build` would produce right
   now — this is the guard against someone editing `content/*.json` and forgetting step 2.
4. Run `npm test` and `npx tsc --noEmit`.

## 6. Release ids and checksums

`scripts/content/build-course.ts` compiles the modules into a release with a fixed `id` (currently
`bundled-2026-08-07`) and a SHA-256 `checksum` over the canonicalized content. `installBundledRelease`
(`src/data/database/seed.ts`) hands that pair to `ReleaseInstaller.stageAndActivate`
(`src/data/course/release-installer.ts`) — the same installer downloaded remote releases go
through — with checksum verification skipped (it is already verified at build time by
`content:check`, and the asset ships inside the signed application bundle).

The installer's behaviour on a device that already has SQLite data is what makes the release id a
real constraint, not paperwork:

- Unseen release id → install it, and activate it if nothing usable is currently active.
- Same release id, matching checksum → no-op.
- **Same release id, different checksum → throws `Release <id> is already installed with a
  different checksum`, permanently, on every launch of that device.**

That last case is exactly what happens if you edit `content/*.json`, regenerate
`assets/course/bundled-course.json`, and forget to change the `id` string in `build-course.ts`: the
id an already-seeded device recognises now points at different content, the checksum no longer
matches what that device stored, and the install is rejected forever short of a data reset. **Once
a release id has reached any device, any further content change needs a new release id** — bump
the `id` string in `build-course.ts` (e.g. `bundled-2026-08-07`) as part of the same change that
edits content.

## 7. Published versus planned modules

A module's `status` is either `"published"` or `"planned"`, and `src/data/course/schema.ts`
enforces the two shapes strictly:

- **Published** modules must have at least one lesson, and must leave `plannedLessonCount` at `0`
  and `plannedTopics` empty. `content/module-01-fragments.json` is the only one today.
- **Planned** modules must have zero lessons, and `plannedLessonCount` must equal
  `plannedTopics.length` exactly. They render as a roadmap card (lesson count + topic list),
  contribute nothing to progress totals, and cannot be opened as a lesson route.

Mixing the two fails to build — e.g. a planned module with lesson rows, or a published module with
leftover `plannedTopics`.

`plannedTopics` are not placeholder text. Each entry is a real lesson goal drawn from
[`docs/superpowers/specs/2026-08-06-curriculum-syllabus-design.md`](../superpowers/specs/2026-08-06-curriculum-syllabus-design.md),
the authority on the eleven-module arc. For example, Module 2's five planned topics are the five
lesson titles the spec already commits to — "Hard edges with step", "Soft edges with smoothstep",
"Blending with mix", "Keeping values in range", "Remapping and easing" — not five invented names
padding out a count.

## 8. Teaching order

No lesson may use a technique that a later lesson introduces. The syllabus spec is the authority on
order — read
[`docs/superpowers/specs/2026-08-06-curriculum-syllabus-design.md`](../superpowers/specs/2026-08-06-curriculum-syllabus-design.md)
before writing a lesson that reaches for anything beyond raw arithmetic on `fragCoord`,
`iResolution`, and `iTime`.

Concretely for Module 1: no `step`, `smoothstep`, `mix`, or `clamp` (Module 2), no SDF shape
function (Module 3), and no branching. `length()` is the one deliberate carve-out — it is allowed
in Module 1 purely as a *measurement* (showing that a radial gradient goes elliptical on a
non-square screen), because measuring a distance is not the same as building a shape from one;
Module 3 is where `length()` becomes a shape tool. Any stage relying on this carve-out should say
so in its body, so a reader doesn't mistake it for an SDF.

This ordering is not a style preference — nothing in `content:check` verifies it automatically. It
is checked by reading the spec and by the device walkthrough each authoring change should get
before it ships.

## Further reading

- [`docs/data/shader-sandbox.md`](shader-sandbox.md) — the sandbox contract every stage's source
  must satisfy: the wrapper's exact prologue/epilogue, the uniform contract, why GLSL ES 1.00, and
  how compile errors are reported.
- [`docs/superpowers/specs/2026-08-06-curriculum-syllabus-design.md`](../superpowers/specs/2026-08-06-curriculum-syllabus-design.md) —
  the eleven-module arc, Act 1 lesson-by-lesson, and the rationale behind the word minimums and
  stage-count rule.
- [`docs/data/tutorials.md`](tutorials.md) — the exercise format: how a step's solution doubles as
  its target render, why nothing is checked automatically, and the authoring rules that follow from
  that.
- [`docs/data/curriculum-publishing.md`](curriculum-publishing.md) — publishing a release to
  Supabase for background delivery to installed apps.
- For the design rationale behind the SQLite schema and the module/lesson/stage data model, see
  `docs/superpowers/specs/2026-08-03-offline-curriculum-sync-design.md` and
  `docs/superpowers/specs/2026-08-06-curriculum-syllabus-design.md`.
