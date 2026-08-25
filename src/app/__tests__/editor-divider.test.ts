import { clampPreviewHeight } from "../../components/editor-layout";

describe("clampPreviewHeight", () => {
  it("keeps the divider within usable preview bounds", () => {
    expect(clampPreviewHeight(20, 640)).toBe(120);
    expect(clampPreviewHeight(400, 800)).toBe(400);
    expect(clampPreviewHeight(900, 640)).toBe(384);
  });
});
