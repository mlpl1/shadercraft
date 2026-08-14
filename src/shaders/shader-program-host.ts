import type { ExpoWebGLRenderingContext } from "expo-gl";

import type { ShaderParameterDefinition } from "../data/sketches/sketch-metadata";
import {
  type CompileError,
  getDeclaredShaderParameters,
  parseCompileLog,
  wrapMainImageBody,
} from "./shader-source";

/**
 * A full-viewport triangle pair. `fragCoord` comes from `gl_FragCoord.xy`, so the vertex stage needs
 * to pass nothing through.
 */
const VERTEX_SHADER_SOURCE = `attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const QUAD_VERTICES = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export type ShaderParameterValues = Readonly<Record<string, number>>;

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
  parameters: Map<string, WebGLUniformLocation | null>;
};

function parameterDefinitionSignature(
  parameters: readonly ShaderParameterDefinition[] | undefined,
): string {
  return JSON.stringify(
    (parameters ?? []).map(({ key, label, min, max, step, defaultValue }) => [
      key,
      label,
      min,
      max,
      step,
      defaultValue,
    ]),
  );
}

function parameterValuesFromDefinitions(
  parameters: readonly ShaderParameterDefinition[],
): ShaderParameterValues {
  const values: Record<string, number> = {};
  for (const parameter of parameters) values[parameter.key] = parameter.value;
  return values;
}

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
  private lastCompiledHelpers: string | undefined = undefined;
  private lastCompiledParameterSignature: string | null = null;
  private parameterValues: ShaderParameterValues = {};

  constructor(gl: ExpoWebGLRenderingContext) {
    this.gl = gl;
    // Pairs with the `#extension GL_OES_standard_derivatives` directive in the prologue. On a WebGL1
    // context — which Expo warns some older Android devices still give — the derivative built-ins
    // stay unavailable until the extension is requested through the API as well as the shader. On
    // WebGL2 they are core and this returns null, which is why the result is deliberately unused:
    // the call is for the weaker context, and the directive is what the ES 1.00 compiler reads.
    gl.getExtension("OES_standard_derivatives");
  }

  hasProgram(): boolean {
    return this.active !== null;
  }

  /**
   * Compiles `body` and, on success, makes it the program subsequent {@link render} calls draw.
   * Returns the outcome rather than throwing: half-typed source is the normal state of an editor, not
   * an exceptional one.
   */
  setBody(
    body: string,
    helpers?: string,
    parameters?: readonly ShaderParameterDefinition[],
  ): HostCompileResult {
    if (body.trim().length === 0) {
      return {
        ok: false,
        errors: [],
        rawLog: "",
        showingLastWorking: this.active !== null,
      };
    }

    // Helpers and parameter definitions are part of the compiled program. Parameter values are
    // excluded from the signature so slider changes reuse the active program.
    const definitionSignature = parameterDefinitionSignature(parameters);
    const declaredParameters = getDeclaredShaderParameters(parameters);
    const parameterValues = parameterValuesFromDefinitions(declaredParameters);
    if (
      body === this.lastCompiledBody &&
      helpers === this.lastCompiledHelpers &&
      definitionSignature === this.lastCompiledParameterSignature
    ) {
      this.parameterValues = parameterValues;
      return { ok: true };
    }

    const { source, lineOffset } = wrapMainImageBody(body, helpers, declaredParameters);
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
      parameters: new Map(
        declaredParameters.map((parameter) => [
          parameter.key,
          gl.getUniformLocation(program, parameter.key),
        ]),
      ),
    };
    this.lastCompiledBody = body;
    this.lastCompiledHelpers = helpers;
    this.lastCompiledParameterSignature = definitionSignature;
    this.parameterValues = parameterValues;
    this.ensureBuffer(program);

    return { ok: true };
  }

  setParameterValues(values: ShaderParameterValues): void {
    this.parameterValues = { ...values };
  }

  render(timeSeconds: number, width: number, height: number): void {
    const active = this.active;
    if (!active) return;

    const gl = this.gl;
    gl.useProgram(active.program);
    gl.viewport(0, 0, width, height);
    gl.uniform3f(active.resolution, width, height, 1);
    gl.uniform1f(active.time, timeSeconds);
    for (const [key, location] of active.parameters) {
      const value = this.parameterValues[key];
      if (Number.isFinite(value)) gl.uniform1f(location, value);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    if (this.active) gl.deleteProgram(this.active.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);
    this.active = null;
    this.buffer = null;
    this.lastCompiledBody = null;
    this.lastCompiledHelpers = undefined;
    this.lastCompiledParameterSignature = null;
    this.parameterValues = {};
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
