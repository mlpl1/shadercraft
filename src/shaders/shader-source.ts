/**
 * The lines the app prepends to a learner's `mainImage` body. Their count is the offset every
 * reported error line is corrected by, so adding a line here shifts every error message: keep
 * {@link SHADER_BODY_LINE_OFFSET} derived from this array rather than hardcoded anywhere else.
 *
 * GLSL ES 1.00 deliberately: `ExpoWebGLRenderingContext` extends `WebGL2RenderingContext`, but the
 * Expo SDK 57 documentation warns that some older Android devices lack WebGL2. `out`/`in` on
 * function parameters is valid 1.00 — only stage-level `in`/`out` variables need 3.00 — so
 * `mainImage` compiles here and still pastes into Shadertoy.
 *
 * The extension directive buys `fwidth`/`dFdx`/`dFdy`, which are core in GLSL ES 3.00 but not in
 * 1.00, and which Module 3 teaches antialiasing with. It must be the very first line: `#extension`
 * is only valid above every non-preprocessor token, so no stage body could ever supply it — this is
 * the one capability the curriculum needs that content genuinely cannot carry.
 *
 * `enable`, not `require`: on hardware without the extension `require` fails the whole compile,
 * while `enable` warns and leaves the built-ins undeclared, so only a shader that actually calls one
 * breaks. Every device new enough to run this app supports it; the weaker directive just keeps the
 * blast radius to the stage that asked for it.
 */
const HEADER_LINES = [
  "#extension GL_OES_standard_derivatives : enable",
  "precision highp float;",
  "uniform vec3 iResolution;",
  "uniform float iTime;",
] as const;

/**
 * Split from the header so an optional block of helper declarations can sit between them. GLSL has
 * no nested functions, and a stage body is spliced inside `mainImage`, so without this split a stage
 * could never declare one — which blocks fractal noise, domain warping, and every ray-marching
 * lesson in Act 2, none of which have an inline form.
 */
const MAIN_IMAGE_OPEN = "void mainImage(out vec4 fragColor, in vec2 fragCoord) {";

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

/**
 * How many wrapper lines sit above line 1 of a body carrying no helpers — the Editor tab's case, and
 * every stage authored before helpers existed. A stage that declares helpers pushes `mainImage` down
 * by their line count, so the real offset is whatever {@link wrapMainImageBody} returns; this
 * constant is the floor it reduces to, not a value to correct errors by on its own.
 */
export const SHADER_BODY_LINE_OFFSET = HEADER_LINES.length + 1;

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

/**
 * Wraps `body` into a complete shader, optionally declaring `helpers` above `mainImage`.
 *
 * `helpers` is trimmed before its lines are counted, so a stray leading or trailing newline in
 * authored content cannot shift every reported error line by one.
 *
 * A diagnostic pointing inside the helpers still clamps to body line 1, which is wrong but harmless:
 * helpers exist only in authored lesson stages, which are read-only, and the raw log is always shown
 * beside the mapped lines. The Editor tab, where a learner's own typing is what fails, passes no
 * helpers at all and so is unaffected.
 */
export function wrapMainImageBody(
  body: string,
  helpers?: string,
): { source: string; lineOffset: number } {
  const trimmedHelpers = helpers?.trim() ?? "";
  const aboveBody = [
    ...HEADER_LINES,
    ...(trimmedHelpers.length > 0 ? trimmedHelpers.split("\n") : []),
    MAIN_IMAGE_OPEN,
  ];

  return {
    source: [...aboveBody, body, ...EPILOGUE_LINES].join("\n"),
    lineOffset: aboveBody.length,
  };
}

/** `ERROR: 0:12: message` and `WARNING: 0:12: message` — the common ANGLE/Mesa/Adreno shape. */
const PREFIXED_DIAGNOSTIC = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.+)$/i;

/** `0:12: message` — the same thing without a severity word, seen on some Mali drivers. */
const BARE_DIAGNOSTIC = /^\d+:(\d+):\s*(.+)$/;

/**
 * Written as an expression rather than an escape so this file stays plain ASCII — a literal NUL in
 * source is invisible in review and makes the file read as binary to git and grep.
 */
const NULL_TERMINATOR = String.fromCharCode(0);

/**
 * Turns an info log into per-line diagnostics with line numbers translated back into the learner's
 * buffer. Only ever called after a failed compile or link, so retaining warnings alongside errors
 * gives context rather than noise.
 *
 * Driver log formats vary and are not contractual, so parsing is best-effort by design: an
 * unrecognized line still yields an entry carrying its text verbatim. Callers must show the raw log
 * regardless — line mapping must never be the only way to see what went wrong.
 */
export function parseCompileLog(log: string, lineOffset: number): CompileError[] {
  return log
    // Some drivers hand back the log with its C null terminator still attached.
    .split(NULL_TERMINATOR)
    .join("")
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
