# Shader Sandbox and Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shader sandbox that compiles learner-authored GLSL at runtime with live rendering and per-line error reporting, and ship it as the Editor tab that is currently a stubbed `Alert`.

**Architecture:** Four layers, ordered so the logic most likely to be wrong is testable without a GPU. A pure module wraps a Shadertoy-style `mainImage` body into a complete GLSL ES 1.00 program and maps compiler line numbers back to the learner's buffer. A program host class owns compile/swap/delete lifecycle against a `gl` context and is exercised with a fake one. A thin React component adds `GLView` and the animation frame. A profile-scoped `sketches` table persists work.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19.2, TypeScript 6, `expo-gl`, `expo-sqlite`, `expo-crypto`, Jest with `jest-expo`, `node:sqlite` for repository tests.

**Spec:** `docs/superpowers/specs/2026-08-06-shader-sandbox-editor-design.md`

## Global Constraints

- Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing code against any Expo API.
- **No new dependencies.** Everything ships with what `package.json` already has.
- **GLSL ES 1.00 only.** No `#version` directive, no stage-level `in`/`out`, no `texture()`. `out`/`in` on *function parameters* is valid 1.00 and is what makes `mainImage` work.
- **Uniform contract is exactly `iResolution` (vec3) and `iTime` (float).** No `iMouse`, `iFrame`, or `iTimeDelta` in this sub-project.
- **`lineOffset` is 4.** Four prologue lines precede the learner's line 1, so learner line = wrapped line − 4.
- **Nothing under `src/data` may import React or `expo-gl`.** Nothing under `src/shaders` may import React.
- **No changes to `content/*.json`, `src/data/course/schema.ts`, or `src/shaders/preview-registry.ts`.** The 60 `u_mode` branches and `live-shader-preview.tsx` stay exactly as they are; sub-project 2 retires them.
- **Sketches are local-only.** Rows carry `profile_id`, but no `sync_outbox` rows are written and no Supabase tables are added.
- Theme tokens come from `src/constants/theme.ts`: `Colors` (`background`, `surface`, `surfaceRaised`, `border`, `text`, `textMuted`, `textSubtle`, `accent`, `cyan`, `violet`, `coral`), `Spacing` (`xs` 4 … `xxxl` 32), `Radius` (`sm` 8 … `round` 999).
- Run the full check before every commit: `npm test` and `npx tsc --noEmit`.

## Two Intentional Deviations From The Spec

Both are refinements found while mapping the code. They are deliberate, not drift.

1. **`CompileError` has no `column` field.** The spec listed one. GLSL info logs encode `sourceIndex:line` — the leading number is which source string, never a column — so the field could only ever be `null`. It is dropped rather than shipped permanently empty.
2. **`shader-compiler.ts` is absorbed into a `ShaderProgramHost` class.** The spec listed a standalone `compileProgram(gl, source, lineOffset)` plus last-good retention inside the `ShaderSandbox` component. Both now live in `src/shaders/shader-program-host.ts` (Task 3), because compilation and retention are one concern: deciding whether to swap a program requires knowing what the previous one was. Consolidating them makes retention *and* the no-GL-leak guarantee ordinary unit tests against a fake `gl`, instead of behaviour verifiable only by hand on a device. The component becomes a thin `GLView` + animation-frame wrapper, and no `shader-compiler.ts` is created.

## File Structure

**Created:**
- `src/shaders/shader-source.ts` — pure. Wrapper assembly and info-log parsing.
- `src/shaders/shader-program-host.ts` — GL lifecycle: compile, swap, retain last good, delete, set uniforms, draw.
- `src/shaders/testing/fake-gl.ts` — a scriptable `gl` stub with a created-vs-deleted tally.
- `src/components/shader-sandbox.tsx` — `GLView` + animation frame around the host.
- `src/components/glsl-input.tsx` — line-numbered `TextInput`, symbol row, gutter markers, error list.
- `src/data/sketches/sketch-repository.ts` — the `SketchRepository` interface and `Sketch` type.
- `src/data/sketches/sqlite-sketch-repository.ts` — the implementation.
- `src/data/sketches/starter-sketch.ts` — the first-run shader source.
- `src/app/editor.tsx` — the Editor route.
- `src/components/preview-controls.tsx` — pause, restart and collapse the preview.
- `src/components/sketch-list-sheet.tsx` — switch, rename, delete.
- `docs/data/shader-sandbox.md` — the authoring contract and the remote-debugging caveat.

**Modified:**
- `src/data/database/migrations.ts` — add migration version 2.
- `src/context/data-context.tsx` — expose `sketchRepository` on the ready state.
- `src/components/bottom-navigation.tsx:49-67` — route to `/editor`; delete the `Alert`.

**Untouched on purpose:** `src/components/live-shader-preview.tsx`, `src/shaders/preview-registry.ts`, `src/app/bonus-scanline.tsx`, everything under `content/`.

---

### Task 1: Wrapper assembly and info-log parsing

Pure module, no React, no GL. This is where the arithmetic every error message depends on lives.

**Files:**
- Create: `src/shaders/shader-source.ts`
- Test: `src/shaders/__tests__/shader-source.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CompileError = { line: number | null; message: string; raw: string }`
  - `function wrapMainImageBody(body: string): { source: string; lineOffset: number }`
  - `function parseCompileLog(log: string, lineOffset: number): CompileError[]`
  - `const SHADER_BODY_LINE_OFFSET: number` (value 4)

- [ ] **Step 1: Write the failing tests**

Create `src/shaders/__tests__/shader-source.test.ts`:

```ts
import {
  SHADER_BODY_LINE_OFFSET,
  parseCompileLog,
  wrapMainImageBody,
} from "../shader-source";

describe("wrapMainImageBody", () => {
  it("reports an offset matching the prologue it emitted", () => {
    const { source, lineOffset } = wrapMainImageBody("  fragColor = vec4(1.0);");
    const prologue = source.split("\n").slice(0, lineOffset);

    expect(lineOffset).toBe(SHADER_BODY_LINE_OFFSET);
    expect(prologue).toEqual([
      "precision highp float;",
      "uniform vec3 iResolution;",
      "uniform float iTime;",
      "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
    ]);
  });

  it("places the body's first line directly after the prologue", () => {
    const { source, lineOffset } = wrapMainImageBody("float a = 1.0;\nfloat b = 2.0;");
    const lines = source.split("\n");

    expect(lines[lineOffset]).toBe("float a = 1.0;");
    expect(lines[lineOffset + 1]).toBe("float b = 2.0;");
  });

  it("writes gl_FragColor through a local rather than passing it as an out argument", () => {
    const { source } = wrapMainImageBody("fragColor = vec4(1.0);");

    expect(source).toContain("mainImage(shadercraftColor, gl_FragCoord.xy);");
    expect(source).toContain("gl_FragColor = shadercraftColor;");
    expect(source).not.toContain("mainImage(gl_FragColor");
  });

  it("closes mainImage before declaring main", () => {
    const { source } = wrapMainImageBody("fragColor = vec4(1.0);");

    expect(source.indexOf("}")).toBeLessThan(source.indexOf("void main()"));
  });

  it("declares no version directive and no stage-level in/out", () => {
    const { source } = wrapMainImageBody("fragColor = vec4(1.0);");

    expect(source).not.toContain("#version");
    expect(source).not.toMatch(/^\s*out\s+vec4/m);
  });
});

describe("parseCompileLog", () => {
  it("subtracts the prologue offset from a standard ERROR line", () => {
    const errors = parseCompileLog(
      "ERROR: 0:7: 'foo' : undeclared identifier",
      SHADER_BODY_LINE_OFFSET,
    );

    expect(errors).toEqual([
      {
        line: 3,
        message: "'foo' : undeclared identifier",
        raw: "ERROR: 0:7: 'foo' : undeclared identifier",
      },
    ]);
  });

  it("returns one entry per diagnostic line", () => {
    const errors = parseCompileLog(
      "ERROR: 0:5: 'x' : undeclared identifier\nERROR: 0:9: ';' : syntax error",
      SHADER_BODY_LINE_OFFSET,
    );

    expect(errors.map((error) => error.line)).toEqual([1, 5]);
  });

  it("clamps a diagnostic inside the prologue to line 1 and keeps its raw text", () => {
    const errors = parseCompileLog("ERROR: 0:2: 'iTime' : redefinition", SHADER_BODY_LINE_OFFSET);

    expect(errors[0].line).toBe(1);
    expect(errors[0].raw).toBe("ERROR: 0:2: 'iTime' : redefinition");
  });

  it("parses a bare file:line diagnostic with no severity prefix", () => {
    const errors = parseCompileLog("0:8: L0001: syntax error", SHADER_BODY_LINE_OFFSET);

    expect(errors[0]).toEqual({
      line: 4,
      message: "L0001: syntax error",
      raw: "0:8: L0001: syntax error",
    });
  });

  it("keeps a line it cannot parse, with a null line number", () => {
    const errors = parseCompileLog("Compilation failed", SHADER_BODY_LINE_OFFSET);

    expect(errors).toEqual([
      { line: null, message: "Compilation failed", raw: "Compilation failed" },
    ]);
  });

  it("keeps warnings so they are not silently dropped", () => {
    const errors = parseCompileLog("WARNING: 0:6: 'x' : unused", SHADER_BODY_LINE_OFFSET);

    expect(errors[0].line).toBe(2);
  });

  it("survives CRLF endings, blank lines and trailing null terminators", () => {
    const errors = parseCompileLog(
      "ERROR: 0:5: 'a' : bad\r\n\r\nERROR: 0:6: 'b' : bad\r\n\u0000",
      SHADER_BODY_LINE_OFFSET,
    );

    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.line)).toEqual([1, 2]);
    // Stripping the terminator must not strip the spaces inside a message.
    expect(errors[0].message).toBe("'a' : bad");
  });

  it("returns nothing for an empty log", () => {
    expect(parseCompileLog("", SHADER_BODY_LINE_OFFSET)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/shaders/__tests__/shader-source.test.ts`

Expected: FAIL — `Cannot find module '../shader-source'`.

- [ ] **Step 3: Implement the module**

Create `src/shaders/shader-source.ts`:

```ts
/**
 * The lines the app prepends to a learner's `mainImage` body. Their count is the offset every
 * reported error line is corrected by, so adding a line here shifts every error message: keep
 * {@link SHADER_BODY_LINE_OFFSET} derived from this array rather than hardcoded anywhere else.
 *
 * GLSL ES 1.00 deliberately: `ExpoWebGLRenderingContext` extends `WebGL2RenderingContext`, but the
 * Expo SDK 57 documentation warns that some older Android devices lack WebGL2. `out`/`in` on
 * function parameters is valid 1.00 — only stage-level `in`/`out` variables need 3.00 — so
 * `mainImage` compiles here and still pastes into Shadertoy.
 */
const PROLOGUE_LINES = [
  "precision highp float;",
  "uniform vec3 iResolution;",
  "uniform float iTime;",
  "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
] as const;

/**
 * Closes `mainImage` and calls it. `main` writes through a local instead of passing `gl_FragColor`
 * straight in as the `out` argument: both forms are arguably legal, but built-in variables as `out`
 * parameters are rejected by some drivers, and a local costs nothing.
 */
const EPILOGUE_LINES = [
  "}",
  "void main() {",
  "  vec4 shadercraftColor = vec4(0.0, 0.0, 0.0, 1.0);",
  "  mainImage(shadercraftColor, gl_FragCoord.xy);",
  "  gl_FragColor = shadercraftColor;",
  "}",
] as const;

/** How many wrapper lines sit above the learner's line 1. */
export const SHADER_BODY_LINE_OFFSET = PROLOGUE_LINES.length;

/**
 * One diagnostic from a shader or program info log.
 *
 * There is no `column`: GLSL info logs encode `sourceIndex:line`, where the leading number is which
 * source string the compiler was given, never a column. `raw` is always populated so the learner can
 * read exactly what the driver said even when nothing below could parse it.
 */
export type CompileError = {
  /** Line in the learner's buffer, already offset-corrected. `null` when the log carried none. */
  line: number | null;
  message: string;
  raw: string;
};

export function wrapMainImageBody(body: string): { source: string; lineOffset: number } {
  return {
    source: [...PROLOGUE_LINES, body, ...EPILOGUE_LINES].join("\n"),
    lineOffset: SHADER_BODY_LINE_OFFSET,
  };
}

/** `ERROR: 0:12: message` and `WARNING: 0:12: message` — the common ANGLE/Mesa/Adreno shape. */
const PREFIXED_DIAGNOSTIC = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.+)$/i;

/** `0:12: message` — the same thing without a severity word, seen on some Mali drivers. */
const BARE_DIAGNOSTIC = /^\d+:(\d+):\s*(.+)$/;

/**
 * Turns an info log into per-line diagnostics with line numbers translated back into the learner's
 * buffer. Only ever called after a failed compile or link, so retaining warnings alongside errors
 * gives context rather than noise.
 *
 * Driver log formats vary and are not contractual, so parsing is best-effort by design: an
 * unrecognized line still yields an entry carrying its text verbatim. Callers must show `rawLog`
 * regardless — line mapping must never be the only way to see what went wrong.
 */
export function parseCompileLog(log: string, lineOffset: number): CompileError[] {
  return log
    // Some drivers hand back the log with its C null terminator still attached.
    .replace(/\u0000/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((raw) => {
      const match = PREFIXED_DIAGNOSTIC.exec(raw) ?? BARE_DIAGNOSTIC.exec(raw);
      if (!match) return { line: null, message: raw, raw };

      const learnerLine = Number(match[1]) - lineOffset;
      return {
        // A diagnostic pointing into the prologue is the app's fault, not the learner's, but a
        // non-positive line number would be meaningless in the gutter. Clamp and keep `raw`.
        line: learnerLine >= 1 ? learnerLine : 1,
        message: match[2].trim(),
        raw,
      };
    });
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest src/shaders/__tests__/shader-source.test.ts`

Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/shaders/shader-source.ts src/shaders/__tests__/shader-source.test.ts
git commit -m "feat(shaders): wrap authored mainImage bodies and map compiler lines"
```

---

### Task 2: A scriptable fake WebGL context

Test-only. Task 3 cannot be tested without it, and hand-rolling it inside one test file would leave Task 3's leak assertions unrepeatable.

**Files:**
- Create: `src/shaders/testing/fake-gl.ts`
- Test: `src/shaders/__tests__/fake-gl.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type FakeGlScript = { failShaderCompile?: boolean; failProgramLink?: boolean; shaderLog?: string; programLog?: string }`
  - `function createFakeGl(script?: FakeGlScript): FakeGl`
  - `type FakeGl` exposing `liveObjectCount(): number`, `createdCount(): number`, `deletedCount(): number`, `uniformCalls: Array<{ name: string; values: number[] }>`, `drawCount(): number`

- [ ] **Step 1: Write the failing test**

Create `src/shaders/__tests__/fake-gl.test.ts`:

```ts
import { createFakeGl } from "../testing/fake-gl";

describe("createFakeGl", () => {
  it("reports a compiled shader as successful by default", () => {
    const gl = createFakeGl();
    const shader = gl.createShader(gl.FRAGMENT_SHADER);

    gl.shaderSource(shader, "void main() {}");
    gl.compileShader(shader);

    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(true);
  });

  it("fails compilation and returns the scripted log when told to", () => {
    const gl = createFakeGl({ failShaderCompile: true, shaderLog: "ERROR: 0:7: nope" });
    const shader = gl.createShader(gl.FRAGMENT_SHADER);

    gl.compileShader(shader);

    expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(false);
    expect(gl.getShaderInfoLog(shader)).toBe("ERROR: 0:7: nope");
  });

  it("fails linking independently of compilation", () => {
    const gl = createFakeGl({ failProgramLink: true, programLog: "ERROR: link failed" });
    const program = gl.createProgram();

    gl.linkProgram(program);

    expect(gl.getProgramParameter(program, gl.LINK_STATUS)).toBe(false);
    expect(gl.getProgramInfoLog(program)).toBe("ERROR: link failed");
  });

  it("tracks created and deleted objects so leaks are observable", () => {
    const gl = createFakeGl();
    const shader = gl.createShader(gl.VERTEX_SHADER);
    const program = gl.createProgram();

    expect(gl.liveObjectCount()).toBe(2);

    gl.deleteShader(shader);
    gl.deleteProgram(program);

    expect(gl.liveObjectCount()).toBe(0);
    expect(gl.createdCount()).toBe(2);
    expect(gl.deletedCount()).toBe(2);
  });

  it("records uniform writes and draw calls", () => {
    const gl = createFakeGl();
    const program = gl.createProgram();
    const location = gl.getUniformLocation(program, "iTime");

    gl.uniform1f(location, 1.5);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    expect(gl.uniformCalls).toEqual([{ name: "iTime", values: [1.5] }]);
    expect(gl.drawCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx jest src/shaders/__tests__/fake-gl.test.ts`

Expected: FAIL — `Cannot find module '../testing/fake-gl'`.

- [ ] **Step 3: Implement the fake**

Create `src/shaders/testing/fake-gl.ts`:

```ts
/**
 * A scriptable stand-in for `ExpoWebGLRenderingContext`, covering only the calls
 * {@link ShaderProgramHost} makes. No Jest environment provides a real GL context, and the behaviour
 * worth testing — that a failed compile is reported rather than thrown, and that every superseded
 * program is deleted — is invisible without one.
 *
 * Object identity is a plain incrementing handle, which is enough for the host: it never inspects a
 * program, only holds and deletes it.
 */
export type FakeGlScript = {
  failShaderCompile?: boolean;
  failProgramLink?: boolean;
  shaderLog?: string;
  programLog?: string;
};

type Handle = { id: number; kind: "shader" | "program" | "buffer" };

export type FakeGl = ReturnType<typeof createFakeGl>;

export function createFakeGl(script: FakeGlScript = {}) {
  let nextId = 1;
  const live = new Set<number>();
  let created = 0;
  let deleted = 0;
  let draws = 0;
  const uniformNames = new Map<number, string>();

  const make = (kind: Handle["kind"]): Handle => {
    const handle = { id: nextId++, kind };
    live.add(handle.id);
    created += 1;
    return handle;
  };

  const destroy = (handle: Handle | null) => {
    if (!handle) return;
    if (live.delete(handle.id)) deleted += 1;
  };

  return {
    // Enum values only need to be distinct; nothing compares them to real GL constants.
    FRAGMENT_SHADER: 0x8b30,
    VERTEX_SHADER: 0x8b31,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    STATIC_DRAW: 0x88e4,
    TRIANGLES: 0x0004,
    FLOAT: 0x1406,
    COLOR_BUFFER_BIT: 0x4000,

    createShader: (_type: number) => make("shader"),
    shaderSource: (_shader: Handle, _source: string) => undefined,
    compileShader: (_shader: Handle) => undefined,
    getShaderParameter: (_shader: Handle, _parameter: number) => !script.failShaderCompile,
    getShaderInfoLog: (_shader: Handle) => script.shaderLog ?? "",
    deleteShader: destroy,

    createProgram: () => make("program"),
    attachShader: (_program: Handle, _shader: Handle) => undefined,
    linkProgram: (_program: Handle) => undefined,
    getProgramParameter: (_program: Handle, _parameter: number) => !script.failProgramLink,
    getProgramInfoLog: (_program: Handle) => script.programLog ?? "",
    deleteProgram: destroy,
    useProgram: (_program: Handle | null) => undefined,

    createBuffer: () => make("buffer"),
    bindBuffer: (_target: number, _buffer: Handle | null) => undefined,
    bufferData: (_target: number, _data: Float32Array, _usage: number) => undefined,
    deleteBuffer: destroy,

    getAttribLocation: (_program: Handle, _name: string) => 0,
    enableVertexAttribArray: (_index: number) => undefined,
    vertexAttribPointer: () => undefined,

    getUniformLocation: (_program: Handle, name: string) => {
      const id = nextId++;
      uniformNames.set(id, name);
      return { id };
    },
    uniform1f(location: { id: number } | null, value: number) {
      if (location) this.uniformCalls.push({ name: uniformNames.get(location.id) ?? "?", values: [value] });
    },
    uniform3f(location: { id: number } | null, x: number, y: number, z: number) {
      if (location) this.uniformCalls.push({ name: uniformNames.get(location.id) ?? "?", values: [x, y, z] });
    },

    viewport: () => undefined,
    clearColor: () => undefined,
    clear: (_mask: number) => undefined,
    drawArrays: (_mode: number, _first: number, _count: number) => {
      draws += 1;
    },
    endFrameEXP: () => undefined,

    drawingBufferWidth: 400,
    drawingBufferHeight: 300,

    uniformCalls: [] as Array<{ name: string; values: number[] }>,
    liveObjectCount: () => live.size,
    createdCount: () => created,
    deletedCount: () => deleted,
    drawCount: () => draws,
  };
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx jest src/shaders/__tests__/fake-gl.test.ts`

Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/shaders/testing/fake-gl.ts src/shaders/__tests__/fake-gl.test.ts
git commit -m "test(shaders): add a scriptable fake WebGL context"
```

---

### Task 3: Program host — compile, swap, retain, delete

The behavioural core. A failed compile must return errors rather than throw, and must leave the previously working program rendering.

**Files:**
- Create: `src/shaders/shader-program-host.ts`
- Test: `src/shaders/__tests__/shader-program-host.test.ts`

**Interfaces:**
- Consumes: `wrapMainImageBody`, `parseCompileLog`, `CompileError` from `./shader-source`; `createFakeGl` from `./testing/fake-gl` (tests only).
- Produces:
  - `type HostCompileResult = { ok: true } | { ok: false; errors: CompileError[]; rawLog: string; showingLastWorking: boolean }`
  - `class ShaderProgramHost` with:
    - `constructor(gl: ExpoWebGLRenderingContext)`
    - `setBody(body: string): HostCompileResult`
    - `hasProgram(): boolean`
    - `render(timeSeconds: number, width: number, height: number): void`
    - `dispose(): void`

- [ ] **Step 1: Write the failing tests**

Create `src/shaders/__tests__/shader-program-host.test.ts`:

```ts
import { ShaderProgramHost } from "../shader-program-host";
import { createFakeGl, type FakeGl } from "../testing/fake-gl";

const BODY = "fragColor = vec4(1.0);";

// The host only uses the subset of the GL surface the fake implements; the cast keeps the
// production signature honest without importing an expo-gl type Jest cannot construct.
const host = (gl: FakeGl) => new ShaderProgramHost(gl as never);

describe("ShaderProgramHost", () => {
  it("compiles a body and reports success", () => {
    const gl = createFakeGl();
    const result = host(gl).setBody(BODY);

    expect(result).toEqual({ ok: true });
  });

  it("returns mapped errors instead of throwing when compilation fails", () => {
    const gl = createFakeGl({
      failShaderCompile: true,
      shaderLog: "ERROR: 0:5: 'x' : undeclared identifier",
    });

    const result = host(gl).setBody(BODY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.errors[0].line).toBe(1);
    expect(result.rawLog).toBe("ERROR: 0:5: 'x' : undeclared identifier");
    expect(result.showingLastWorking).toBe(false);
  });

  it("returns errors instead of throwing when linking fails", () => {
    const gl = createFakeGl({ failProgramLink: true, programLog: "ERROR: link failed" });

    const result = host(gl).setBody(BODY);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.rawLog).toBe("ERROR: link failed");
  });

  it("still has a program to render after a failed recompile", () => {
    let failing = false;
    const gl = createFakeGl();
    // Swap the compile verdict after the first successful compile.
    const original = gl.getShaderParameter;
    gl.getShaderParameter = ((...args: Parameters<typeof original>) =>
      failing ? false : original(...args)) as typeof original;
    gl.getShaderInfoLog = (() => "ERROR: 0:6: broken") as typeof gl.getShaderInfoLog;

    const subject = host(gl);
    expect(subject.setBody(BODY).ok).toBe(true);

    failing = true;
    const result = subject.setBody("broken");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.showingLastWorking).toBe(true);
    expect(subject.hasProgram()).toBe(true);
  });

  it("deletes the superseded program so repeated edits do not leak", () => {
    const gl = createFakeGl();
    const subject = host(gl);

    for (let index = 0; index < 5; index += 1) {
      subject.setBody(`float a = ${index}.0; fragColor = vec4(a);`);
    }

    // One program plus one position buffer survive; every superseded program and every shader is gone.
    expect(gl.liveObjectCount()).toBe(2);
  });

  it("deletes shaders after a successful link", () => {
    const gl = createFakeGl();
    host(gl).setBody(BODY);

    expect(gl.deletedCount()).toBe(2);
  });

  it("deletes the shader it created when compilation fails", () => {
    const gl = createFakeGl({ failShaderCompile: true });
    host(gl).setBody(BODY);

    expect(gl.liveObjectCount()).toBe(0);
  });

  it("skips recompilation when the body has not changed", () => {
    const gl = createFakeGl();
    const subject = host(gl);

    subject.setBody(BODY);
    const afterFirst = gl.createdCount();
    subject.setBody(BODY);

    expect(gl.createdCount()).toBe(afterFirst);
  });

  it("does not compile an empty body", () => {
    const gl = createFakeGl();
    const subject = host(gl);

    const result = subject.setBody("   \n  ");

    expect(result.ok).toBe(false);
    expect(subject.hasProgram()).toBe(false);
    expect(gl.createdCount()).toBe(0);
  });

  it("writes iResolution and iTime and draws when a program exists", () => {
    const gl = createFakeGl();
    const subject = host(gl);
    subject.setBody(BODY);

    subject.render(2.5, 400, 300);

    expect(gl.uniformCalls).toEqual([
      { name: "iResolution", values: [400, 300, 1] },
      { name: "iTime", values: [2.5] },
    ]);
    expect(gl.drawCount()).toBe(1);
  });

  it("does not draw when nothing has compiled", () => {
    const gl = createFakeGl();

    host(gl).render(0, 400, 300);

    expect(gl.drawCount()).toBe(0);
  });

  it("releases every object on dispose", () => {
    const gl = createFakeGl();
    const subject = host(gl);
    subject.setBody(BODY);

    subject.dispose();

    expect(gl.liveObjectCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/shaders/__tests__/shader-program-host.test.ts`

Expected: FAIL — `Cannot find module '../shader-program-host'`.

- [ ] **Step 3: Implement the host**

Create `src/shaders/shader-program-host.ts`:

```ts
import type { ExpoWebGLRenderingContext } from "expo-gl";

import { type CompileError, parseCompileLog, wrapMainImageBody } from "./shader-source";

/**
 * A full-viewport triangle pair. `fragCoord` comes from `gl_FragCoord.xy`, so the vertex stage needs
 * to pass nothing through — unlike `live-shader-preview.tsx`, which forwards a `v_uv` varying.
 */
const VERTEX_SHADER_SOURCE = `attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const QUAD_VERTICES = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export type HostCompileResult =
  | { ok: true }
  | {
      ok: false;
      errors: CompileError[];
      rawLog: string;
      /** True when a previously working program is still on screen behind this failure. */
      showingLastWorking: boolean;
    };

type ActiveProgram = {
  program: WebGLProgram;
  resolution: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
};

/**
 * Owns one GL program's whole life: compile a learner's `mainImage` body, swap it in only if it
 * linked, delete whatever it replaced, and keep drawing the last program that worked when it did not.
 *
 * This is a class rather than component state because the two guarantees that matter — a failed
 * compile never blanks the preview, and no program leaks across an editing session — are otherwise
 * only observable by hand on a device. Here they are ordinary unit tests against a fake context.
 */
export class ShaderProgramHost {
  private readonly gl: ExpoWebGLRenderingContext;
  private active: ActiveProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private lastCompiledBody: string | null = null;

  constructor(gl: ExpoWebGLRenderingContext) {
    this.gl = gl;
  }

  hasProgram(): boolean {
    return this.active !== null;
  }

  /**
   * Compiles `body` and, on success, makes it the program subsequent {@link render} calls draw.
   * Returns the outcome rather than throwing: half-typed source is the normal state of an editor, not
   * an exceptional one.
   */
  setBody(body: string): HostCompileResult {
    if (body.trim().length === 0) {
      return {
        ok: false,
        errors: [],
        rawLog: "",
        showingLastWorking: this.active !== null,
      };
    }

    if (body === this.lastCompiledBody) return { ok: true };

    const { source, lineOffset } = wrapMainImageBody(body);
    const gl = this.gl;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    if (!vertexShader.ok) return this.failure(vertexShader.log, lineOffset);

    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, source);
    if (!fragmentShader.ok) {
      gl.deleteShader(vertexShader.shader);
      return this.failure(fragmentShader.log, lineOffset);
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertexShader.shader);
      gl.deleteShader(fragmentShader.shader);
      return this.failure("Unable to create shader program", lineOffset);
    }

    gl.attachShader(program, vertexShader.shader);
    gl.attachShader(program, fragmentShader.shader);
    gl.linkProgram(program);

    // Shaders are attached to the program and can go regardless of the link verdict.
    gl.deleteShader(vertexShader.shader);
    gl.deleteShader(fragmentShader.shader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "Unable to link shader program";
      gl.deleteProgram(program);
      return this.failure(log, lineOffset);
    }

    // Only now is the previous program safe to drop.
    if (this.active) gl.deleteProgram(this.active.program);

    this.active = {
      program,
      resolution: gl.getUniformLocation(program, "iResolution"),
      time: gl.getUniformLocation(program, "iTime"),
    };
    this.lastCompiledBody = body;
    this.ensureBuffer(program);

    return { ok: true };
  }

  render(timeSeconds: number, width: number, height: number): void {
    const active = this.active;
    if (!active) return;

    const gl = this.gl;
    gl.useProgram(active.program);
    gl.viewport(0, 0, width, height);
    gl.uniform3f(active.resolution, width, height, 1);
    gl.uniform1f(active.time, timeSeconds);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.active) gl.deleteProgram(this.active.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    this.active = null;
    this.buffer = null;
    this.lastCompiledBody = null;
  }

  private compileShader(
    type: number,
    source: string,
  ): { ok: true; shader: WebGLShader } | { ok: false; log: string } {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return { ok: false, log: "Unable to create shader" };

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? "Unknown shader compilation error";
      gl.deleteShader(shader);
      return { ok: false, log };
    }

    return { ok: true, shader };
  }

  private failure(log: string, lineOffset: number): HostCompileResult {
    return {
      ok: false,
      errors: parseCompileLog(log, lineOffset),
      rawLog: log,
      showingLastWorking: this.active !== null,
    };
  }

  /** The quad never changes, so it is uploaded once and rebound to each new program. */
  private ensureBuffer(program: WebGLProgram): void {
    const gl = this.gl;

    if (!this.buffer) {
      this.buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    }

    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest src/shaders/__tests__/shader-program-host.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/shaders/shader-program-host.ts src/shaders/__tests__/shader-program-host.test.ts
git commit -m "feat(shaders): own program lifecycle with last-good retention"
```

---

### Task 4: The sandbox component

A thin wrapper: `GLView`, an animation frame, and a placeholder before anything compiles. All decision logic already lives in the host.

**Files:**
- Create: `src/components/shader-sandbox.tsx`
- Test: `src/components/__tests__/shader-sandbox.test.tsx`

**Interfaces:**
- Consumes: `ShaderProgramHost`, `HostCompileResult` from `../shaders/shader-program-host`.
- Produces:
  - `type ShaderSandboxProps = { source: string; paused?: boolean; restartToken?: number; height?: number; onCompileResult?: (result: HostCompileResult) => void }`
  - `function ShaderSandbox(props: ShaderSandboxProps): JSX.Element`

- [ ] **Step 1: Write the failing test**

Create `src/components/__tests__/shader-sandbox.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { ShaderSandbox } from "../shader-sandbox";

// `GLView` never receives a context under Jest, so it is replaced with a view that records the
// props the sandbox hands it. This mirrors how `lesson-workspace.test.tsx` stands in for the preview.
jest.mock("expo-gl", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");

  return {
    GLView: ({ style }: { style?: unknown }) =>
      React.createElement(View, { style, testID: "gl-view" }),
  };
});

describe("ShaderSandbox", () => {
  it("renders a GL surface", () => {
    render(<ShaderSandbox source="fragColor = vec4(1.0);" />);

    expect(screen.getByTestId("gl-view")).toBeTruthy();
  });

  it("shows a placeholder until a program has compiled", () => {
    render(<ShaderSandbox source="fragColor = vec4(1.0);" />);

    expect(screen.getByText("Preview starts once your shader compiles")).toBeTruthy();
  });

  it("honours an explicit height", () => {
    render(<ShaderSandbox height={120} source="fragColor = vec4(1.0);" />);

    expect(screen.getByTestId("shader-sandbox").props.style).toEqual(
      expect.objectContaining({ height: 120 }),
    );
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/components/__tests__/shader-sandbox.test.tsx`

Expected: FAIL — `Cannot find module '../shader-sandbox'`.

- [ ] **Step 3: Implement the component**

Create `src/components/shader-sandbox.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";

import { Colors, Spacing } from "../constants/theme";
import {
  ShaderProgramHost,
  type HostCompileResult,
} from "../shaders/shader-program-host";

const DEFAULT_HEIGHT = 220;

type ShaderSandboxProps = {
  /** A `mainImage` body. The wrapper is added by `wrapMainImageBody`. */
  source: string;
  paused?: boolean;
  /** Increment to reset `iTime` to zero without remounting. */
  restartToken?: number;
  height?: number;
  onCompileResult?: (result: HostCompileResult) => void;
};

export function ShaderSandbox({
  source,
  paused = false,
  restartToken = 0,
  height = DEFAULT_HEIGHT,
  onCompileResult,
}: ShaderSandboxProps) {
  const hostRef = useRef<ShaderProgramHost | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const startedAtRef = useRef(0);
  const pausedRef = useRef(paused);
  const sourceRef = useRef(source);
  const onCompileResultRef = useRef(onCompileResult);
  const [hasRendered, setHasRendered] = useState(false);

  // Kept in refs so a new source or a pause toggle never restarts the animation frame loop.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    onCompileResultRef.current = onCompileResult;
  }, [onCompileResult]);

  useEffect(() => {
    startedAtRef.current = globalThis.performance.now();
  }, [restartToken]);

  useEffect(() => {
    sourceRef.current = source;
    const host = hostRef.current;
    if (!host) return;

    const result = host.setBody(source);
    onCompileResultRef.current?.(result);
    if (host.hasProgram()) setHasRendered(true);
  }, [source]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      hostRef.current?.dispose();
      hostRef.current = null;
    };
  }, []);

  const createContext = (gl: ExpoWebGLRenderingContext) => {
    const host = new ShaderProgramHost(gl);
    hostRef.current = host;
    startedAtRef.current = globalThis.performance.now();

    const result = host.setBody(sourceRef.current);
    onCompileResultRef.current?.(result);
    if (host.hasProgram()) setHasRendered(true);

    let pausedAtSeconds = 0;

    const render = () => {
      if (!mountedRef.current) return;

      if (!pausedRef.current) {
        pausedAtSeconds = (globalThis.performance.now() - startedAtRef.current) / 1000;
      }

      host.render(pausedAtSeconds, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.endFrameEXP();

      frameRef.current = requestAnimationFrame(render);
    };

    render();
  };

  return (
    <View style={[styles.container, { height }]} testID="shader-sandbox">
      <GLView onContextCreate={createContext} style={styles.glView} />
      {!hasRendered && (
        <View pointerEvents="none" style={styles.placeholder}>
          <Text style={styles.placeholderText}>Preview starts once your shader compiles</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surfaceRaised,
    overflow: "hidden",
    position: "relative",
  },
  glView: {
    flex: 1,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: Colors.surfaceRaised,
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  placeholderText: {
    color: Colors.textSubtle,
    fontSize: 13,
    textAlign: "center",
  },
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest src/components/__tests__/shader-sandbox.test.tsx`

Expected: PASS, 3 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/shader-sandbox.tsx src/components/__tests__/shader-sandbox.test.tsx
git commit -m "feat(components): add a live shader sandbox surface"
```

---

### Task 5: The editing surface

**Files:**
- Create: `src/components/glsl-input.tsx`
- Test: `src/components/__tests__/glsl-input.test.tsx`

**Interfaces:**
- Consumes: `CompileError` from `../shaders/shader-source`.
- Produces:
  - `const GLSL_SYMBOLS: readonly string[]`
  - `type GlslInputProps = { initialValue: string; errors: CompileError[]; onChange: (source: string) => void }`
  - `function GlslInput(props: GlslInputProps): JSX.Element`

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/glsl-input.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { GlslInput } from "../glsl-input";

const noop = () => undefined;

describe("GlslInput", () => {
  it("renders the initial source", () => {
    render(<GlslInput errors={[]} initialValue="float a = 1.0;" onChange={noop} />);

    expect(screen.getByTestId("glsl-input").props.defaultValue).toBe("float a = 1.0;");
  });

  it("numbers every logical line", () => {
    render(<GlslInput errors={[]} initialValue={"a;\nb;\nc;"} onChange={noop} />);

    expect(screen.getByTestId("glsl-gutter")).toHaveTextContent("1");
    expect(screen.getByTestId("glsl-gutter")).toHaveTextContent("3");
  });

  it("reports edits to the caller", () => {
    const onChange = jest.fn();
    render(<GlslInput errors={[]} initialValue="a;" onChange={onChange} />);

    fireEvent.changeText(screen.getByTestId("glsl-input"), "b;");

    expect(onChange).toHaveBeenCalledWith("b;");
  });

  it("inserts a symbol at the caret and reports the result", () => {
    const onChange = jest.fn();
    render(<GlslInput errors={[]} initialValue="vec2 p = ;" onChange={onChange} />);

    fireEvent(screen.getByTestId("glsl-input"), "selectionChange", {
      nativeEvent: { selection: { start: 9, end: 9 } },
    });
    fireEvent.press(screen.getByText("vec2"));

    expect(onChange).toHaveBeenCalledWith("vec2 p = vec2;");
  });

  it("appends a symbol when the caret position is unknown", () => {
    const onChange = jest.fn();
    render(<GlslInput errors={[]} initialValue="a" onChange={onChange} />);

    fireEvent.press(screen.getByText(";"));

    expect(onChange).toHaveBeenCalledWith("a;");
  });

  it("lists errors with their line numbers", () => {
    render(
      <GlslInput
        errors={[{ line: 2, message: "'x' : undeclared identifier", raw: "ERROR: 0:6: …" }]}
        initialValue={"a;\nb;"}
        onChange={noop}
      />,
    );

    expect(screen.getByText("Line 2")).toBeTruthy();
    expect(screen.getByText("'x' : undeclared identifier")).toBeTruthy();
  });

  it("shows an unlocated error without inventing a line number", () => {
    render(
      <GlslInput
        errors={[{ line: null, message: "Compilation failed", raw: "Compilation failed" }]}
        initialValue="a;"
        onChange={noop}
      />,
    );

    expect(screen.getByText("Compilation failed")).toBeTruthy();
    expect(screen.queryByText(/^Line /)).toBeNull();
  });

  it("disables the keyboard behaviours that corrupt source code", () => {
    render(<GlslInput errors={[]} initialValue="a;" onChange={noop} />);
    const input = screen.getByTestId("glsl-input");

    expect(input.props.autoCorrect).toBe(false);
    expect(input.props.autoCapitalize).toBe("none");
    expect(input.props.spellCheck).toBe(false);
    expect(input.props.multiline).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/components/__tests__/glsl-input.test.tsx`

Expected: FAIL — `Cannot find module '../glsl-input'`.

- [ ] **Step 3: Implement the component**

Create `src/components/glsl-input.tsx`:

```tsx
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";
import type { CompileError } from "../shaders/shader-source";

/**
 * The characters and identifiers phone keyboards bury behind two taps, ordered by how often GLSL
 * needs them. Multi-character entries insert verbatim; nothing here adds surrounding whitespace,
 * because guessing where a learner wants a space is worse than letting them type it.
 */
export const GLSL_SYMBOLS = [
  ";",
  "(",
  ")",
  "{",
  "}",
  ".",
  ",",
  "*",
  "/",
  "-",
  "+",
  "=",
  "<",
  ">",
  "[",
  "]",
  "vec2",
  "vec3",
  "vec4",
  "float",
  "length",
  "mix",
  "smoothstep",
] as const;

type GlslInputProps = {
  initialValue: string;
  errors: CompileError[];
  onChange: (source: string) => void;
};

export function GlslInput({ initialValue, errors, onChange }: GlslInputProps) {
  // The buffer is tracked in a ref, not state: re-rendering on every keystroke would re-render the
  // preview tree alongside it. `lineCount` is the only piece the UI needs, so it alone is state.
  const valueRef = useRef(initialValue);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const [lineCount, setLineCount] = useState(() => countLines(initialValue));

  const errorLines = useMemo(
    () => new Set(errors.map((error) => error.line).filter((line): line is number => line !== null)),
    [errors],
  );

  const apply = useCallback(
    (next: string) => {
      valueRef.current = next;
      setLineCount(countLines(next));
      onChange(next);
    },
    [onChange],
  );

  const handleChangeText = useCallback(
    (next: string) => {
      apply(next);
    },
    [apply],
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = event.nativeEvent.selection;
    },
    [],
  );

  const insert = useCallback(
    (symbol: string) => {
      const value = valueRef.current;
      const selection = selectionRef.current;
      // With no observed caret — the input has not been focused yet — appending is the only
      // non-destructive choice.
      const start = selection?.start ?? value.length;
      const end = selection?.end ?? value.length;
      const next = `${value.slice(0, start)}${symbol}${value.slice(end)}`;

      const caret = start + symbol.length;
      selectionRef.current = { start: caret, end: caret };
      inputRef.current?.setNativeProps({ selection: { start: caret, end: caret } });

      apply(next);
    },
    [apply],
  );

  return (
    <View style={styles.container}>
      <View style={styles.editorRow}>
        <View style={styles.gutter} testID="glsl-gutter">
          {Array.from({ length: lineCount }, (_unused, index) => index + 1).map((line) => (
            <Text
              key={line}
              style={[styles.gutterLine, errorLines.has(line) && styles.gutterLineError]}
            >
              {line}
            </Text>
          ))}
        </View>
        <TextInput
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          defaultValue={initialValue}
          keyboardAppearance="dark"
          multiline
          onChangeText={handleChangeText}
          onSelectionChange={handleSelectionChange}
          ref={inputRef}
          // Horizontal scrolling instead of wrapping: a wrapped line would desynchronize the gutter
          // from the line numbers every error message refers to.
          scrollEnabled
          spellCheck={false}
          style={styles.input}
          testID="glsl-input"
          textAlignVertical="top"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.symbolRowContent}
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        style={styles.symbolRow}
      >
        {GLSL_SYMBOLS.map((symbol) => (
          <Pressable
            accessibilityRole="button"
            key={symbol}
            onPress={() => insert(symbol)}
            style={({ pressed }) => [styles.symbol, pressed && styles.symbolPressed]}
          >
            <Text style={styles.symbolText}>{symbol}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {errors.length > 0 && (
        <View style={styles.errorList} testID="glsl-errors">
          {errors.map((error, index) => (
            <View key={`${error.raw}-${index}`} style={styles.errorRow}>
              {error.line !== null && <Text style={styles.errorLine}>Line {error.line}</Text>}
              <Text style={styles.errorMessage}>{error.message}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function countLines(value: string): number {
  return value.split("\n").length;
}

const MONOSPACE_LINE_HEIGHT = 20;

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    flex: 1,
  },
  editorRow: {
    flex: 1,
    flexDirection: "row",
  },
  gutter: {
    backgroundColor: Colors.background,
    borderRightColor: Colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  gutterLine: {
    color: Colors.textSubtle,
    fontFamily: "JetBrainsMono-Regular",
    fontSize: 12,
    lineHeight: MONOSPACE_LINE_HEIGHT,
    textAlign: "right",
  },
  gutterLineError: {
    color: Colors.coral,
    fontWeight: "700",
  },
  input: {
    color: Colors.text,
    flex: 1,
    fontFamily: "JetBrainsMono-Regular",
    fontSize: 13,
    lineHeight: MONOSPACE_LINE_HEIGHT,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  symbolRow: {
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  symbolRowContent: {
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  symbol: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.sm,
    minWidth: 34,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  symbolPressed: {
    backgroundColor: Colors.border,
  },
  symbolText: {
    color: Colors.text,
    fontFamily: "JetBrainsMono-Regular",
    fontSize: 13,
    textAlign: "center",
  },
  errorList: {
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
    maxHeight: 120,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  errorRow: {
    gap: 2,
  },
  errorLine: {
    color: Colors.coral,
    fontFamily: "JetBrainsMono-Regular",
    fontSize: 11,
  },
  errorMessage: {
    color: Colors.textMuted,
    fontSize: 12,
  },
});
```

- [ ] **Step 4: Confirm the font family name matches what the app loads**

Run: `grep -rn "JetBrains\|useFonts\|loadAsync" src/ app.json`

If the loaded family name differs, update every `fontFamily` above to match. If no monospace font is loaded, replace them with `Platform.select({ android: "monospace", ios: "Menlo", default: "monospace" })` and import `Platform`.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx jest src/components/__tests__/glsl-input.test.tsx`

Expected: PASS, 8 tests.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/glsl-input.tsx src/components/__tests__/glsl-input.test.tsx
git commit -m "feat(components): add a GLSL editing surface with a symbol row"
```

---

### Task 6: Sketch persistence

**Files:**
- Create: `src/data/sketches/sketch-repository.ts`
- Create: `src/data/sketches/sqlite-sketch-repository.ts`
- Create: `src/data/sketches/starter-sketch.ts`
- Modify: `src/data/database/migrations.ts` — append migration version 2
- Test: `src/data/sketches/__tests__/sketch-repository.test.ts`

**Interfaces:**
- Consumes: `DatabaseDriver` from `../database/driver`.
- Produces:
  - `type Sketch = { id: string; title: string; source: string; createdAt: string; updatedAt: string }`
  - `interface SketchRepository` with `list(profileId)`, `get(profileId, id)`, `create(profileId, title, source)`, `updateSource(profileId, id, source)`, `rename(profileId, id, title)`, `delete(profileId, id)`
  - `class SqliteSketchRepository` — `constructor(driver: DatabaseDriver, options?: { generateId?: () => string; now?: () => string })`
  - `const STARTER_SKETCH_SOURCE: string` and `const STARTER_SKETCH_TITLE: string`

- [ ] **Step 1: Write the failing tests**

Create `src/data/sketches/__tests__/sketch-repository.test.ts`:

```ts
import { migrateDatabase } from "../../database/migrations";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import { SqliteSketchRepository } from "../sqlite-sketch-repository";

const PROFILE_A = "profile-a";
const PROFILE_B = "profile-b";

async function createContext() {
  const driver = new NodeSqliteDriver(":memory:");
  await migrateDatabase(driver);

  for (const id of [PROFILE_A, PROFILE_B]) {
    await driver.run(
      `INSERT INTO learner_profiles (id, kind, supabase_user_id, merged_into_profile_id, created_at, last_used_at)
       VALUES (?, 'anonymous', NULL, NULL, ?, ?)`,
      [id, "2026-08-06T00:00:00.000Z", "2026-08-06T00:00:00.000Z"],
    );
  }

  let nextId = 0;
  let clock = 0;
  const repository = new SqliteSketchRepository(driver, {
    generateId: () => `sketch-${++nextId}`,
    // A strictly increasing clock so `updatedAt DESC` ordering is assertable.
    now: () => `2026-08-06T00:00:${String(clock++).padStart(2, "0")}.000Z`,
  });

  return { driver, repository };
}

describe("SqliteSketchRepository", () => {
  let context: Awaited<ReturnType<typeof createContext>>;

  beforeEach(async () => {
    context = await createContext();
  });

  afterEach(async () => {
    await context.driver.close();
  });

  it("creates a sketch and reads it back", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "fragColor = vec4(1.0);");

    expect(created.id).toBe("sketch-1");
    expect(created.title).toBe("First");
    expect(await context.repository.get(PROFILE_A, created.id)).toEqual(created);
  });

  it("lists sketches most recently updated first", async () => {
    const first = await context.repository.create(PROFILE_A, "First", "a");
    const second = await context.repository.create(PROFILE_A, "Second", "b");
    await context.repository.updateSource(PROFILE_A, first.id, "a2");

    const listed = await context.repository.list(PROFILE_A);

    expect(listed.map((sketch) => sketch.id)).toEqual([first.id, second.id]);
  });

  it("isolates sketches per profile", async () => {
    const mine = await context.repository.create(PROFILE_A, "Mine", "a");

    expect(await context.repository.list(PROFILE_B)).toEqual([]);
    expect(await context.repository.get(PROFILE_B, mine.id)).toBeNull();
  });

  it("refuses to update another profile's sketch", async () => {
    const mine = await context.repository.create(PROFILE_A, "Mine", "a");

    await context.repository.updateSource(PROFILE_B, mine.id, "hacked");

    expect((await context.repository.get(PROFILE_A, mine.id))?.source).toBe("a");
  });

  it("advances updatedAt but preserves createdAt on a source update", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.updateSource(PROFILE_A, created.id, "b");

    const updated = await context.repository.get(PROFILE_A, created.id);

    expect(updated?.source).toBe("b");
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.updatedAt).not.toBe(created.updatedAt);
  });

  it("is idempotent when autosave writes the same source twice", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.updateSource(PROFILE_A, created.id, "b");
    const afterFirst = await context.repository.get(PROFILE_A, created.id);
    await context.repository.updateSource(PROFILE_A, created.id, "b");

    expect(await context.repository.get(PROFILE_A, created.id)).toEqual(afterFirst);
  });

  it("renames without touching the source", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.rename(PROFILE_A, created.id, "Renamed");

    const renamed = await context.repository.get(PROFILE_A, created.id);

    expect(renamed?.title).toBe("Renamed");
    expect(renamed?.source).toBe("a");
  });

  it("deletes a sketch", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.delete(PROFILE_A, created.id);

    expect(await context.repository.get(PROFILE_A, created.id)).toBeNull();
  });

  it("removes a profile's sketches when the profile is deleted", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.driver.run("DELETE FROM learner_profiles WHERE id = ?", [PROFILE_A]);

    expect(await context.repository.get(PROFILE_A, created.id)).toBeNull();
  });

  it("writes no outbox rows, because sketches are local-only", async () => {
    await context.repository.create(PROFILE_A, "First", "a");

    const outbox = await context.driver.all("SELECT * FROM sync_outbox");

    expect(outbox).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/data/sketches/__tests__/sketch-repository.test.ts`

Expected: FAIL — `Cannot find module '../sqlite-sketch-repository'`.

- [ ] **Step 3: Add the migration**

In `src/data/database/migrations.ts`, add above the `migrations` array:

```ts
/**
 * Learner-authored shader sketches. Partitioned by profile exactly as `lesson_progress` is, so
 * switching accounts shows that account's work — and so cloud sync stays possible later without a
 * second migration. Nothing enqueues `sync_outbox` rows for these: sketches are local-only, and
 * queueing mutations no server accepts would trip the sync attention state.
 */
const CREATE_SKETCHES = `
  CREATE TABLE sketches (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES learner_profiles(id) ON DELETE CASCADE
  );

  CREATE INDEX idx_sketches_profile_updated_at
    ON sketches(profile_id, updated_at DESC);
`;
```

Then extend the array:

```ts
const migrations: readonly DatabaseMigration[] = [
  {
    version: 1,
    async migrate(driver) {
      await driver.exec(CREATE_INITIAL_SCHEMA);
    },
  },
  {
    version: 2,
    async migrate(driver) {
      await driver.exec(CREATE_SKETCHES);
    },
  },
];
```

- [ ] **Step 4: Write the migration test**

Append to `src/data/database/__tests__/migrations.test.ts` (create the file with these imports if it does not exist):

```ts
import { LATEST_SCHEMA_VERSION, migrateDatabase } from "../migrations";
import { NodeSqliteDriver } from "../testing/node-sqlite-driver";

describe("migration 2", () => {
  it("adds the sketches table and reports the new version", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    await migrateDatabase(driver);

    const table = await driver.first<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sketches'",
    );
    const version = await driver.first<{ user_version: number }>("PRAGMA user_version");

    expect(table?.name).toBe("sketches");
    expect(version?.user_version).toBe(LATEST_SCHEMA_VERSION);
    expect(LATEST_SCHEMA_VERSION).toBe(2);

    await driver.close();
  });

  it("applies to a database already migrated to version 1", async () => {
    const driver = new NodeSqliteDriver(":memory:");
    await driver.exec("PRAGMA foreign_keys = ON");
    await migrateDatabase(driver);
    // A second run must be a no-op rather than an error.
    await migrateDatabase(driver);

    const version = await driver.first<{ user_version: number }>("PRAGMA user_version");

    expect(version?.user_version).toBe(2);

    await driver.close();
  });
});
```

- [ ] **Step 5: Write the repository interface**

Create `src/data/sketches/sketch-repository.ts`:

```ts
export type Sketch = {
  id: string;
  title: string;
  source: string;
  /** ISO-8601. */
  createdAt: string;
  /** ISO-8601. Advanced by every source or title change; drives list ordering. */
  updatedAt: string;
};

/**
 * Learner-authored shaders. Every method takes `profileId` explicitly rather than holding an active
 * profile, matching `ProgressRepository` — the caller already knows which profile is active, and a
 * repository that remembers it can serve the wrong one after an account switch.
 */
export interface SketchRepository {
  /** Most recently updated first. */
  list(profileId: string): Promise<Sketch[]>;
  /** `null` when the sketch does not exist or belongs to another profile. */
  get(profileId: string, id: string): Promise<Sketch | null>;
  create(profileId: string, title: string, source: string): Promise<Sketch>;
  updateSource(profileId: string, id: string, source: string): Promise<void>;
  rename(profileId: string, id: string, title: string): Promise<void>;
  delete(profileId: string, id: string): Promise<void>;
}
```

- [ ] **Step 6: Write the starter sketch**

Create `src/data/sketches/starter-sketch.ts`:

```ts
export const STARTER_SKETCH_TITLE = "First shader";

/**
 * The body a first-run sketch opens with — and the first complete, runnable shader anywhere in the
 * product. Every line is one the curriculum already teaches: normalize, center, aspect-correct,
 * measure a distance, threshold it with `smoothstep`, animate through `iTime`.
 */
export const STARTER_SKETCH_SOURCE = `vec2 uv = fragCoord / iResolution.xy;
vec2 p = uv * 2.0 - 1.0;
p.x *= iResolution.x / iResolution.y;

float radius = 0.4 + sin(iTime) * 0.08;
float d = length(p) - radius;
float shape = 1.0 - smoothstep(0.0, 0.01, d);

vec3 background = vec3(0.04, 0.04, 0.06);
vec3 fill = vec3(0.78, 0.96, 0.39);
fragColor = vec4(mix(background, fill, shape), 1.0);`;
```

- [ ] **Step 7: Implement the repository**

Create `src/data/sketches/sqlite-sketch-repository.ts`:

```ts
import * as Crypto from "expo-crypto";

import type { DatabaseDriver } from "../database/driver";
import type { Sketch, SketchRepository } from "./sketch-repository";

const COLUMNS = "id, title, source, created_at, updated_at";

type SketchRow = {
  id: string;
  title: string;
  source: string;
  created_at: string;
  updated_at: string;
};

function toSketch(row: SketchRow): Sketch {
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type SqliteSketchRepositoryOptions = {
  /** Overridable for deterministic tests; defaults to `Crypto.randomUUID()`. */
  generateId?: () => string;
  /** Overridable for deterministic tests; defaults to the current time. */
  now?: () => string;
};

export class SqliteSketchRepository implements SketchRepository {
  private readonly driver: DatabaseDriver;
  private readonly generateId: () => string;
  private readonly now: () => string;

  constructor(driver: DatabaseDriver, options: SqliteSketchRepositoryOptions = {}) {
    this.driver = driver;
    this.generateId = options.generateId ?? (() => Crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async list(profileId: string): Promise<Sketch[]> {
    const rows = await this.driver.all<SketchRow>(
      `SELECT ${COLUMNS} FROM sketches WHERE profile_id = ? ORDER BY updated_at DESC, id ASC`,
      [profileId],
    );
    return rows.map(toSketch);
  }

  async get(profileId: string, id: string): Promise<Sketch | null> {
    const row = await this.driver.first<SketchRow>(
      `SELECT ${COLUMNS} FROM sketches WHERE profile_id = ? AND id = ?`,
      [profileId, id],
    );
    return row ? toSketch(row) : null;
  }

  async create(profileId: string, title: string, source: string): Promise<Sketch> {
    const sketch: Sketch = {
      id: this.generateId(),
      title,
      source,
      createdAt: this.now(),
      updatedAt: this.now(),
    };

    await this.driver.run(
      `INSERT INTO sketches (id, profile_id, title, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [sketch.id, profileId, sketch.title, sketch.source, sketch.createdAt, sketch.updatedAt],
    );

    return sketch;
  }

  async updateSource(profileId: string, id: string, source: string): Promise<void> {
    // `profile_id` is in the predicate, not just the lookup: a stale screen must not be able to
    // write into another profile's row after an account switch.
    await this.driver.run(
      "UPDATE sketches SET source = ?, updated_at = ? WHERE profile_id = ? AND id = ?",
      [source, this.now(), profileId, id],
    );
  }

  async rename(profileId: string, id: string, title: string): Promise<void> {
    await this.driver.run(
      "UPDATE sketches SET title = ?, updated_at = ? WHERE profile_id = ? AND id = ?",
      [title, this.now(), profileId, id],
    );
  }

  async delete(profileId: string, id: string): Promise<void> {
    await this.driver.run("DELETE FROM sketches WHERE profile_id = ? AND id = ?", [profileId, id]);
  }
}
```

- [ ] **Step 8: Run the tests and verify they pass**

Run: `npx jest src/data/sketches src/data/database/__tests__/migrations.test.ts`

Expected: PASS. If the `updatedAt`-preserved-`createdAt` test fails because both timestamps are equal, confirm the test clock increments on every `now()` call.

- [ ] **Step 9: Typecheck, run the whole suite, and commit**

```bash
npx tsc --noEmit
npm test
git add src/data/sketches src/data/database/migrations.ts src/data/database/__tests__/migrations.test.ts
git commit -m "feat(data): persist learner shader sketches per profile"
```

---

### Task 7: The Editor screen and its route

The first task with a user-visible deliverable. Includes wiring the repository into `DataProvider` and making the tab navigate, because a route nobody can reach is not a deliverable.

**Files:**
- Create: `src/app/editor.tsx`
- Modify: `src/context/data-context.tsx` — add `sketchRepository` to the ready state
- Modify: `src/components/bottom-navigation.tsx:49-67` — route to `/editor`, delete the `Alert`
- Test: `src/app/__tests__/editor.test.tsx`
- Test: `src/components/__tests__/bottom-navigation.test.tsx`

**Interfaces:**
- Consumes: `ShaderSandbox` (Task 4), `GlslInput` (Task 5), `SketchRepository`/`Sketch` (Task 6), `STARTER_SKETCH_SOURCE`/`STARTER_SKETCH_TITLE` (Task 6), `useAuth().profileId` from `../context/auth-context`, `useData()` from `../context/data-context`.
- Produces: `default function EditorScreen()`; `DataState` ready variant gains `sketchRepository: SketchRepository`.

- [ ] **Step 1: Add the repository to DataProvider**

In `src/context/data-context.tsx`, add the import:

```ts
import type { SketchRepository } from "../data/sketches/sketch-repository";
import { SqliteSketchRepository } from "../data/sketches/sqlite-sketch-repository";
```

Add to the `"ready"` variant of `DataState`, after `progressRepository`:

```ts
      /** Learner-authored shader sketches. Local-only; nothing syncs them. */
      sketchRepository: SketchRepository;
```

Next to where `progressRepository` is constructed (around line 107):

```ts
      const sketchRepository = new SqliteSketchRepository(driver);
```

And add `sketchRepository,` to the object passed to the provider value (around line 125).

- [ ] **Step 2: Write the failing navigation test**

Create `src/components/__tests__/bottom-navigation.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { BottomNavigation } from "../bottom-navigation";

const replace = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace, push: jest.fn() }),
}));

describe("BottomNavigation", () => {
  beforeEach(() => {
    replace.mockClear();
  });

  it("navigates to the editor route", () => {
    render(<BottomNavigation activeItem="home" />);

    fireEvent.press(screen.getByText("Editor"));

    expect(replace).toHaveBeenCalledWith("/editor");
  });

  it("does not navigate when the active tab is pressed", () => {
    render(<BottomNavigation activeItem="editor" />);

    fireEvent.press(screen.getByText("Editor"));

    expect(replace).not.toHaveBeenCalled();
  });

  it("navigates between home and course", () => {
    render(<BottomNavigation activeItem="editor" />);

    fireEvent.press(screen.getByText("Course"));

    expect(replace).toHaveBeenCalledWith("/course");
  });
});
```

- [ ] **Step 3: Run the navigation test and verify it fails**

Run: `npx jest src/components/__tests__/bottom-navigation.test.tsx`

Expected: FAIL — the editor case calls `Alert.alert` and `replace` is never invoked.

- [ ] **Step 4: Make the tab navigate**

In `src/components/bottom-navigation.tsx`, replace the `navigate` function body's `Alert.alert(...)` block with a route, and remove `Alert` from the `react-native` import:

```ts
  const navigate = (destination: BottomTab) => {
    if (destination === activeItem) return;

    if (destination === "home") {
      router.replace("/");
      return;
    }

    if (destination === "course") {
      router.replace("/course");
      return;
    }

    router.replace("/editor");
  };
```

- [ ] **Step 5: Run the navigation test and verify it passes**

Run: `npx jest src/components/__tests__/bottom-navigation.test.tsx`

Expected: PASS, 3 tests.

- [ ] **Step 6: Write the failing editor screen test**

Create `src/app/__tests__/editor.test.tsx`:

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import EditorScreen from "../editor";
import type { Sketch, SketchRepository } from "../../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE } from "../../data/sketches/starter-sketch";

// The sandbox compiles GLSL through an `expo-gl` context, which no Jest environment provides.
// Stand in a view reporting the source it was handed, so the screen's contract stays observable.
jest.mock("../../components/shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text, View } = require("react-native") as typeof import("react-native");

  return {
    ShaderSandbox: ({ source }: { source: string }) =>
      React.createElement(View, { testID: "sandbox" }, React.createElement(Text, null, source)),
  };
});

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

let sketches: Sketch[] = [];
const repository: jest.Mocked<SketchRepository> = {
  list: jest.fn(async () => sketches),
  get: jest.fn(async (_profileId, id) => sketches.find((sketch) => sketch.id === id) ?? null),
  create: jest.fn(async (_profileId, title, source) => {
    const sketch: Sketch = {
      id: `sketch-${sketches.length + 1}`,
      title,
      source,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    sketches = [sketch, ...sketches];
    return sketch;
  }),
  updateSource: jest.fn(async () => undefined),
  rename: jest.fn(async () => undefined),
  delete: jest.fn(async () => undefined),
};

jest.mock("../../context/data-context", () => ({
  useData: () => ({ status: "ready", sketchRepository: repository, retry: jest.fn() }),
}));

jest.mock("../../context/auth-context", () => ({
  useAuth: () => ({ profileId: "profile-a" }),
}));

describe("EditorScreen", () => {
  beforeEach(() => {
    sketches = [];
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("creates and opens a starter sketch on first run", async () => {
    render(<EditorScreen />);

    await waitFor(() => {
      expect(repository.create).toHaveBeenCalledWith(
        "profile-a",
        expect.any(String),
        STARTER_SKETCH_SOURCE,
      );
    });
    expect(screen.getByTestId("sandbox")).toHaveTextContent("smoothstep");
  });

  it("opens the most recently updated existing sketch", async () => {
    sketches = [
      {
        id: "sketch-9",
        title: "Recent",
        source: "fragColor = vec4(0.5);",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:10:00.000Z",
      },
    ];

    render(<EditorScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("sandbox")).toHaveTextContent("fragColor = vec4(0.5);");
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("autosaves an edit after the debounce elapses", async () => {
    render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());

    fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.25);");
    expect(repository.updateSource).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(repository.updateSource).toHaveBeenCalledWith(
      "profile-a",
      "sketch-1",
      "fragColor = vec4(0.25);",
    );
  });

  it("does not autosave before the debounce elapses", async () => {
    render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());

    fireEvent.changeText(screen.getByTestId("glsl-input"), "a");
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(repository.updateSource).not.toHaveBeenCalled();
  });

  it("surfaces a save failure without discarding the buffer", async () => {
    repository.updateSource.mockRejectedValueOnce(new Error("disk full"));
    render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());

    fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.75);");
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("Could not save. Your code is still here.")).toBeTruthy();
    expect(screen.getByTestId("glsl-input").props.defaultValue).toBeTruthy();
  });
});
```

- [ ] **Step 7: Run the editor test and verify it fails**

Run: `npx jest src/app/__tests__/editor.test.tsx`

Expected: FAIL — `Cannot find module '../editor'`.

- [ ] **Step 8: Implement the editor screen**

Create `src/app/editor.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { GlslInput } from "../components/glsl-input";
import { ShaderSandbox } from "../components/shader-sandbox";
import { Colors, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useData } from "../context/data-context";
import type { Sketch } from "../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE, STARTER_SKETCH_TITLE } from "../data/sketches/starter-sketch";
import type { CompileError } from "../shaders/shader-source";
import type { HostCompileResult } from "../shaders/shader-program-host";

/** How long after the last keystroke the shader recompiles. */
const COMPILE_DEBOUNCE_MS = 300;
/** How long after the last keystroke the sketch is written to SQLite. */
const AUTOSAVE_DEBOUNCE_MS = 800;

export default function EditorScreen() {
  const data = useData();
  const { profileId } = useAuth();
  const sketchRepository = data.status === "ready" ? data.sketchRepository : null;

  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [compiledSource, setCompiledSource] = useState("");
  const [errors, setErrors] = useState<CompileError[]>([]);
  const [showingLastWorking, setShowingLastWorking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const compileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSourceRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sketchRepository || !profileId) return;

    let cancelled = false;

    void (async () => {
      const existing = await sketchRepository.list(profileId);
      const opened =
        existing[0] ??
        (await sketchRepository.create(profileId, STARTER_SKETCH_TITLE, STARTER_SKETCH_SOURCE));

      if (cancelled) return;
      setSketch(opened);
      setCompiledSource(opened.source);
    })();

    return () => {
      cancelled = true;
    };
  }, [profileId, sketchRepository]);

  const flushSave = useCallback(async () => {
    const pending = pendingSourceRef.current;
    if (!pending || !sketchRepository || !profileId || !sketch) return;

    pendingSourceRef.current = null;

    try {
      await sketchRepository.updateSource(profileId, sketch.id, pending);
      setSaveError(null);
    } catch {
      // The buffer is untouched — the learner keeps typing and the next autosave retries.
      setSaveError("Could not save. Your code is still here.");
    }
  }, [profileId, sketch, sketchRepository]);

  // Persist whatever is pending when the screen goes away, rather than losing the last edit.
  useEffect(
    () => () => {
      if (compileTimer.current) clearTimeout(compileTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void flushSave();
    },
    [flushSave],
  );

  const handleChange = useCallback(
    (next: string) => {
      pendingSourceRef.current = next;

      if (compileTimer.current) clearTimeout(compileTimer.current);
      compileTimer.current = setTimeout(() => setCompiledSource(next), COMPILE_DEBOUNCE_MS);

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushSave(), AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const handleCompileResult = useCallback((result: HostCompileResult) => {
    if (result.ok) {
      setErrors([]);
      setShowingLastWorking(false);
      return;
    }

    setErrors(result.errors);
    setShowingLastWorking(result.showingLastWorking);
  }, []);

  if (!sketch) {
    return (
      <SafeAreaView edges={["top"]} style={styles.screen}>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Opening editor…</Text>
        </View>
        <BottomNavigation activeItem="editor" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Editor</Text>
        <Text numberOfLines={1} style={styles.title}>
          {sketch.title}
        </Text>
      </View>

      <ShaderSandbox
        height={200}
        onCompileResult={handleCompileResult}
        source={compiledSource}
      />

      {showingLastWorking && (
        <Text style={styles.staleBadge}>Showing the last version that compiled</Text>
      )}
      {saveError && <Text style={styles.saveError}>{saveError}</Text>}

      <GlslInput errors={errors} initialValue={sketch.source} onChange={handleChange} />

      <BottomNavigation activeItem="editor" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  eyebrow: {
    color: Colors.textSubtle,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "600",
  },
  staleBadge: {
    backgroundColor: Colors.surfaceRaised,
    color: Colors.textMuted,
    fontSize: 11,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xs,
  },
  saveError: {
    color: Colors.coral,
    fontSize: 12,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xs,
  },
  loading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
});
```

- [ ] **Step 9: Run the editor test and verify it passes**

Run: `npx jest src/app/__tests__/editor.test.tsx`

Expected: PASS, 5 tests. If the autosave tests fail because `flushSave` closes over a `null` sketch, confirm the load effect resolved before `changeText` — the `waitFor` on `glsl-input` guarantees it.

- [ ] **Step 10: Run everything, typecheck, and commit**

```bash
npm test
npx tsc --noEmit
git add src/app/editor.tsx src/app/__tests__/editor.test.tsx src/components/bottom-navigation.tsx src/components/__tests__/bottom-navigation.test.tsx src/context/data-context.tsx
git commit -m "feat(editor): ship the shader editor tab"
```

---

### Task 8: Preview controls — pause, restart, collapse

The spec's failure handling leans on a pause control ("a heavy shader can still tank framerate; the pause control covers it") and its layout decision on a collapse control. `ShaderSandbox` already accepts `paused` and `restartToken`; nothing drives them yet.

**Files:**
- Create: `src/components/preview-controls.tsx`
- Modify: `src/app/editor.tsx` — hold the state and render the bar
- Test: `src/components/__tests__/preview-controls.test.tsx`

**Interfaces:**
- Consumes: nothing beyond the theme.
- Produces:
  - `type PreviewControlsProps = { paused: boolean; collapsed: boolean; onTogglePause: () => void; onRestart: () => void; onToggleCollapse: () => void }`
  - `function PreviewControls(props: PreviewControlsProps): JSX.Element`

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/preview-controls.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { PreviewControls } from "../preview-controls";

const props = (overrides: Partial<Parameters<typeof PreviewControls>[0]> = {}) => ({
  paused: false,
  collapsed: false,
  onTogglePause: jest.fn(),
  onRestart: jest.fn(),
  onToggleCollapse: jest.fn(),
  ...overrides,
});

describe("PreviewControls", () => {
  it("offers to pause while running", () => {
    render(<PreviewControls {...props()} />);

    expect(screen.getByLabelText("Pause preview")).toBeTruthy();
  });

  it("offers to resume while paused", () => {
    render(<PreviewControls {...props({ paused: true })} />);

    expect(screen.getByLabelText("Resume preview")).toBeTruthy();
  });

  it("reports a pause toggle", () => {
    const current = props();
    render(<PreviewControls {...current} />);

    fireEvent.press(screen.getByLabelText("Pause preview"));

    expect(current.onTogglePause).toHaveBeenCalled();
  });

  it("reports a restart", () => {
    const current = props();
    render(<PreviewControls {...current} />);

    fireEvent.press(screen.getByLabelText("Restart preview"));

    expect(current.onRestart).toHaveBeenCalled();
  });

  it("reports a collapse toggle and labels it by current state", () => {
    const current = props({ collapsed: true });
    render(<PreviewControls {...current} />);

    fireEvent.press(screen.getByLabelText("Show preview"));

    expect(current.onToggleCollapse).toHaveBeenCalled();
  });

  it("labels the collapse control as hiding while the preview is showing", () => {
    render(<PreviewControls {...props()} />);

    expect(screen.getByLabelText("Hide preview")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/components/__tests__/preview-controls.test.tsx`

Expected: FAIL — `Cannot find module '../preview-controls'`.

- [ ] **Step 3: Implement the control bar**

Create `src/components/preview-controls.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";

type PreviewControlsProps = {
  paused: boolean;
  collapsed: boolean;
  onTogglePause: () => void;
  onRestart: () => void;
  onToggleCollapse: () => void;
};

export function PreviewControls({
  paused,
  collapsed,
  onTogglePause,
  onRestart,
  onToggleCollapse,
}: PreviewControlsProps) {
  return (
    <View style={styles.bar}>
      <Control
        label={paused ? "Resume preview" : "Pause preview"}
        onPress={onTogglePause}
        text={paused ? "Resume" : "Pause"}
      />
      <Control label="Restart preview" onPress={onRestart} text="Restart" />
      <View style={styles.spacer} />
      <Control
        label={collapsed ? "Show preview" : "Hide preview"}
        onPress={onToggleCollapse}
        text={collapsed ? "Show" : "Hide"}
      />
    </View>
  );
}

function Control({
  label,
  onPress,
  text,
}: {
  label: string;
  onPress: () => void;
  text: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
    >
      <Text style={styles.controlText}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderBottomColor: Colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  spacer: {
    flex: 1,
  },
  control: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  controlPressed: {
    backgroundColor: Colors.surfaceRaised,
  },
  controlText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest src/components/__tests__/preview-controls.test.tsx`

Expected: PASS, 6 tests.

- [ ] **Step 5: Wire the controls into the editor**

In `src/app/editor.tsx`, import the bar and add three pieces of state:

```tsx
import { PreviewControls } from "../components/preview-controls";
```

```tsx
  const [paused, setPaused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [restartToken, setRestartToken] = useState(0);
```

Replace the `<ShaderSandbox … />` element with the bar plus a conditional sandbox. Collapsing
unmounts the sandbox, which releases the GL context — the point of the control is to reclaim both
screen space and the frame loop:

```tsx
      <PreviewControls
        collapsed={collapsed}
        onRestart={() => setRestartToken((token) => token + 1)}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onTogglePause={() => setPaused((value) => !value)}
        paused={paused}
      />

      {!collapsed && (
        <ShaderSandbox
          height={200}
          onCompileResult={handleCompileResult}
          paused={paused}
          restartToken={restartToken}
          source={compiledSource}
        />
      )}
```

- [ ] **Step 6: Add an editor test for collapsing**

Append to `src/app/__tests__/editor.test.tsx`:

```tsx
  it("unmounts the preview when collapsed and restores it on demand", async () => {
    render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("sandbox")).toBeTruthy());

    fireEvent.press(screen.getByLabelText("Hide preview"));
    expect(screen.queryByTestId("sandbox")).toBeNull();

    fireEvent.press(screen.getByLabelText("Show preview"));
    expect(screen.getByTestId("sandbox")).toBeTruthy();
  });
```

- [ ] **Step 7: Run everything, typecheck, and commit**

```bash
npm test
npx tsc --noEmit
git add src/components/preview-controls.tsx src/components/__tests__/preview-controls.test.tsx src/app/editor.tsx src/app/__tests__/editor.test.tsx
git commit -m "feat(editor): pause, restart and collapse the live preview"
```

---

### Task 9: Switching, renaming and deleting sketches

**Files:**
- Create: `src/components/sketch-list-sheet.tsx`
- Modify: `src/app/editor.tsx` — a header control that opens the sheet
- Test: `src/components/__tests__/sketch-list-sheet.test.tsx`

**Interfaces:**
- Consumes: `Sketch` from `../data/sketches/sketch-repository`.
- Produces:
  - `type SketchListSheetProps = { sketches: Sketch[]; activeSketchId: string; onSelect: (id: string) => void; onCreate: () => void; onRename: (id: string, title: string) => void; onDelete: (id: string) => void; onClose: () => void }`
  - `function SketchListSheet(props: SketchListSheetProps): JSX.Element`

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/sketch-list-sheet.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react-native";

import { SketchListSheet } from "../sketch-list-sheet";
import type { Sketch } from "../../data/sketches/sketch-repository";

const sketch = (id: string, title: string): Sketch => ({
  id,
  title,
  source: "fragColor = vec4(1.0);",
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
});

const props = () => ({
  sketches: [sketch("a", "Alpha"), sketch("b", "Beta")],
  activeSketchId: "a",
  onSelect: jest.fn(),
  onCreate: jest.fn(),
  onRename: jest.fn(),
  onDelete: jest.fn(),
  onClose: jest.fn(),
});

describe("SketchListSheet", () => {
  it("lists every sketch", () => {
    render(<SketchListSheet {...props()} />);

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("marks the active sketch", () => {
    render(<SketchListSheet {...props()} />);

    expect(screen.getByTestId("sketch-row-a").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });

  it("selects another sketch", () => {
    const current = props();
    render(<SketchListSheet {...current} />);

    fireEvent.press(screen.getByText("Beta"));

    expect(current.onSelect).toHaveBeenCalledWith("b");
  });

  it("creates a new sketch", () => {
    const current = props();
    render(<SketchListSheet {...current} />);

    fireEvent.press(screen.getByText("New sketch"));

    expect(current.onCreate).toHaveBeenCalled();
  });

  it("renames a sketch through its inline field", () => {
    const current = props();
    render(<SketchListSheet {...current} />);

    fireEvent.press(screen.getByTestId("sketch-rename-a"));
    fireEvent.changeText(screen.getByTestId("sketch-title-input"), "Renamed");
    fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(current.onRename).toHaveBeenCalledWith("a", "Renamed");
  });

  it("ignores a rename to an empty title", () => {
    const current = props();
    render(<SketchListSheet {...current} />);

    fireEvent.press(screen.getByTestId("sketch-rename-a"));
    fireEvent.changeText(screen.getByTestId("sketch-title-input"), "   ");
    fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(current.onRename).not.toHaveBeenCalled();
  });

  it("deletes a sketch", () => {
    const current = props();
    render(<SketchListSheet {...current} />);

    fireEvent.press(screen.getByTestId("sketch-delete-b"));

    expect(current.onDelete).toHaveBeenCalledWith("b");
  });

  it("refuses to delete the last remaining sketch", () => {
    const current = { ...props(), sketches: [sketch("a", "Alpha")] };
    render(<SketchListSheet {...current} />);

    fireEvent.press(screen.getByTestId("sketch-delete-a"));

    expect(current.onDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/components/__tests__/sketch-list-sheet.test.tsx`

Expected: FAIL — `Cannot find module '../sketch-list-sheet'`.

- [ ] **Step 3: Implement the sheet**

Create `src/components/sketch-list-sheet.tsx`:

```tsx
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AppIcon } from "./app-icon";
import { Colors, Radius, Spacing } from "../constants/theme";
import type { Sketch } from "../data/sketches/sketch-repository";

type SketchListSheetProps = {
  sketches: Sketch[];
  activeSketchId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export function SketchListSheet({
  sketches,
  activeSketchId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: SketchListSheetProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const submitRename = (id: string) => {
    const trimmed = draftTitle.trim();
    setRenamingId(null);
    // An empty title would leave a row with nothing to tap, so a blank submission is a cancel.
    if (trimmed.length > 0) onRename(id, trimmed);
  };

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.heading}>Sketches</Text>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose}>
          <AppIcon
            color={Colors.textMuted}
            fallback="×"
            name={{ android: "close", ios: "xmark", web: "close" }}
            size={20}
          />
        </Pressable>
      </View>

      <ScrollView style={styles.list}>
        {sketches.map((sketch) => (
          <View key={sketch.id} style={styles.row}>
            {renamingId === sketch.id ? (
              <TextInput
                autoFocus
                onChangeText={setDraftTitle}
                onSubmitEditing={() => submitRename(sketch.id)}
                style={styles.titleInput}
                testID="sketch-title-input"
                value={draftTitle}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: sketch.id === activeSketchId }}
                onPress={() => onSelect(sketch.id)}
                style={styles.rowTitle}
                testID={`sketch-row-${sketch.id}`}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.title, sketch.id === activeSketchId && styles.titleActive]}
                >
                  {sketch.title}
                </Text>
              </Pressable>
            )}

            <Pressable
              accessibilityLabel={`Rename ${sketch.title}`}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => {
                setRenamingId(sketch.id);
                setDraftTitle(sketch.title);
              }}
              testID={`sketch-rename-${sketch.id}`}
            >
              <Text style={styles.action}>Rename</Text>
            </Pressable>

            <Pressable
              accessibilityLabel={`Delete ${sketch.title}`}
              accessibilityRole="button"
              // Deleting the only sketch would leave the editor with nothing to open, and the screen
              // would immediately recreate a starter — confusing rather than helpful.
              disabled={sketches.length <= 1}
              hitSlop={8}
              onPress={() => onDelete(sketch.id)}
              testID={`sketch-delete-${sketch.id}`}
            >
              <Text style={[styles.action, sketches.length <= 1 && styles.actionDisabled]}>
                Delete
              </Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        onPress={onCreate}
        style={({ pressed }) => [styles.createButton, pressed && styles.createButtonPressed]}
      >
        <Text style={styles.createButtonText}>New sketch</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: "70%",
    paddingBottom: Spacing.lg,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  heading: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  list: {
    flexGrow: 0,
  },
  row: {
    alignItems: "center",
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  rowTitle: {
    flex: 1,
  },
  title: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  titleActive: {
    color: Colors.accent,
    fontWeight: "600",
  },
  titleInput: {
    borderBottomColor: Colors.accent,
    borderBottomWidth: 1,
    color: Colors.text,
    flex: 1,
    fontSize: 14,
    paddingVertical: Spacing.xs,
  },
  action: {
    color: Colors.textSubtle,
    fontSize: 12,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  createButton: {
    alignItems: "center",
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  createButtonPressed: {
    opacity: 0.85,
  },
  createButtonText: {
    color: Colors.background,
    fontSize: 14,
    fontWeight: "700",
  },
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest src/components/__tests__/sketch-list-sheet.test.tsx`

Expected: PASS, 8 tests.

- [ ] **Step 5: Wire the sheet into the editor**

In `src/app/editor.tsx`, add `Modal` to the `react-native` import and import the sheet:

```tsx
import { SketchListSheet } from "../components/sketch-list-sheet";
```

Add two pieces of state beside the existing ones:

```tsx
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [isListOpen, setIsListOpen] = useState(false);
```

Then change the load effect's body so the fetched list is kept, not discarded — replace the
`void (async () => { … })()` block from Task 7 with:

```tsx
    void (async () => {
      const existing = await sketchRepository.list(profileId);
      const opened =
        existing[0] ??
        (await sketchRepository.create(profileId, STARTER_SKETCH_TITLE, STARTER_SKETCH_SOURCE));

      if (cancelled) return;
      // Re-read rather than reusing `existing`: a first run just inserted a row that list missed.
      setSketches(existing.length > 0 ? existing : await sketchRepository.list(profileId));
      setSketch(opened);
      setCompiledSource(opened.source);
    })();
```

Add a header control:

```tsx
        <Pressable
          accessibilityLabel="Sketches"
          accessibilityRole="button"
          onPress={() => setIsListOpen(true)}
          testID="open-sketch-list"
        >
          <Text style={styles.eyebrow}>Sketches</Text>
        </Pressable>
```

Render the sheet in a `Modal`, and on every mutation flush the pending save first, then re-read the
list so ordering stays correct:

```tsx
      <Modal animationType="slide" onRequestClose={() => setIsListOpen(false)} transparent visible={isListOpen}>
        <View style={styles.modalBackdrop}>
          <SketchListSheet
            activeSketchId={sketch.id}
            onClose={() => setIsListOpen(false)}
            onCreate={async () => {
              await flushSave();
              if (!sketchRepository || !profileId) return;
              const created = await sketchRepository.create(
                profileId,
                STARTER_SKETCH_TITLE,
                STARTER_SKETCH_SOURCE,
              );
              setSketches(await sketchRepository.list(profileId));
              setSketch(created);
              setCompiledSource(created.source);
              setIsListOpen(false);
            }}
            onDelete={async (id) => {
              if (!sketchRepository || !profileId) return;
              await sketchRepository.delete(profileId, id);
              const remaining = await sketchRepository.list(profileId);
              setSketches(remaining);
              if (id === sketch.id && remaining[0]) {
                setSketch(remaining[0]);
                setCompiledSource(remaining[0].source);
              }
            }}
            onRename={async (id, title) => {
              if (!sketchRepository || !profileId) return;
              await sketchRepository.rename(profileId, id, title);
              setSketches(await sketchRepository.list(profileId));
              if (id === sketch.id) setSketch({ ...sketch, title });
            }}
            onSelect={async (id) => {
              await flushSave();
              if (!sketchRepository || !profileId) return;
              const next = await sketchRepository.get(profileId, id);
              if (!next) return;
              setSketch(next);
              setCompiledSource(next.source);
              setIsListOpen(false);
            }}
            sketches={sketches}
          />
        </View>
      </Modal>
```

Add to the stylesheet:

```tsx
  modalBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    flex: 1,
    justifyContent: "flex-end",
  },
```

**Important:** `GlslInput` is uncontrolled, so switching sketches must remount it or the previous
buffer stays on screen. Give it `key={sketch.id}`:

```tsx
      <GlslInput
        errors={errors}
        initialValue={sketch.source}
        key={sketch.id}
        onChange={handleChange}
      />
```

- [ ] **Step 6: Add an editor test for switching**

Append to `src/app/__tests__/editor.test.tsx`:

```tsx
  it("switches to another sketch and shows its source", async () => {
    sketches = [
      {
        id: "sketch-1",
        title: "One",
        source: "fragColor = vec4(0.1);",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:02:00.000Z",
      },
      {
        id: "sketch-2",
        title: "Two",
        source: "fragColor = vec4(0.2);",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:01:00.000Z",
      },
    ];

    render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("open-sketch-list")).toBeTruthy());

    fireEvent.press(screen.getByTestId("open-sketch-list"));
    await act(async () => {
      fireEvent.press(screen.getByText("Two"));
    });

    expect(screen.getByTestId("glsl-input").props.defaultValue).toBe("fragColor = vec4(0.2);");
  });
```

- [ ] **Step 7: Run everything, typecheck, and commit**

```bash
npm test
npx tsc --noEmit
git add src/components/sketch-list-sheet.tsx src/components/__tests__/sketch-list-sheet.test.tsx src/app/editor.tsx src/app/__tests__/editor.test.tsx
git commit -m "feat(editor): switch, rename and delete sketches"
```

---

### Task 10: Document the sandbox contract

**Files:**
- Create: `docs/data/shader-sandbox.md`
- Modify: `README.md` — add the Editor to the feature list and link the new doc

**Interfaces:**
- Consumes: everything above. Produces no code.

- [ ] **Step 1: Write the document**

Create `docs/data/shader-sandbox.md` covering, in this order:

1. **What a learner authors** — a `mainImage` body, not a whole program. Show the exact prologue and epilogue from `shader-source.ts` and state that `lineOffset` is 4.
2. **The uniform contract** — `iResolution` (vec3: width, height, pixel aspect) and `iTime` (float seconds). State plainly that `iMouse`, `iFrame` and `iTimeDelta` do not exist yet.
3. **Why GLSL ES 1.00** — quote the SDK 57 warning that some older Android devices lack WebGL2, and explain that `out`/`in` function parameters are valid 1.00 while stage-level `in`/`out` are not. Note that this is also what makes source paste into Shadertoy.
4. **Shadertoy differences** — Shadertoy declares `iResolution` the same way, so most beginner bodies port unchanged; `texture()`, `textureLod`, and multi-pass buffers do not exist here.
5. **How errors are reported** — best-effort parsing of `sourceIndex:line` diagnostics, always accompanied by the raw log, with line numbers offset back into the learner's buffer.
6. **Remote debugging breaks `expo-gl`** — documented for SDK 57. A contributor debugging a blank preview must check this first.
7. **Where the pieces live** — the table below.

| Concern | File |
| --- | --- |
| Wrapper and log parsing | `src/shaders/shader-source.ts` |
| Compile, swap, retain, delete | `src/shaders/shader-program-host.ts` |
| `GLView` and the frame loop | `src/components/shader-sandbox.tsx` |
| Editing surface | `src/components/glsl-input.tsx` |
| Pause, restart, collapse | `src/components/preview-controls.tsx` |
| Persistence | `src/data/sketches/` |

Close with a "Further reading" section linking `docs/data/local-curriculum.md` and noting that
sub-project 2 will move lesson previews onto this engine, at which point `preview-registry.ts` and the
`u_mode` chain in `live-shader-preview.tsx` are retired.

- [ ] **Step 2: Update the README**

In the feature list around `README.md:11-17`, add:

```markdown
- Shader editor: write GLSL, see it compile and render live, and keep sketches per profile
```

And in the technology or documentation list, link `docs/data/shader-sandbox.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/data/shader-sandbox.md README.md
git commit -m "docs(data): document the shader sandbox contract"
```

---

## Android Acceptance Checks

These cannot be automated and are owed to a human on a device, in this order. Check 1 first — it is
cheap and validates the riskiest assumption in the plan.

- [ ] **1. Capture a real info log.** Type `float x = y;` in the editor. Record the verbatim error text and confirm `PREFIXED_DIAGNOSTIC` or `BARE_DIAGNOSTIC` matches it and the reported line is the line you typed on. If neither matches, fix the patterns in `shader-source.ts` — the raw log will already be visible, so nothing is broken meanwhile.
- [ ] **2. Typing quality.** Type continuously in a 40–60 line shader. Confirm no caret jumps, no autocapitalization, no smart quotes, and acceptable latency.
- [ ] **3. Symbol row.** Confirm each symbol inserts at the caret, not at the end, and that the caret lands after the inserted text.
- [ ] **4. Last-good retention.** Delete a semicolon mid-shader. Confirm the preview keeps rendering and the stale badge appears.
- [ ] **5. Framerate.** Confirm the animation stays smooth with the keyboard raised and the preview pinned.
- [ ] **6. Autosave durability.** Edit, background the app without waiting, force-stop it, relaunch. Confirm the edit survived.
- [ ] **7. Sketch management.** Create, rename, switch and delete. Confirm ordering is most-recent-first and that deleting the open sketch opens another rather than leaving a blank editor.
- [ ] **8. Preview controls.** Confirm pause freezes `iTime` without blanking the preview, restart returns the animation to zero, and collapse reclaims the screen and stops the frame loop.
- [ ] **9. Old-device check.** Run on the oldest Android device available and confirm the shader compiles — this is the WebGL2 assumption the GLSL ES 1.00 choice exists to protect.

## Out Of Scope

Confirmed excluded; do not let these creep in:

- Any change to `content/*.json`, `src/data/course/schema.ts`, `src/shaders/preview-registry.ts`, or `src/components/live-shader-preview.tsx`.
- The Tutorials tab and tutorial content type (sub-project 3).
- Absorbing `src/app/bonus-scanline.tsx` (sub-project 3).
- Cloud sync for sketches, and any `sync_outbox` rows for them.
- `iMouse`, `iFrame`, `iTimeDelta`.
- Syntax highlighting inside the editable buffer.
- New dependencies of any kind.
