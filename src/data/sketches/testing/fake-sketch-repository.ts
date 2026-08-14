import {
  DEFAULT_SKETCH_METADATA,
  parseSketchMetadataResult,
  serializeSketchMetadata,
} from "../sketch-metadata";
import type { Sketch, SketchRepository } from "../sketch-repository";

type Row = { profileId: string; sketch: Sketch };

/**
 * An in-memory {@link SketchRepository} for suites that must satisfy the data context's shape without
 * exercising sketches at all — every screen test predating the editor is in that position.
 *
 * Deliberately a working implementation rather than throwing stubs: a test that accidentally reads
 * sketches gets empty results instead of an error whose stack points nowhere useful.
 */
export function createFakeSketchRepository(initial: Row[] = []): SketchRepository {
  const rows: Row[] = [...initial];
  let nextId = rows.length;

  const find = (profileId: string, id: string) =>
    rows.find((row) => row.profileId === profileId && row.sketch.id === id);

  return {
    async list(profileId) {
      return rows
        .filter((row) => row.profileId === profileId)
        .sort((left, right) => right.sketch.updatedAt.localeCompare(left.sketch.updatedAt))
        .map((row) => row.sketch);
    },

    async get(profileId, id) {
      return find(profileId, id)?.sketch ?? null;
    },

    async create(profileId, title, source) {
      nextId += 1;
      const sketch: Sketch = {
        id: `fake-sketch-${nextId}`,
        title,
        source,
        metadata: parseSketchMetadataResult(DEFAULT_SKETCH_METADATA).metadata,
        metadataWarning: null,
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      };
      rows.unshift({ profileId, sketch });
      return sketch;
    },

    async updateSource(profileId, id, source) {
      const row = find(profileId, id);
      if (row) row.sketch = { ...row.sketch, source };
    },

    async updateMetadata(profileId, id, metadata) {
      const row = find(profileId, id);
      const metadataJson = serializeSketchMetadata(metadata);
      if (row && serializeSketchMetadata(row.sketch.metadata) !== metadataJson) {
        row.sketch = {
          ...row.sketch,
          metadata: parseSketchMetadataResult(metadata).metadata,
          metadataWarning: null,
          updatedAt: new Date().toISOString(),
        };
      }
    },

    async rename(profileId, id, title) {
      const row = find(profileId, id);
      if (row) row.sketch = { ...row.sketch, title };
    },

    async delete(profileId, id) {
      const index = rows.findIndex((row) => row.profileId === profileId && row.sketch.id === id);
      if (index >= 0) rows.splice(index, 1);
    },
  };
}
