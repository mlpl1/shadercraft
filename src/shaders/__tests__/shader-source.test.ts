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
      "#extension GL_OES_standard_derivatives : enable",
      "precision highp float;",
      "uniform vec3 iResolution;",
      "uniform float iTime;",
      "void mainImage(out vec4 fragColor, in vec2 fragCoord) {",
    ]);
  });

  // GLSL requires every `#extension` above the first non-preprocessor token, so this is a
  // correctness constraint on the wrapper rather than a matter of ordering taste: were `precision`
  // to drift above it, every shader the app compiles would fail at once.
  it("declares the derivatives extension before any non-preprocessor line", () => {
    const { source } = wrapMainImageBody("fragColor = vec4(1.0);");
    const lines = source.split("\n");

    expect(lines[0]).toBe("#extension GL_OES_standard_derivatives : enable");
    expect(lines.findIndex((line) => line.startsWith("#extension"))).toBeLessThan(
      lines.findIndex((line) => !line.startsWith("#")),
    );
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
  // A literal, deliberately not `SHADER_BODY_LINE_OFFSET`. `parseCompileLog` takes the offset as a
  // parameter and its arithmetic is the same at any value, so binding these expectations to the real
  // prologue only made all five break the moment a line was added to it. One test above already ties
  // the exported constant to the prologue it describes; that is the coupling worth having.
  const OFFSET = 4;
  it("subtracts the prologue offset from a standard ERROR line", () => {
    const errors = parseCompileLog(
      "ERROR: 0:7: 'foo' : undeclared identifier",
      OFFSET,
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
      OFFSET,
    );

    expect(errors.map((error) => error.line)).toEqual([1, 5]);
  });

  it("clamps a diagnostic inside the prologue to line 1 and keeps its raw text", () => {
    const errors = parseCompileLog("ERROR: 0:2: 'iTime' : redefinition", OFFSET);

    expect(errors[0].line).toBe(1);
    expect(errors[0].raw).toBe("ERROR: 0:2: 'iTime' : redefinition");
  });

  it("parses a bare file:line diagnostic with no severity prefix", () => {
    const errors = parseCompileLog("0:8: L0001: syntax error", OFFSET);

    expect(errors[0]).toEqual({
      line: 4,
      message: "L0001: syntax error",
      raw: "0:8: L0001: syntax error",
    });
  });

  it("keeps a line it cannot parse, with a null line number", () => {
    const errors = parseCompileLog("Compilation failed", OFFSET);

    expect(errors).toEqual([
      { line: null, message: "Compilation failed", raw: "Compilation failed" },
    ]);
  });

  it("keeps warnings so they are not silently dropped", () => {
    const errors = parseCompileLog("WARNING: 0:6: 'x' : unused", OFFSET);

    expect(errors[0].line).toBe(2);
  });

  it("survives CRLF endings, blank lines and trailing null terminators", () => {
    const errors = parseCompileLog(
      `ERROR: 0:5: 'a' : bad\r\n\r\nERROR: 0:6: 'b' : bad\r\n ${String.fromCharCode(0)}`,
      OFFSET,
    );

    expect(errors).toHaveLength(2);
    expect(errors.map((error) => error.line)).toEqual([1, 2]);
    // Stripping the terminator must not strip the spaces inside a message.
    expect(errors[0].message).toBe("'a' : bad");
  });

  it("returns nothing for an empty log", () => {
    expect(parseCompileLog("", OFFSET)).toEqual([]);
  });
});
