import type { DatabaseDriver } from "./driver";

export type DatabaseMigration = {
  version: number;
  migrate(driver: DatabaseDriver): Promise<void>;
};

const CREATE_INITIAL_SCHEMA = `
  CREATE TABLE content_releases (
    id TEXT PRIMARY KEY NOT NULL,
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    minimum_app_version TEXT NOT NULL,
    checksum TEXT NOT NULL,
    published_at TEXT
  );

  CREATE TABLE modules (
    release_id TEXT NOT NULL,
    id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position > 0),
    status TEXT NOT NULL CHECK (status IN ('published', 'planned')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    planned_lesson_count INTEGER NOT NULL CHECK (planned_lesson_count >= 0),
    planned_topics_json TEXT NOT NULL,
    PRIMARY KEY (release_id, id),
    FOREIGN KEY (release_id) REFERENCES content_releases(id) ON DELETE CASCADE
  );

  CREATE TABLE lessons (
    release_id TEXT NOT NULL,
    id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position > 0),
    title TEXT NOT NULL,
    short_title TEXT NOT NULL,
    intro TEXT NOT NULL,
    takeaway TEXT NOT NULL,
    try_this TEXT,
    PRIMARY KEY (release_id, id),
    FOREIGN KEY (release_id, module_id)
      REFERENCES modules(release_id, id) ON DELETE CASCADE
  );

  CREATE TABLE lesson_stages (
    release_id TEXT NOT NULL,
    id TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position > 0),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (release_id, id),
    FOREIGN KEY (release_id, lesson_id)
      REFERENCES lessons(release_id, id) ON DELETE CASCADE
  );

  CREATE TABLE learner_profiles (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('anonymous', 'authenticated')),
    supabase_user_id TEXT UNIQUE,
    merged_into_profile_id TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL,
    CHECK (
      (kind = 'anonymous' AND supabase_user_id IS NULL)
      OR (kind = 'authenticated' AND supabase_user_id IS NOT NULL)
    ),
    FOREIGN KEY (merged_into_profile_id)
      REFERENCES learner_profiles(id) ON DELETE SET NULL
  );

  CREATE TABLE lesson_progress (
    profile_id TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    completed INTEGER NOT NULL CHECK (completed IN (0, 1)),
    server_revision INTEGER NOT NULL DEFAULT 0 CHECK (server_revision >= 0),
    locally_modified_at TEXT NOT NULL,
    server_updated_at TEXT,
    PRIMARY KEY (profile_id, lesson_id),
    FOREIGN KEY (profile_id) REFERENCES learner_profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE sync_outbox (
    profile_id TEXT NOT NULL,
    mutation_id TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    created_at TEXT NOT NULL,
    last_error TEXT,
    merged_at TEXT,
    PRIMARY KEY (profile_id, mutation_id),
    FOREIGN KEY (profile_id) REFERENCES learner_profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE sync_state (
    profile_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    pull_cursor TEXT,
    last_success_at TEXT,
    PRIMARY KEY (profile_id, resource),
    FOREIGN KEY (profile_id) REFERENCES learner_profiles(id) ON DELETE CASCADE
  );

  CREATE TABLE app_metadata (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );

  -- Learner-authored shader sketches. Partitioned by profile exactly as lesson_progress is, so
  -- switching accounts shows that account's work, and so cloud sync stays possible later without
  -- a second migration. Nothing enqueues sync_outbox rows for these: sketches are local-only, and
  -- queueing mutations no server accepts would trip the sync attention state.
  CREATE TABLE sketches (
    id TEXT PRIMARY KEY NOT NULL,
    profile_id TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (profile_id) REFERENCES learner_profiles(id) ON DELETE CASCADE
  );

  CREATE INDEX idx_modules_release_position
    ON modules(release_id, position);
  CREATE INDEX idx_lessons_release_module_position
    ON lessons(release_id, module_id, position);
  CREATE INDEX idx_lesson_stages_release_lesson_position
    ON lesson_stages(release_id, lesson_id, position);
  CREATE INDEX idx_sync_outbox_profile_pending_created_at
    ON sync_outbox(profile_id, created_at)
    WHERE merged_at IS NULL;
  CREATE INDEX idx_sketches_profile_updated_at
    ON sketches(profile_id, updated_at DESC);
`;

const migrations: readonly DatabaseMigration[] = [
  {
    version: 1,
    async migrate(driver) {
      await driver.exec(CREATE_INITIAL_SCHEMA);
    },
  },
  {
    // Optional GLSL declared above `mainImage`, for stages needing their own functions. Nullable
    // rather than defaulted to empty text, so "no helpers" stays one representation end to end
    // instead of splitting into NULL from old rows and '' from new ones.
    version: 2,
    async migrate(driver) {
      await driver.exec("ALTER TABLE lesson_stages ADD COLUMN helpers TEXT");
    },
  },
];

export const LATEST_SCHEMA_VERSION = migrations.at(-1)?.version ?? 0;

export function getPendingMigrations(currentVersion: number): readonly DatabaseMigration[] {
  if (!Number.isInteger(currentVersion) || currentVersion < 0) {
    throw new Error(`Invalid database schema version: ${currentVersion}`);
  }
  if (currentVersion > LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Database has newer schema version ${currentVersion}; this app supports ${LATEST_SCHEMA_VERSION}`,
    );
  }
  return migrations.filter(({ version }) => version > currentVersion);
}

export async function migrateDatabase(driver: DatabaseDriver): Promise<void> {
  await driver.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const versionRow = await driver.first<{ user_version: number }>("PRAGMA user_version");
  const currentVersion = versionRow?.user_version ?? 0;

  for (const migration of getPendingMigrations(currentVersion)) {
    await driver.transaction(async () => {
      await migration.migrate(driver);
      await driver.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }
}
