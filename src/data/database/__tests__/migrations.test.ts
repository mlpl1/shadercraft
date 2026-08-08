import { getPendingMigrations, LATEST_SCHEMA_VERSION, migrateDatabase } from "../migrations";
import { NodeSqliteDriver } from "../testing/node-sqlite-driver";

type TableInfoRow = {
  name: string;
  notnull: number;
  pk: number;
};

type ForeignKeyRow = {
  from: string;
  id: number;
  on_delete: string;
  seq: number;
  table: string;
  to: string;
};

type IndexRow = {
  name: string;
};

describe("database migrations", () => {
  let driver: NodeSqliteDriver;

  beforeEach(() => {
    driver = new NodeSqliteDriver(":memory:");
  });

  afterEach(async () => {
    await driver.close();
  });

  test("selects only migrations newer than the current schema", () => {
    // Written against the chain's shape rather than its current length, which was `[1]` until a
    // second migration existed and broke this alongside two others that hardcoded the same number.
    const all = getPendingMigrations(0).map((migration) => migration.version);

    expect(all[0]).toBe(1);
    expect(all.at(-1)).toBe(LATEST_SCHEMA_VERSION);
    expect(all).toEqual([...all].sort((left, right) => left - right));

    // The selection itself: from the first version, that one is dropped and the rest survive.
    expect(getPendingMigrations(1).map((migration) => migration.version)).toEqual(all.slice(1));
    expect(getPendingMigrations(LATEST_SCHEMA_VERSION)).toEqual([]);
    expect(() => getPendingMigrations(LATEST_SCHEMA_VERSION + 1)).toThrow(/newer schema/i);
  });

  test("migrates an empty database to the latest schema", async () => {
    await migrateDatabase(driver);

    expect(await driver.first<{ user_version: number }>("PRAGMA user_version")).toEqual({
      user_version: LATEST_SCHEMA_VERSION,
    });

    const tables = await driver.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    expect(tables.map(({ name }) => name)).toEqual([
      "app_metadata",
      "content_releases",
      "learner_profiles",
      "lesson_progress",
      "lesson_stages",
      "lessons",
      "modules",
      "sketches",
      "sync_outbox",
      "sync_state",
      "tutorial_step_drafts",
      "tutorial_step_progress",
      "tutorial_steps",
      "tutorials",
    ]);
  });

  test("lesson_stages cascades from its lesson and carries required source", async () => {
    await migrateDatabase(driver);

    const columns = await driver.all<TableInfoRow>("PRAGMA table_info(lesson_stages)");
    expect(columns.map(({ name }) => name).sort()).toEqual([
      "body",
      "helpers",
      "id",
      "lesson_id",
      "position",
      "release_id",
      "source",
      "title",
    ]);

    // `helpers` is the one nullable column, and deliberately so: most stages declare no functions,
    // and NULL keeps "no helpers" a single representation rather than splitting it between NULL on
    // rows written before the column existed and '' on rows written after. Named here rather than
    // asserted away with `every`, so adding a second nullable column has to be a decision.
    const nullable = columns.filter(({ notnull }) => notnull === 0).map(({ name }) => name);
    expect(nullable).toEqual(["helpers"]);

    const foreignKeys = await driver.all<ForeignKeyRow>("PRAGMA foreign_key_list(lesson_stages)");
    expect(foreignKeys.map(({ from }) => from).sort()).toEqual(["lesson_id", "release_id"]);
    expect(foreignKeys[0].on_delete).toBe("CASCADE");
  });

  test("adds the sketches table, cascading from the owning profile", async () => {
    await migrateDatabase(driver);

    const columns = await driver.all<TableInfoRow>("PRAGMA table_info(sketches)");
    expect(columns.map(({ name }) => name).sort()).toEqual([
      "created_at",
      "id",
      "profile_id",
      "source",
      "title",
      "updated_at",
    ]);
    // Every column is required: a sketch with no source could not be compiled or shown.
    expect(columns.every(({ notnull }) => notnull === 1)).toBe(true);

    const foreignKeys = await driver.all<ForeignKeyRow>("PRAGMA foreign_key_list(sketches)");
    expect(foreignKeys).toHaveLength(1);
    expect(foreignKeys[0]).toMatchObject({
      from: "profile_id",
      table: "learner_profiles",
      to: "id",
      on_delete: "CASCADE",
    });

    const indexes = await driver.all<IndexRow>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'sketches'",
    );
    expect(indexes.map(({ name }) => name)).toContain("idx_sketches_profile_updated_at");
  });

  test("re-running the migration chain is a no-op", async () => {
    await migrateDatabase(driver);
    // A second run must be a no-op rather than an error.
    await migrateDatabase(driver);

    expect(await driver.first<{ user_version: number }>("PRAGMA user_version")).toEqual({
      user_version: LATEST_SCHEMA_VERSION,
    });
  });

  test.each([
    ["modules", ["release_id", "id"]],
    ["lessons", ["release_id", "id"]],
    ["lesson_stages", ["release_id", "id"]],
    ["lesson_progress", ["profile_id", "lesson_id"]],
    ["sync_outbox", ["profile_id", "mutation_id"]],
    ["sync_state", ["profile_id", "resource"]],
  ])("uses the required composite primary key for %s", async (table, expectedColumns) => {
    await migrateDatabase(driver);

    const columns = await driver.all<TableInfoRow>(`PRAGMA table_info(${table})`);
    expect(
      columns
        .filter(({ pk }) => pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map(({ name }) => name),
    ).toEqual(expectedColumns);
  });

  test.each([
    ["modules", "content_releases", ["release_id"], ["id"]],
    ["lessons", "modules", ["release_id", "module_id"], ["release_id", "id"]],
    ["lesson_stages", "lessons", ["release_id", "lesson_id"], ["release_id", "id"]],
  ])(
    "cascades deletion from %s to its staged %s rows",
    async (childTable, parentTable, fromColumns, toColumns) => {
      await migrateDatabase(driver);

      const foreignKeys = await driver.all<ForeignKeyRow>(
        `PRAGMA foreign_key_list(${childTable})`,
      );
      const relationship = foreignKeys
        .filter((foreignKey) => foreignKey.table === parentTable)
        .sort((left, right) => left.seq - right.seq);

      expect(relationship.map(({ from }) => from)).toEqual(fromColumns);
      expect(relationship.map(({ to }) => to)).toEqual(toColumns);
      expect(relationship.map(({ on_delete }) => on_delete)).toEqual(
        fromColumns.map(() => "CASCADE"),
      );
    },
  );

  test("partitions progress and synchronization records by profile", async () => {
    await migrateDatabase(driver);

    await driver.run(
      "INSERT INTO learner_profiles (id, kind, created_at, last_used_at) VALUES (?, ?, ?, ?)",
      ["profile-1", "anonymous", "2026-08-03T00:00:00Z", "2026-08-03T00:00:00Z"],
    );
    await driver.run(
      "INSERT INTO lesson_progress (profile_id, lesson_id, completed, server_revision, locally_modified_at) VALUES (?, ?, ?, ?, ?)",
      ["profile-1", "lesson-1", 1, 0, "2026-08-03T00:00:00Z"],
    );
    await driver.run(
      "INSERT INTO sync_outbox (profile_id, mutation_id, entity_type, entity_id, operation, payload_json, base_revision, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        "profile-1",
        "mutation-1",
        "lesson_progress",
        "lesson-1",
        "upsert",
        "{}",
        0,
        0,
        "2026-08-03T00:00:00Z",
      ],
    );
    await driver.run(
      "INSERT INTO sync_state (profile_id, resource, pull_cursor) VALUES (?, ?, ?)",
      ["profile-1", "lesson_progress", "cursor-1"],
    );

    await expect(
      driver.run(
        "INSERT INTO lesson_progress (profile_id, lesson_id, completed, server_revision, locally_modified_at) VALUES (?, ?, ?, ?, ?)",
        ["profile-1", "lesson-1", 0, 0, "2026-08-03T00:00:01Z"],
      ),
    ).rejects.toThrow();
    expect(await driver.first<{ merged_at: string | null }>("SELECT merged_at FROM sync_outbox")).toEqual(
      { merged_at: null },
    );
  });

  test("enforces learner profile kinds and keeps the merge self-reference nullable", async () => {
    await migrateDatabase(driver);

    await expect(
      driver.run(
        "INSERT INTO learner_profiles (id, kind, created_at, last_used_at) VALUES (?, ?, ?, ?)",
        ["profile-1", "guest", "2026-08-03T00:00:00Z", "2026-08-03T00:00:00Z"],
      ),
    ).rejects.toThrow();

    await driver.run(
      "INSERT INTO learner_profiles (id, kind, created_at, last_used_at) VALUES (?, ?, ?, ?)",
      ["profile-1", "anonymous", "2026-08-03T00:00:00Z", "2026-08-03T00:00:00Z"],
    );
    expect(
      await driver.first<{ merged_into_profile_id: string | null }>(
        "SELECT merged_into_profile_id FROM learner_profiles WHERE id = ?",
        ["profile-1"],
      ),
    ).toEqual({ merged_into_profile_id: null });
  });

  test("creates query indexes for curriculum ordering and pending outbox time", async () => {
    await migrateDatabase(driver);

    const indexes = await driver.all<IndexRow>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
    );
    expect(indexes.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "idx_lessons_release_module_position",
        "idx_modules_release_position",
        "idx_sync_outbox_profile_pending_created_at",
      ]),
    );
  });

  test("rolls a migration back when its SQL fails", async () => {
    await driver.exec("CREATE TABLE modules (sentinel TEXT NOT NULL)");

    await expect(migrateDatabase(driver)).rejects.toThrow();
    expect(await driver.first<{ user_version: number }>("PRAGMA user_version")).toEqual({
      user_version: 0,
    });
    expect(
      await driver.first<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'content_releases'",
      ),
    ).toBeNull();
  });
});
