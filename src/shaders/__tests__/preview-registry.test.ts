import {
  isPreviewKey,
  SHADER_PREVIEW_MODE_VALUES,
} from "../preview-registry";

describe("preview registry", () => {
  it("recognizes every current preview and rejects unknown remote keys", () => {
    expect(SHADER_PREVIEW_MODE_VALUES["lighting-final"]).toBe(59);
    expect(isPreviewKey("edge-smooth")).toBe(true);
    expect(isPreviewKey("remote-arbitrary-shader")).toBe(false);
  });
});
