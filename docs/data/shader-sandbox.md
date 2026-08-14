# The shader sandbox

The sandbox compiles learner-authored GLSL at runtime, renders it live, and reports compile errors
against the line the learner actually typed. It powers the Editor tab and every lesson's live stage
preview, and will power tutorial steps too once those ship.

This document is the contract. If you author shader source anywhere in the app, or debug why a preview
is blank, read it first.

## What a learner authors

Not a whole program — the body of `mainImage`. The app supplies everything around it:

```glsl
#extension GL_OES_standard_derivatives : enable         // 1
precision highp float;
uniform vec3  iResolution;   // x = width, y = height, z = pixel aspect
uniform float iTime;         // seconds since the sandbox started

  // one `uniform float <key>;` line for each saved shader parameter sits here

  // ← an optional block of stage `helpers` sits here, when the stage declares one

void mainImage(out vec4 fragColor, in vec2 fragCoord) {

  // ← the authored body goes here, its line 1 landing on line 6 when there are no helpers

}
void main() {
  vec4 shadercraftColor = vec4(0.0, 0.0, 0.0, 1.0);
  mainImage(shadercraftColor, gl_FragCoord.xy);
  gl_FragColor = shadercraftColor;
}
```

Four header lines plus the `mainImage` opener sit above the body when there are no saved parameters
or helpers, so **`SHADER_BODY_LINE_OFFSET` is 5** — `HEADER_LINES.length + 1`. It is the
no-parameters, no-helpers baseline, not a universal error offset. `wrapMainImageBody` returns the
actual count of every generated uniform declaration and helper line above the body; every reported
error line is corrected by that returned value. Adding a saved parameter therefore cannot silently
shift a learner's error location.

The `#extension` directive arrived with Module 3, which needs `fwidth`, and this document said "four
prologue lines … the offset is 4" for some time afterwards. Deriving the constant meant the app was
never wrong; only the prose was. A stage that quotes the wrapper back to the learner — Module 1's
`the-whole-program` — has to be updated with it.

When a stage declares `helpers`, that block is spliced between the header and the `mainImage`
opener, so the body's line 1 lands further down still. `wrapMainImageBody` returns the actual offset
alongside the source rather than assuming this one; the constant is the no-helpers case.

`main` writes through a local rather than passing `gl_FragColor` straight in as the `out` argument.
Both forms are arguably legal, but built-in variables as `out` parameters are rejected by some
drivers, and a local costs nothing.

## The uniform contract

| Uniform | Type | Meaning |
| --- | --- | --- |
| `iResolution` | `vec3` | Framebuffer width, height, and pixel aspect (always `1.0`) |
| `iTime` | `float` | Seconds since the sandbox started, or since the last restart |

`iResolution` and `iTime` remain built-ins. **`iMouse`, `iFrame` and `iTimeDelta` do not exist.**

### Saved custom float uniforms

An editor sketch may save parameter definitions in its sketch metadata. That metadata is the source
of truth for the parameter's key, display label, range, step, default value, and current value. Each
valid saved definition generates exactly one declaration immediately after the built-ins:

```glsl
uniform float u_gain;
```

Use the same key in the authored `mainImage` body. Metadata is normalized on read and before it is
saved: keys and labels are trimmed; values and defaults are clamped to the inclusive `min`–`max`
range; and malformed metadata is reset to an empty parameter list with a warning. A definition needs
a unique GLSL identifier key, a non-empty label, finite numeric fields, `max > min`, and `step > 0`.
Keys may not use GLSL keywords, `gl_`, `__`, or the built-in/reserved names such as `iTime`,
`iResolution`, `main`, or `mainImage`.

Changing a definition (for example its key or range) changes the generated source and recompiles the
program. Changing only a slider value does not: the active linked program is retained and the new
finite value is uploaded to its cached uniform location on the next render. This is what keeps slider
interaction from causing compile flicker.

Only saved scalar `float` parameters are supported. Full shader programs and custom non-float
uniforms (`vec*`, matrices, booleans, integers, samplers, and arrays) remain unsupported.

`fragCoord` is real framebuffer pixels, taken from `gl_FragCoord.xy` exactly as Shadertoy does. Note
that this is what makes the curriculum's own claim honest: Module 1 Lesson 5 teaches `gl_FragCoord.xy`
while every snippet writes `fragCoord`, and the wrapper is the bridge between them.

## Why GLSL ES 1.00, not 3.00

`ExpoWebGLRenderingContext` extends `WebGL2RenderingContext`, so 3.00 looks available. The
[SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view/) warns that "some older
Android devices may not support WebGL2 features", and a learner on such a device would get nothing at
all rather than a degraded preview.

Targeting 1.00 costs less than it appears, because the distinction that matters is narrow:

- `out` and `in` on **function parameters** are valid GLSL ES 1.00. That is what `mainImage` uses.
- `in`/`out` as **stage-level variable qualifiers** — replacing `attribute` and `varying` — require
  3.00. Nothing here needs them.

So do not write `#version`, do not declare stage-level `in`/`out`, and use `texture2D` rather than
`texture` if sampling is ever added.

## Differences from Shadertoy

Authored bodies paste into shadertoy.com almost unchanged — `iResolution` and `iTime` mean the same
thing there, and `mainImage` has the same signature. What is absent here:

- No `texture()`, `textureLod`, or sampler uniforms. There are no input textures.
- No multi-pass buffers, no `iChannel0`–`iChannel3`.
- No `iMouse`, `iFrame`, `iTimeDelta`, `iDate`, or audio input.
- GLSL ES 1.00, so Shadertoy code using 3.00-only syntax needs adjusting.

## How errors are reported

`parseCompileLog` reads the driver's info log and translates line numbers back into the authored
buffer. It recognises two shapes:

```
ERROR: 0:12: 'foo' : undeclared identifier     ← common on ANGLE, Mesa, Adreno
0:12: L0001: syntax error                      ← seen on some Mali drivers
```

The leading number is the **source-string index**, not a column — which is why `CompileError` has no
`column` field. It could only ever have been null.

Three properties worth relying on:

- **Parsing is best-effort.** Driver formats are not contractual. A line matching neither pattern
  still produces a diagnostic carrying its text verbatim, with `line: null`.
- **The raw log is always available.** Line mapping must never be the only way to see what the
  compiler said. If the patterns stop matching a new driver, the learner is inconvenienced, not
  blocked.
- **A diagnostic pointing into the prologue clamps to line 1.** That case is the app's fault, not the
  learner's, but a non-positive line number in the gutter would be meaningless.

## A failed compile never blanks the preview

`ShaderProgramHost` swaps in a new program only after it links, and keeps drawing the last one that
worked when compilation fails. Half-typed source is the normal state of an editor, so failure is a
return value rather than an exception — and the editor shows "Showing the last version that compiled"
rather than going black.

The superseded program is deleted only after its replacement links, so a long editing session does not
leak one program per keystroke burst. That is asserted by a created-versus-deleted tally in the tests,
not assumed.

## Remote debugging breaks expo-gl

**If the preview is black, check this first.** `expo-gl` "does not function as intended with remote
debugging enabled", per the SDK 57 documentation. It is not a bug in this code, and it will waste an
afternoon if you do not know it.

## Where the pieces live

| Concern | File |
| --- | --- |
| Wrapper assembly and log parsing (pure) | `src/shaders/shader-source.ts` |
| Compile, swap, retain last good, delete | `src/shaders/shader-program-host.ts` |
| `GLView`, the frame loop, `paused`/`active` | `src/components/shader-sandbox.tsx` |
| Editing surface, gutter, symbol row | `src/components/glsl-input.tsx` |
| Pause, restart, collapse | `src/components/preview-controls.tsx` |
| Sketch list, rename, delete | `src/components/sketch-list-sheet.tsx` |
| Persistence (profile-scoped, local-only) | `src/data/sketches/` |
| Test double for a GL context | `src/shaders/testing/fake-gl.ts` |

## `paused` versus `active`

`ShaderSandbox` takes two boolean props that both affect the render loop, and they are deliberately
distinct:

- **`paused`** freezes `iTime` but keeps drawing every frame, so a preview the learner can see holds
  its last rendered frame rather than going blank. This is what the Editor tab's pause control uses.
- **`active`** (default `true`) stops the render loop entirely when `false` — no animation frame, no
  draw call, no `endFrameEXP`. This is for a preview nobody can see: a lesson stage block that has
  scrolled off screen. Its GL context stays alive (mounting is one-way; see
  `src/components/lesson-stage-visibility.ts`), only the per-frame work stops.

Do not conflate the two: a paused-but-visible preview must keep drawing its last frame, and an
inactive-but-invisible preview must not draw at all. Setting `active={false}` on something the learner
can currently see would freeze it mid-frame with no indication why; setting only `paused` on something
off-screen would waste every frame on a draw call nobody observes.

The editing surface is a **controlled** `TextInput` with state local to the component. That is not a
style preference: RN 0.86 always runs the New Architecture, where `setNativeProps` is unsupported, so
an uncontrolled input could not have text inserted at the caret at all. Keeping the buffer state local
means a keystroke re-renders the editor and nothing else.

## Testing notes

No Jest environment provides a GL context, so:

- Pure logic (`shader-source.ts`) is tested directly.
- `ShaderProgramHost` is tested against `createFakeGl`, a scriptable stub that can fail compilation or
  linking on demand and tracks created-versus-deleted objects.
- Screens mock `../components/shader-sandbox` with a view echoing the source it was handed, the same
  way `lesson-workspace.test.tsx` stands in for the sandbox.

Three harness details that cost time to rediscover:

- `render` **and every `fireEvent` variant** return promises in `@testing-library/react-native` 14. An
  unawaited event overlaps the next `act()` scope and tears the tree down mid-test.
- `jest.mock` factories may only close over `mock`-prefixed bindings.
- `toHaveTextContent` matches strings **exactly**; multi-line content needs a regex.

## Further reading

- [`docs/data/local-curriculum.md`](local-curriculum.md) — how curriculum content is authored today.
  Lessons render on this sandbox directly: each stage carries a complete `mainImage` body rather
  than a hand-written paraphrase of a hidden branch, so the code a lesson displays is always the
  code that renders. That is what lets new lessons ship as content rather than as an app release.
- [`expo-gl` SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view/) — `GLView`,
  `onContextCreate`, `endFrameEXP()`, the WebGL2 caveat, and the remote-debugging limitation. Included
  in Expo Go, so no development build is needed.
