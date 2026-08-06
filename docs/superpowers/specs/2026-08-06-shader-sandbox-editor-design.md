# Shader Sandbox and Editor Design

Date: 2026-08-06
Status: approved design, not yet planned

## Summary

Shadercraft's bottom navigation has always promised three workspaces and delivered two: tapping
**Editor** fires `Alert.alert("Editor is coming next", …)`. This design builds that third workspace
and, with it, the engine every future learning surface depends on: a shader sandbox that compiles
learner-authored GLSL at runtime, renders it live, and reports compile errors against the line the
learner actually typed.

The engine matters more than the tab. Today a lesson stores `previewKey: "boolean-union"` and the
GLSL it claims to explain lives in a 440-line `if/else` chain on a `u_mode` uniform inside
`live-shader-preview.tsx`. The four code lines a learner reads are a hand-written paraphrase of a
branch they never see, and nothing validates that the two agree. Once shader source can be compiled
at runtime, content can carry its own GLSL: the code shown becomes the code that renders, new
lessons stop requiring an app-store release, and the curriculum publishing pipeline finally has
something worth publishing.

This document covers the engine and the Editor tab only. It is the first of four sub-projects; the
other three are listed under Delivery Roadmap and get their own specs.

## Scope

### Included

- A pure shader-source module that wraps a Shadertoy-style `mainImage` body into a complete GLSL ES
  1.00 program and maps compiler line numbers back to the learner's buffer. See The Wrapper Contract
  for the exact prologue and epilogue.
- A GL-facing compiler module that returns structured errors instead of throwing.
- A `ShaderSandbox` component owning the `GLView`, the render loop, debounced recompilation, and
  last-good-program retention.
- A `GlslInput` editing surface: line-numbered monospace `TextInput`, a GLSL symbol accessory row,
  and gutter error markers.
- A `sketches` table, migration, and `SqliteSketchRepository` with profile-scoped CRUD.
- An `editor` route: opens the most recently edited sketch, with a sketch list for switching,
  renaming and deleting.
- Making the Editor tab navigate instead of alerting.

### Excluded

- Any change to `content/*.json`, the curriculum schema, or `preview-registry.ts`. The 60 `u_mode`
  branches stay exactly as they are; sub-project 2 retires them.
- The Tutorials tab, the tutorial content type, and per-module tutorial unlocking (sub-project 3).
- Absorbing `src/app/bonus-scanline.tsx` into the tutorial system. It keeps its hardcoded
  `codeByMode` table and its four `logo-*` preview keys for now, so it is migrated once rather than
  twice.
- Cloud sync for sketches. Rows carry `profile_id` so sync stays possible later, but no outbox
  mutations are enqueued and no Supabase tables are added.
- `iMouse`, `iFrame`, `iTimeDelta`. Adding uniforms later is additive and breaks no existing content.
- Syntax highlighting inside the editable buffer. React Native's `TextInput` cannot style a live
  buffer reliably; a highlighted read-only view is possible but belongs with the lesson workspace in
  sub-project 2.

## Guiding Decisions

1. **The editor is the product.** Live rendering of learner-authored source is the point of the app;
   everything else is supporting material. This decision is why the engine ships before any content
   work.
2. **Four tabs eventually: Home, Course, Tutorials, Editor.** One shared compile engine underneath.
   Tutorials seed the sandbox with a step's shader; the Editor tab opens a blank canvas or a saved
   sketch. This sub-project ships three tabs; Tutorials joins in sub-project 3.
3. **The authored unit is a Shadertoy `mainImage` body.** The app supplies the prologue and `main()`.
   Boilerplate stays off a small screen and learner code pastes into shadertoy.com almost verbatim.
4. **GLSL ES 1.00, not 3.00.** `ExpoWebGLRenderingContext` extends `WebGL2RenderingContext`, but the
   v57 documentation warns that "some older Android devices may not support WebGL2 features."
   Targeting 1.00 keeps those devices working. `out`/`in` qualifiers on *function parameters* are
   valid GLSL ES 1.00 — only stage-level `in`/`out` variables require 3.00 — so `mainImage` compiles
   on a WebGL1 context and Shadertoy compatibility survives.
5. **Plain `TextInput` plus a symbol accessory row.** No new dependencies, offline by construction,
   fastest to ship. A WebView-hosted CodeMirror was considered and rejected for this sub-project: it
   costs `react-native-webview`, a separate asset build, and a bridge round trip per keystroke.
6. **A failed compile must never blank the preview.** Half-typed source is the normal state of an
   editor. The last program that compiled keeps rendering.
7. **Line mapping is best-effort and never load-bearing.** GLSL info-log formats vary by driver. The
   raw log is always shown.

## Architecture

Existing layering is preserved: nothing under `src/data` imports React, GL never enters the data
layer, and the logic most likely to be wrong lives in pure modules Jest can exercise without a GPU.

### Shader source contract — `src/shaders/shader-source.ts`

Pure. No React, no GL, no `expo-*` imports.

```ts
export function wrapMainImageBody(body: string): {
  source: string;
  lineOffset: number;
};

export type CompileError = {
  line: number | null;   // learner-buffer line, already offset-corrected
  column: number | null;
  message: string;
  raw: string;           // the log line verbatim, always populated
};

export function parseCompileLog(log: string, lineOffset: number): CompileError[];
```

`lineOffset` is how many prologue lines precede the learner's line 1. `parseCompileLog` subtracts it
so reported lines match what is on screen. An error resolving to a line at or above the splice point
clamps to `line: 1` and keeps its raw text rather than reporting a non-positive line. A log line that
matches no known pattern still yields a `CompileError` with `line: null` and the raw text preserved.

### Compiler — `src/shaders/shader-compiler.ts`

Touches GL, knows nothing about React.

```ts
export type CompileResult =
  | { ok: true; program: WebGLProgram }
  | { ok: false; errors: CompileError[]; rawLog: string };

export function compileProgram(
  gl: ExpoWebGLRenderingContext,
  fragmentSource: string,
  lineOffset: number,
): CompileResult;
```

This replaces the existing `compileShader` in `live-shader-preview.tsx:449`, whose only failure mode
is `throw`. Throwing is correct for a build-time constant and wrong for something a learner types.
Both compile failure and link failure return `ok: false`; both delete the GL objects they created
before returning.

### Sandbox — `src/components/shader-sandbox.tsx`

Owns the `GLView`, the render loop, and recompilation.

```tsx
type ShaderSandboxProps = {
  source: string;                                   // mainImage body
  paused?: boolean;
  restartToken?: number;
  height?: number;
  onCompileResult?: (result: SandboxCompileResult) => void;
};
```

Behaviour:

- Recompiles when `source` changes and differs from the source last compiled.
- On success, swaps the active program and deletes the superseded program and shaders.
- On failure, retains the previous program and continues rendering it, reporting the errors upward.
- With no program ever compiled, renders a neutral placeholder rather than an empty context.
- Recompiles **in place**; the `GLView` is not remounted. The current hardcoded
  `key="shape-synthesis-v1"` — flagged as stale in
  `docs/superpowers/plans/2026-08-04-offline-curriculum-follow-ups.md` — becomes a meaningful
  constant.
- Renders read-only. It has no editing concerns, so sub-project 2 can reuse it for lesson previews.

### Editing surface — `src/components/glsl-input.tsx`

```tsx
type GlslInputProps = {
  initialValue: string;
  errors: CompileError[];
  onChange: (source: string) => void;   // caller debounces
};
```

- Monospace, uncontrolled `TextInput` (`defaultValue` plus a ref) so a keystroke does not re-render
  the preview tree.
- `autoCorrect={false}`, `autoCapitalize="none"`, `spellCheck={false}`. Without these, the keyboard
  capitalizes identifiers and substitutes typographic quotes into source code.
- Soft wrap disabled; the editor scrolls horizontally. Line numbers count logical lines, so a
  wrapped line would desynchronize the gutter and make error line numbers meaningless.
- A horizontally scrolling accessory row inserts the characters phone keyboards bury: `{ } ( ) ; ,
  . * / - + = < > [ ]` plus `vec2` `vec3` `vec4` `float` `smoothstep` `length` `mix`. Insertion is at
  the cursor, which requires tracking `selection`.
- Gutter markers on lines carrying errors; the error list renders beneath the input.

### Sketch repository — `src/data/sketches/`

Follows the shape of `SqliteCourseRepository` and `SqliteProgressRepository`.

```ts
export type Sketch = {
  id: string;
  title: string;
  source: string;
  createdAt: string;
  updatedAt: string;
};

export interface SketchRepository {
  list(profileId: string): Promise<Sketch[]>;            // updatedAt desc
  get(profileId: string, id: string): Promise<Sketch | null>;
  create(profileId: string, title: string, source: string): Promise<Sketch>;
  updateSource(profileId: string, id: string, source: string): Promise<void>;
  rename(profileId: string, id: string, title: string): Promise<void>;
  delete(profileId: string, id: string): Promise<void>;
}
```

All writes go through the existing driver-level transaction queue
(`src/data/database/transaction-queue.ts`), so sketch writes cannot race UI writes.

### Screen — `src/app/editor.tsx`

Opens the most recently edited sketch, or seeds a starter sketch on first run. A header control opens
a sketch list for switching, renaming and deleting. Last-sketch-first was chosen over list-first
because a list is a tax paid at the start of every session.

### Navigation — `src/components/bottom-navigation.tsx`

The `editor` case routes to `/editor` instead of firing `Alert.alert`. The stale alert copy — "The
course and first lesson are ready", written when one lesson existed — is deleted with it.

## The Wrapper Contract

The learner's buffer is spliced into exactly this and nothing else. Four prologue lines sit above the
body, so `lineOffset` is 4:

```glsl
precision highp float;                                  // 1
uniform vec3  iResolution;   // x = width, y = height, z = pixel aspect
uniform float iTime;         // seconds since the sandbox started
void mainImage(out vec4 fragColor, in vec2 fragCoord) { // 4

  // ← the learner's buffer is spliced here, its line 1 landing on line 5

}                                                       // epilogue
void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}
```

`main()` writes through a local rather than passing `gl_FragColor` directly as the `out` argument.
Both forms are arguably legal, but built-in variables as `out` parameters are rejected by some
drivers, and a local costs nothing.

`fragCoord` is real framebuffer pixels via `gl_FragCoord.xy`, matching Shadertoy. This incidentally
repairs an existing inconsistency: Module 1 Lesson 1 teaches `gl_FragCoord.xy` while every code
snippet writes `fragCoord`, with nothing explaining the relationship. The wrapper is that
relationship, and it becomes teachable.

Adopting `iTime` and `iResolution` means sub-project 2 rewrites existing sources off `u_time` and
`resolution`, and sub-project 4 updates the prose to match. Both already rewrite that material.

The starter sketch shipped on first run is a complete, working `mainImage` body — the first complete
runnable shader anywhere in the product.

## Data Model

One new table, added as migration **version 2** — `migrations.ts` currently contains a single
version 1 migration. It is additive and touches no existing table.

```sql
CREATE TABLE sketches (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES learner_profiles(id) ON DELETE CASCADE
);

CREATE INDEX sketches_profile_updated ON sketches (profile_id, updated_at DESC);
```

The foreign key targets `learner_profiles(id)`, matching `lesson_progress`.
`profile_id` mirrors how progress is partitioned, so an account switch shows that profile's sketches
and a future sync path exists without being built now. No outbox rows are written: sketches are
local-only in this sub-project, and enqueuing mutations no server can accept would trip the sync
attention state.

## Data Flow

1. The editor screen loads a sketch through `SketchRepository.get`.
2. `GlslInput` runs uncontrolled from `initialValue`; keystrokes do not re-render the preview tree.
3. `onChange` output is debounced ~300 ms and passed to `ShaderSandbox` as `source`.
4. The sandbox compiles, swaps or retains the program, and reports the result upward.
5. Compile results flow into gutter markers and the error list.
6. Autosave writes through `updateSource` on a longer ~800 ms debounce, and unconditionally on blur
   and on navigating away.
7. The render loop reads `iTime` from `performance.now()` relative to the start or last restart.

## Failure Handling

| Condition | Behaviour |
| --- | --- |
| Compile fails, a good program exists | Keep rendering the last good program, list errors, mark the gutter, badge the preview as showing the last working version |
| Compile fails, nothing good yet | Neutral placeholder plus the error list. No crash, no error reaching a boundary |
| Log matches no known pattern | Show the raw log verbatim; `line: null` suppresses the gutter marker only |
| Link failure | Treated identically to compile failure |
| Empty or whitespace-only source | Do not compile; show the placeholder |
| Successful recompile | Delete the superseded program and shaders, or a long session leaks one program per debounce window |
| `GLView` unmounts | Cancel the animation frame and guard the render callback, as `live-shader-preview.tsx` already does |
| SQLite write fails | Surface non-destructively and keep the buffer in memory. Losing a sketch to a failed write is the worst available bug |
| Pathological shader | GLSL ES 1.00 requires loop bounds the compiler can unroll, so infinite loops are not expressible. A heavy shader can still tank framerate; the pause control covers it |

With the keyboard raised a phone has almost no room, so the preview stays pinned at reduced height
and the editor scrolls beneath it. A collapse control gives the editor full height on demand.

## Testing Strategy

`lesson-workspace.test.tsx:13` establishes the house pattern — mock the preview module with a `View`
that echoes its props, because no Jest environment provides a GL context. Screen tests mock
`shader-sandbox` the same way; the sandbox's real logic is tested through the pure modules and a fake
`gl`.

### Shader source (pure)

- `wrapMainImageBody` emits the expected prologue and a `lineOffset` matching it.
- `parseCompileLog` against real driver formats: `ERROR: 0:12: 'x' : undeclared identifier`, the
  ANGLE variant, multi-error logs, logs with no line number, empty logs, CRLF endings.
- Offset arithmetic: an error on wrapped line *N* maps to learner line *N − offset*; an error inside
  the prologue clamps to line 1 with its raw text retained.

### Compiler (fake `gl`)

A hand-written stub implementing the calls `compileProgram` uses. Asserts the success path returns a
program; compile failure returns errors and deletes the shader; link failure returns errors and
deletes the program; and a created-versus-deleted tally shows no leaks across repeated compiles.
These failure paths are untestable against the current throw-based implementation.

### Components

- The symbol row inserts at the cursor and leaves the caret in the right place.
- The error list shows offset-corrected line numbers.
- The last-working-version badge appears only after a success is followed by a failure.
- The placeholder shows when nothing has ever compiled.

### Repository

On the existing `node:sqlite` test driver: CRUD, `updatedAt desc` ordering, autosave idempotence, and
profile isolation — profile A must not observe profile B's sketches. Plus a migration test proving
the schema bump applies to an already-seeded database.

## Risks

1. **Info-log formats are a guess until a device runs one.** Every `parseCompileLog` pattern is
   written against what Mali, Adreno and ANGLE probably emit. Mitigated by always showing the raw log
   and confining patterns to one pure function. Compiling a deliberately broken shader on a real
   Android device should be the *first* acceptance check, not the last.
2. **Programmatic insertion into an Android `TextInput` is finicky.** The symbol row inserts at the
   cursor, requiring `selection` tracking on an otherwise-uncontrolled input, and Android is known
   for caret jumps when writing back programmatically. Budget real time; it is the least glamorous
   item here and the most likely to consume a day.
3. **Gutter alignment versus soft wrap.** Numbers beside a multiline `TextInput` desynchronize as
   soon as a line wraps. Mitigated by disabling wrap and scrolling horizontally, at the cost of
   horizontal scrolling on long lines.
4. **Remote debugging breaks `expo-gl` entirely** — documented for SDK 57. Contributors need to know
   before they debug the sandbox; this belongs in the developer docs this sub-project ships.

## Android Acceptance Checks

Owed to a human on a device, in this order:

1. Compile a deliberately broken shader; capture the verbatim info log and confirm
   `parseCompileLog`'s patterns match it.
2. Type continuously in a 40–60 line shader; confirm no caret jumps, no autocapitalization, and
   acceptable input latency.
3. Confirm the symbol row inserts at the caret and the caret advances correctly after each insert.
4. Confirm the preview keeps rendering the last good program while the buffer is mid-edit and
   invalid.
5. Confirm framerate with the preview pinned and the keyboard raised.
6. Background the app mid-edit and relaunch; confirm the sketch survived autosave.
7. Create, rename, switch and delete sketches; confirm ordering and that deletion cannot orphan the
   open editor.

## Delivery Sequence

1. `shader-source.ts` with its pure tests. Nothing renders yet; the riskiest logic is under test
   first.
2. `shader-compiler.ts` with the fake-`gl` tests.
3. `ShaderSandbox` rendering a fixed source, replacing nothing.
4. `GlslInput` with the symbol row and gutter.
5. The `sketches` migration and repository.
6. The `editor` route, then the sketch list.
7. Bottom navigation routes to `/editor`; delete the alert.
8. Developer documentation: the wrapper contract, the uniform set, and the remote-debugging caveat.

## Success Criteria

- A learner can open the Editor tab, edit GLSL, and see the result within one debounce window.
- A syntax error shows a message against the correct on-screen line while the previous render
  survives.
- Sketches persist across app restarts and stay isolated per profile.
- No GL objects leak across repeated recompiles.
- `ShaderSandbox` is reusable read-only, so sub-project 2 needs no second preview component.
- `Alert.alert("Editor is coming next", …)` no longer exists.

## Delivery Roadmap

This spec is sub-project 1 of four. Each later one gets its own spec, plan and implementation cycle.

2. **Content carries GLSL.** Presets gain a `source` field; `previewKey` and `preview-registry.ts`
   are retired; the 440-line `u_mode` chain is extracted into 56 per-preset shaders over a shared
   helper prologue; the lesson workspace becomes editable.
3. **Tutorials section.** A tutorial content type and tables, per-module unlocking on module
   completion, a step model with target-versus-yours and a reveal control, the Tutorials tab, Home
   surfacing, and `bonus-scanline.tsx` retired into the system as its first real tutorial.
4. **Curriculum depth pass and Module 4.** Rewrite the thin prose (14 lessons currently average ~165
   words), add the missing randomness and noise foundation, fix the `clamp` and value-band overshoot
   mismatches, introduce `fwidth`-based antialiasing, and author Module 4 — by then pure JSON needing
   no store release.

### Prerequisites sub-project 2 inherits

Retiring `previewKey` is this project's first breaking content-schema change, which promotes two
deferred findings from
`docs/superpowers/plans/2026-08-05-remote-publishing-follow-ups.md` into hard prerequisites:

- **Item 2** — `scripts/content/publish-course.ts` must read the release back through
  `get_course_release` and assert the checksum still matches. A schema change is exactly the
  circumstance under which a publish/read asymmetry would break updates on every device with CI
  green.
- **Item 3** — `minimumAppVersion` must stop being hardcoded to `"1.0.0"`, because builds predating
  the source-carrying schema have to be gated off the new content. The follow-up note said to promote
  it to a flag "when a content schema bump first needs it, and not before"; sub-project 2 is that
  moment.

- **Item 1** — nothing surfaces `requires-app-update` to the learner. Once gating is real, a gated
  device must say so.

## Technical References

- [`expo-gl` SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view/) — `GLView`,
  `onContextCreate`, `ExpoWebGLRenderingContext`, `endFrameEXP()`, the WebGL2 availability caveat,
  and the remote-debugging limitation. Included in Expo Go; no development build required.
- [`expo-sqlite` SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) — the sketches table.
- `src/components/live-shader-preview.tsx` — the existing `compileShader`, render loop and
  `u_mode` chain this design generalizes.
- `docs/data/local-curriculum.md` — authoring rules that sub-project 2 will amend.
