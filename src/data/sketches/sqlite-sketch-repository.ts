import * as Crypto from "expo-crypto";

import type { DatabaseDriver } from "../database/driver";
import {
  type SketchMetadata,
  DEFAULT_SKETCH_METADATA,
  parseSketchMetadataResult,
  serializeSketchMetadata,
} from "./sketch-metadata";
import type { Sketch, SketchRepository } from "./sketch-repository";

const COLUMNS = "id, title, source, metadata_json, created_at, updated_at";

type SketchRow = {
  id: string;
  title: string;
  source: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

function parseStoredMetadata(metadataJson: string) {
  try {
    return parseSketchMetadataResult(JSON.parse(metadataJson));
  } catch {
    return parseSketchMetadataResult(null);
  }
}

function toSketch(row: SketchRow): Sketch {
  const { metadata, warning } = parseStoredMetadata(row.metadata_json);

  return {
    id: row.id,
    title: row.title,
    source: row.source,
    metadata,
    metadataWarning: warning,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type SqliteSketchRepositoryOptions = {
  /** Overridable for deterministic tests; defaults to `Crypto.randomUUID()`. */
  generateId?: () => string;
  /** Overridable for deterministic tests; defaults to the current time. */
  now?: () => string;
};

export class SqliteSketchRepository implements SketchRepository {
  private readonly driver: DatabaseDriver;
  private readonly generateId: () => string;
  private readonly now: () => string;

  constructor(driver: DatabaseDriver, options: SqliteSketchRepositoryOptions = {}) {
    this.driver = driver;
    this.generateId = options.generateId ?? (() => Crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async list(profileId: string): Promise<Sketch[]> {
    const rows = await this.driver.all<SketchRow>(
      // `id ASC` breaks ties so ordering is total: autosave can stamp two sketches in the same
      // millisecond, and a list that reorders between reads makes the sketch picker jump.
      `SELECT ${COLUMNS} FROM sketches WHERE profile_id = ? ORDER BY updated_at DESC, id ASC`,
      [profileId],
    );
    return rows.map(toSketch);
  }

  async get(profileId: string, id: string): Promise<Sketch | null> {
    const row = await this.driver.first<SketchRow>(
      `SELECT ${COLUMNS} FROM sketches WHERE profile_id = ? AND id = ?`,
      [profileId, id],
    );
    return row ? toSketch(row) : null;
  }

  async create(profileId: string, title: string, source: string): Promise<Sketch> {
    const timestamp = this.now();
    const metadata = parseSketchMetadataResult(DEFAULT_SKETCH_METADATA).metadata;
    const sketch: Sketch = {
      id: this.generateId(),
      title,
      source,
      metadata,
      metadataWarning: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.driver.run(
      `INSERT INTO sketches (id, profile_id, title, source, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        sketch.id,
        profileId,
        sketch.title,
        sketch.source,
        serializeSketchMetadata(sketch.metadata),
        sketch.createdAt,
        sketch.updatedAt,
      ],
    );

    return sketch;
  }

  /**
   * Autosave calls this on a debounce, so it must be idempotent: `source <> ?` makes an unchanged
   * write match zero rows and leave `updated_at` alone. Without that guard, re-saving identical text
   * would bump the timestamp and silently reorder the sketch list under the learner.
   *
   * The comparison lives in the statement rather than a read followed by a write, so it stays atomic
   * without needing a transaction.
   */
  async updateSource(profileId: string, id: string, source: string): Promise<void> {
    // `profile_id` is in the predicate, not just the lookup: a stale screen must not be able to write
    // into another profile's row after an account switch.
    await this.driver.run(
      "UPDATE sketches SET source = ?, updated_at = ? WHERE profile_id = ? AND id = ? AND source <> ?",
      [source, this.now(), profileId, id, source],
    );
  }

  async updateMetadata(profileId: string, id: string, metadata: SketchMetadata): Promise<void> {
    const json = serializeSketchMetadata(metadata);
    await this.driver.run(
      "UPDATE sketches SET metadata_json = ?, updated_at = ? WHERE profile_id = ? AND id = ? AND metadata_json <> ?",
      [json, this.now(), profileId, id, json],
    );
  }

  /** Not guarded like {@link updateSource}: a rename is an explicit action, never issued on a timer. */
  async rename(profileId: string, id: string, title: string): Promise<void> {
    await this.driver.run(
      "UPDATE sketches SET title = ?, updated_at = ? WHERE profile_id = ? AND id = ?",
      [title, this.now(), profileId, id],
    );
  }

  async delete(profileId: string, id: string): Promise<void> {
    await this.driver.run("DELETE FROM sketches WHERE profile_id = ? AND id = ?", [profileId, id]);
  }
}
