import { tokenizeGlsl } from "../glsl-highlight";

describe("tokenizeGlsl", () => {
  it("preserves source text while classifying GLSL constructs", () => {
    const source = `#version 100\nprecision mediump float;\n// note\nvoid main() {\n  vec3 color = texture2D(tex, uv);\n  gl_FragColor = vec4(color, 1.0);\n}`;
    const result = tokenizeGlsl(source);

    expect(result.map((token) => token.text).join("")).toBe(source);
    expect(result.some((token) => token.kind === "directive" && token.text.startsWith("#version"))).toBe(true);
    expect(result.some((token) => token.kind === "comment")).toBe(true);
    expect(result.some((token) => token.kind === "type" && token.text === "vec3")).toBe(true);
    expect(result.some((token) => token.kind === "keyword" && token.text === "void")).toBe(true);
    expect(result.some((token) => token.kind === "number" && token.text === "1.0")).toBe(true);
  });

  it("keeps strings and incomplete comments intact", () => {
    const source = `const char* label = "color"; /* unfinished`;
    const result = tokenizeGlsl(source);

    expect(result.map((token) => token.text).join("")).toBe(source);
    expect(result.find((token) => token.text === '"color"')?.kind).toBe("string");
    expect(result.find((token) => token.text === "/* unfinished")?.kind).toBe("comment");
  });

  it("leaves unknown identifiers and punctuation as plain tokens", () => {
    const result = tokenizeGlsl("customValue + foo.bar;");

    expect(result.find((token) => token.text === "customValue")?.kind).toBe("plain");
    expect(result.find((token) => token.text === "+")?.kind).toBe("plain");
    expect(result.find((token) => token.text === ".")?.kind).toBe("plain");
  });

  it("does not emit empty tokens", () => {
    expect(tokenizeGlsl("").every((token) => token.text.length > 0)).toBe(true);
  });
});
