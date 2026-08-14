import { migrateDatabase } from "../../database/migrations";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import { DEFAULT_SKETCH_METADATA } from "../sketch-metadata";
import { SqliteSketchRepository } from "../sqlite-sketch-repository";

const PROFILE_A = "profile-a";
const PROFILE_B = "profile-b";

async function createContext() {
  const driver = new NodeSqliteDriver(":memory:");
  await migrateDatabase(driver);

  for (const id of [PROFILE_A, PROFILE_B]) {
    await driver.run(
      `INSERT INTO learner_profiles (id, kind, supabase_user_id, merged_into_profile_id, created_at, last_used_at)
       VALUES (?, 'anonymous', NULL, NULL, ?, ?)`,
      [id, "2026-08-06T00:00:00.000Z", "2026-08-06T00:00:00.000Z"],
    );
  }

  let nextId = 0;
  let clock = 0;
  const repository = new SqliteSketchRepository(driver, {
    generateId: () => `sketch-${++nextId}`,
    // A strictly increasing clock so `updatedAt DESC` ordering is assertable.
    now: () => `2026-08-06T00:00:${String(clock++).padStart(2, "0")}.000Z`,
  });

  return { driver, repository };
}

describe("SqliteSketchRepository", () => {
  let context: Awaited<ReturnType<typeof createContext>>;

  beforeEach(async () => {
    context = await createContext();
  });

  afterEach(async () => {
    await context.driver.close();
  });

  it("creates a sketch and reads it back", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "fragColor = vec4(1.0);");

    expect(created.id).toBe("sketch-1");
    expect(created.title).toBe("First");
    expect(created.metadata).toEqual(DEFAULT_SKETCH_METADATA);
    expect(created.metadataWarning).toBeNull();
    expect(await context.repository.get(PROFILE_A, created.id)).toEqual(created);
  });

  it("falls back to default metadata when stored JSON is malformed", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.driver.run("UPDATE sketches SET metadata_json = ? WHERE id = ?", ["not json", created.id]);

    const loaded = await context.repository.get(PROFILE_A, created.id);

    expect(loaded?.metadata).toEqual(DEFAULT_SKETCH_METADATA);
    expect(loaded?.metadataWarning).toBe("Saved shader parameters were invalid and have been reset.");
  });

  it("returns null for a sketch that does not exist", async () => {
    expect(await context.repository.get(PROFILE_A, "missing")).toBeNull();
  });

  it("lists sketches most recently updated first", async () => {
    const first = await context.repository.create(PROFILE_A, "First", "a");
    const second = await context.repository.create(PROFILE_A, "Second", "b");
    await context.repository.updateSource(PROFILE_A, first.id, "a2");

    const listed = await context.repository.list(PROFILE_A);

    expect(listed.map((sketch) => sketch.id)).toEqual([first.id, second.id]);
  });

  it("lists nothing for a profile with no sketches", async () => {
    expect(await context.repository.list(PROFILE_A)).toEqual([]);
  });

  it("isolates sketches per profile", async () => {
    const mine = await context.repository.create(PROFILE_A, "Mine", "a");

    expect(await context.repository.list(PROFILE_B)).toEqual([]);
    expect(await context.repository.get(PROFILE_B, mine.id)).toBeNull();
  });

  it("refuses to update another profile's sketch", async () => {
    const mine = await context.repository.create(PROFILE_A, "Mine", "a");

    await context.repository.updateSource(PROFILE_B, mine.id, "hacked");

    expect((await context.repository.get(PROFILE_A, mine.id))?.source).toBe("a");
  });

  it("refuses to delete another profile's sketch", async () => {
    const mine = await context.repository.create(PROFILE_A, "Mine", "a");

    await context.repository.delete(PROFILE_B, mine.id);

    expect(await context.repository.get(PROFILE_A, mine.id)).not.toBeNull();
  });

  it("advances updatedAt but preserves createdAt on a source update", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.updateSource(PROFILE_A, created.id, "b");

    const updated = await context.repository.get(PROFILE_A, created.id);

    expect(updated?.source).toBe("b");
    expect(updated?.createdAt).toBe(created.createdAt);
    expect(updated?.updatedAt).not.toBe(created.updatedAt);
  });

  it("is idempotent when autosave writes the same source twice", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.updateSource(PROFILE_A, created.id, "b");
    const afterFirst = await context.repository.get(PROFILE_A, created.id);
    await context.repository.updateSource(PROFILE_A, created.id, "b");

    expect(await context.repository.get(PROFILE_A, created.id)).toEqual(afterFirst);
  });

  it("persists metadata across repository reconstruction", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.updateMetadata(PROFILE_A, created.id, {
      version: 1,
      category: "Experiments",
      parameters: [
        { key: "u_gain", label: "Gain", min: 0, max: 2, step: 0.1, defaultValue: 1, value: 1.4 },
      ],
    });

    const reopened = new SqliteSketchRepository(context.driver);

    expect((await reopened.get(PROFILE_A, created.id))?.metadata.category).toBe("Experiments");
  });

  it("refuses to update another profile's metadata", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");

    await context.repository.updateMetadata(PROFILE_B, created.id, {
      version: 1,
      category: "Experiments",
      parameters: [],
    });

    expect((await context.repository.get(PROFILE_A, created.id))?.metadata).toEqual(
      DEFAULT_SKETCH_METADATA,
    );
  });

  it("advances updatedAt only when serialized metadata changes", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    const metadata = {
      version: 1 as const,
      category: "Experiments",
      parameters: [],
    };

    await context.repository.updateMetadata(PROFILE_A, created.id, metadata);
    const afterFirst = await context.repository.get(PROFILE_A, created.id);
    await context.repository.updateMetadata(PROFILE_A, created.id, { ...metadata, parameters: [] });

    const afterSecond = await context.repository.get(PROFILE_A, created.id);
    expect(afterFirst?.updatedAt).not.toBe(created.updatedAt);
    expect(afterSecond?.updatedAt).toBe(afterFirst?.updatedAt);
  });

  it("renames without touching the source", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.rename(PROFILE_A, created.id, "Renamed");

    const renamed = await context.repository.get(PROFILE_A, created.id);

    expect(renamed?.title).toBe("Renamed");
    expect(renamed?.source).toBe("a");
  });

  it("deletes a sketch", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.delete(PROFILE_A, created.id);

    expect(await context.repository.get(PROFILE_A, created.id)).toBeNull();
  });

  it("removes a profile's sketches when the profile is deleted", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.driver.run("DELETE FROM learner_profiles WHERE id = ?", [PROFILE_A]);

    expect(await context.repository.get(PROFILE_A, created.id)).toBeNull();
  });

  it("writes no outbox rows, because sketches are local-only", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");
    await context.repository.updateSource(PROFILE_A, created.id, "b");
    await context.repository.updateMetadata(PROFILE_A, created.id, {
      version: 1,
      category: "Experiments",
      parameters: [],
    });

    expect(await context.driver.all("SELECT * FROM sync_outbox")).toEqual([]);
  });

  it("survives being rebuilt over the same database, as an app restart would", async () => {
    const created = await context.repository.create(PROFILE_A, "First", "a");

    const reopened = new SqliteSketchRepository(context.driver);

    expect((await reopened.get(PROFILE_A, created.id))?.source).toBe("a");
  });
});
