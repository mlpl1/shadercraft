/**
 * A scriptable stand-in for `ExpoWebGLRenderingContext`, covering only the calls
 * `ShaderProgramHost` makes. No Jest environment provides a real GL context, and the behaviour worth
 * testing — that a failed compile is reported rather than thrown, and that every superseded program
 * is deleted — is invisible without one.
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

type UniformCall = { name: string; values: number[] };

export type FakeGl = ReturnType<typeof createFakeGl>;

export function createFakeGl(script: FakeGlScript = {}) {
  let nextId = 1;
  const live = new Set<number>();
  let created = 0;
  let deleted = 0;
  let draws = 0;
  const uniformNames = new Map<number, string>();
  const uniformCalls: UniformCall[] = [];

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

  const record = (location: { id: number } | null, values: number[]) => {
    if (!location) return;
    uniformCalls.push({ name: uniformNames.get(location.id) ?? "?", values });
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
    vertexAttribPointer: (
      _index: number,
      _size: number,
      _type: number,
      _normalized: boolean,
      _stride: number,
      _offset: number,
    ) => undefined,

    getUniformLocation: (_program: Handle, name: string) => {
      const id = nextId++;
      uniformNames.set(id, name);
      return { id };
    },
    uniform1f: (location: { id: number } | null, value: number) => record(location, [value]),
    uniform3f: (location: { id: number } | null, x: number, y: number, z: number) =>
      record(location, [x, y, z]),

    viewport: (_x: number, _y: number, _width: number, _height: number) => undefined,
    clearColor: (_r: number, _g: number, _b: number, _a: number) => undefined,
    clear: (_mask: number) => undefined,
    drawArrays: (_mode: number, _first: number, _count: number) => {
      draws += 1;
    },
    endFrameEXP: () => undefined,

    drawingBufferWidth: 400,
    drawingBufferHeight: 300,

    uniformCalls,
    liveObjectCount: () => live.size,
    createdCount: () => created,
    deletedCount: () => deleted,
    drawCount: () => draws,
  };
}
