import {
  DEFAULT_SKETCH_METADATA,
  isValidShaderParameterKey,
  parseSketchMetadata,
  parseSketchMetadataResult,
  serializeSketchMetadata,
} from "../sketch-metadata";

describe("sketch metadata", () => {
  it("uses a fresh default when metadata is absent", () => {
    const metadata = parseSketchMetadata(undefined);

    expect(metadata).toEqual(DEFAULT_SKETCH_METADATA);
    expect(metadata).not.toBe(DEFAULT_SKETCH_METADATA);
    expect(metadata.parameters).not.toBe(DEFAULT_SKETCH_METADATA.parameters);
  });

  it("normalizes text and clamps parameter values", () => {
    expect(
      parseSketchMetadata({
        version: 1,
        category: "  Experiments  ",
        parameters: [
          {
            key: "  u_intensity  ",
            label: "  Intensity  ",
            min: 0,
            max: 5,
            step: 0.1,
            defaultValue: 9,
            value: -1,
          },
        ],
      }),
    ).toEqual({
      version: 1,
      category: "Experiments",
      parameters: [
        {
          key: "u_intensity",
          label: "Intensity",
          min: 0,
          max: 5,
          step: 0.1,
          defaultValue: 5,
          value: 0,
        },
      ],
    });
  });

  it("accepts GLSL identifiers except reserved shader names", () => {
    expect(isValidShaderParameterKey("u_speed")).toBe(true);
    expect(isValidShaderParameterKey("_detail2")).toBe(true);
    expect(isValidShaderParameterKey("iTime")).toBe(false);
    expect(isValidShaderParameterKey("mainImage")).toBe(false);
    expect(isValidShaderParameterKey("float")).toBe(false);
    expect(isValidShaderParameterKey("gl_Custom")).toBe(false);
    expect(isValidShaderParameterKey("9speed")).toBe(false);
    expect(isValidShaderParameterKey("u-speed")).toBe(false);
  });

  it("resets invalid metadata with a recoverable warning", () => {
    expect(parseSketchMetadataResult("broken")).toEqual({
      metadata: DEFAULT_SKETCH_METADATA,
      warning: "Saved shader parameters were invalid and have been reset.",
    });
  });

  it.each([
    ["an unsupported version", { version: 2, category: "Drafts", parameters: [] }],
    ["a blank category", { version: 1, category: "  ", parameters: [] }],
    ["a malformed parameter", {
      version: 1,
      category: "Drafts",
      parameters: [{ key: "u_x", label: "X", min: 0, max: 1, step: 0 }],
    }],
    ["duplicate keys", {
      version: 1,
      category: "Drafts",
      parameters: [
        { key: "u_x", label: "X", min: 0, max: 1, step: 0.1, defaultValue: 0, value: 0 },
        { key: " u_x ", label: "Other", min: 0, max: 1, step: 0.1, defaultValue: 0, value: 0 },
      ],
    }],
    ["reserved keys", {
      version: 1,
      category: "Drafts",
      parameters: [{ key: "gl_FragCoord", label: "Coordinate", min: 0, max: 1, step: 0.1, defaultValue: 0, value: 0 }],
    }],
    ["invalid numeric ranges", {
      version: 1,
      category: "Drafts",
      parameters: [{ key: "u_x", label: "X", min: 1, max: 1, step: 0.1, defaultValue: 0, value: 0 }],
    }],
  ])("resets %s", (_description, value) => {
    expect(parseSketchMetadata(value)).toEqual(DEFAULT_SKETCH_METADATA);
  });

  it("serializes normalized metadata without sharing mutable values", () => {
    const metadata = parseSketchMetadata({
      version: 1,
      category: "  Drafts ",
      parameters: [
        { key: "u_x", label: " X ", min: 0, max: 1, step: 0.1, defaultValue: 2, value: 0.5 },
      ],
    });

    expect(serializeSketchMetadata(metadata)).toBe(
      '{"version":1,"category":"Drafts","parameters":[{"key":"u_x","label":"X","min":0,"max":1,"step":0.1,"defaultValue":1,"value":0.5}]}',
    );
  });

  it("resets metadata with a sparse parameter list", () => {
    const metadata = parseSketchMetadata({ version: 1, category: "Drafts", parameters: new Array(1) });
    expect(metadata).toEqual(DEFAULT_SKETCH_METADATA);
    expect(metadata.parameters).toHaveLength(0);
  });
});
