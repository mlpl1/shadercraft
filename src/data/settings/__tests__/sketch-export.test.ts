import { exportSketch, sanitizeSketchFilename, type SketchExportAdapter } from "../sketch-export";
import type { Sketch } from "../../sketches/sketch-repository";

function buildSketch(overrides: Partial<Sketch> = {}): Sketch {
  return {
    id: "sketch-1",
    title: "Untitled",
    source: "void mainImage() {}",
    metadata: { version: 1, category: "Drafts", parameters: [] },
    metadataWarning: null,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  } as Sketch;
}

describe("sanitizeSketchFilename", () => {
  test.each([
    ["trims path-like punctuation into a .frag filename", "  waves:one/../  ", "waves-one.frag"],
    ["falls back when the sanitized title is empty", ".<>:\"/\\|?* ", "shader.frag"],
    ["keeps an existing .frag suffix", "Glow.frag", "Glow.frag"],
    ["removes control characters before export", "glow\u0000\u001Fline", "glowline.frag"],
    ["retains unicode letters", "café 光", "café 光.frag"],
  ])("%s", (_name, title, expected) => {
    expect(sanitizeSketchFilename(title)).toBe(expected);
  });
});

describe("exportSketch", () => {
  test("passes the sanitized filename and exact source to the adapter", async () => {
    const adapter: SketchExportAdapter = { share: jest.fn(async () => undefined) };
    const source = "void mainImage() {\n  fragColor = vec4(1.0);\n}\n";

    await exportSketch(buildSketch({ title: "Glow", source }), adapter);

    expect(adapter.share).toHaveBeenCalledWith("Glow.frag", source);
  });
});

