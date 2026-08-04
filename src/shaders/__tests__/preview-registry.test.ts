import {
  getPreviewParameterType,
  isPreviewKey,
  SHADER_PREVIEW_MODE_VALUES,
  SHADER_PREVIEW_PARAMETER_TYPES,
} from "../preview-registry";

describe("preview registry", () => {
  it("recognizes every current preview and rejects unknown remote keys", () => {
    expect(SHADER_PREVIEW_MODE_VALUES["lighting-final"]).toBe(59);
    expect(isPreviewKey("edge-smooth")).toBe(true);
    expect(isPreviewKey("remote-arbitrary-shader")).toBe(false);
  });

  it("types the supported preview parameters and rejects unsupported names", () => {
    expect(SHADER_PREVIEW_PARAMETER_TYPES).toEqual({
      animated: "boolean",
      restartable: "boolean",
    });
    expect(getPreviewParameterType("animated")).toBe("boolean");
    expect(getPreviewParameterType("restartable")).toBe("boolean");
    expect(getPreviewParameterType("remoteArbitraryBehavior")).toBeUndefined();
  });
});
