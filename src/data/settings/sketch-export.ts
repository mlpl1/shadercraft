import type { Sketch } from "../sketches/sketch-repository";

export interface SketchExportAdapter {
  share(filename: string, source: string): Promise<void>;
}

const FALLBACK_FILENAME_BASE = "shader";
const FRAG_SUFFIX = ".frag";
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;
const RESERVED_FILENAME_CHARACTERS = /[.<>:"/\\|?*]+/g;
const REPEATED_DASHES = /-+/g;
const EDGE_SEPARATORS = /^[\s.-]+|[\s.-]+$/g;

export function sanitizeSketchFilename(title: string): string {
  const withoutSuffix = title.trim().replace(/\.frag$/i, "");
  const base = withoutSuffix
    .replace(CONTROL_CHARACTERS, "")
    .replace(RESERVED_FILENAME_CHARACTERS, "-")
    .replace(REPEATED_DASHES, "-")
    .replace(EDGE_SEPARATORS, "")
    .trim();

  return `${base || FALLBACK_FILENAME_BASE}${FRAG_SUFFIX}`;
}

export async function exportSketch(sketch: Sketch, adapter: SketchExportAdapter): Promise<void> {
  await adapter.share(sanitizeSketchFilename(sketch.title), sketch.source);
}

export const sketchExportAdapter: SketchExportAdapter = {
  async share() {
    throw new Error("Sketch export is only available through a platform adapter.");
  },
};
