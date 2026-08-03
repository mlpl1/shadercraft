import * as Crypto from "expo-crypto";

import type { CourseRepository } from "../course/course-repository";
import type { DatabaseDriver } from "../database/driver";
import type { LearnerProfile, ProgressMutation, ProgressRepository } from "./progress-repository";

const LEGACY_IMPORT_METADATA_KEY = "legacy_progress_imported";

type LearnerProfileRow = {
  id: string;
  kind: LearnerProfile["kind"];
  supabase_user_id: string | null;
  merged_into_profile_id: string | null;
};

type ProgressRow = {
  completed: number;
  server_revision: number;
};

type CompletionRow = {
  completed: number;
};

type MutationRow = {
  profile_id: string;
  mutation_id: string;
  entity_id: string;
  payload_json: string;
  base_revision: number;
  attempts: number;
  created_at: string;
};

export type SqliteProgressRepositoryOptions = {
  /** Overridable for deterministic tests; defaults to `Crypto.randomUUID()`. */
  generateId?: () => string;
  /** Overridable for deterministic tests; defaults to the current ISO timestamp. */
  now?: () => string;
};

/**
 * SQLite-backed implementation of {@link ProgressRepository}. Also exposes two additional methods
 * (`hasImportedLegacyProgress`, `markLegacyProgressImported`) used exclusively by the legacy
 * AsyncStorage import in `./legacy-import`; those are intentionally left off the
 * `ProgressRepository` interface because no other consumer needs them. `importLegacyCompletions`,
 * by contrast, *is* on the interface, since any future `ProgressRepository` implementation would
 * need the same atomic bulk-write guarantee to support the same one-time import.
 */
export class SqliteProgressRepository implements ProgressRepository {
  private readonly listeners = new Set<() => void>();
  private readonly generateId: () => string;
  private readonly now: () => string;
  private cachedProfile: LearnerProfile | null = null;

  constructor(
    private readonly driver: DatabaseDriver,
    private readonly courseRepository: CourseRepository,
    options: SqliteProgressRepositoryOptions = {},
  ) {
    this.generateId = options.generateId ?? (() => Crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async getActiveProfileId(): Promise<string> {
    const profile = await this.getOrCreateActiveProfile();
    return profile.id;
  }

  async getCompletedLessonIds(): Promise<string[]> {
    const profileId = await this.getActiveProfileId();
    const completedRows = await this.driver.all<{ lesson_id: string }>(
      `SELECT lesson_id FROM lesson_progress WHERE profile_id = ? AND completed = 1`,
      [profileId],
    );
    const completedLessonIds = new Set(completedRows.map((row) => row.lesson_id));

    // Ordering and "is this a real lesson" both come from the course repository's published
    // lesson list, so unknown/retired IDs (e.g. from legacy import) are silently excluded here
    // even though their rows remain in `lesson_progress`.
    const publishedLessonIds = await this.courseRepository.getPublishedLessonIds();
    return publishedLessonIds.filter((lessonId) => completedLessonIds.has(lessonId));
  }

  async isLessonCompleted(lessonId: string): Promise<boolean> {
    const profileId = await this.getActiveProfileId();
    const row = await this.driver.first<CompletionRow>(
      `SELECT completed FROM lesson_progress WHERE profile_id = ? AND lesson_id = ?`,
      [profileId, lessonId],
    );
    return row?.completed === 1;
  }

  async setLessonCompleted(lessonId: string, completed: boolean): Promise<void> {
    const profileId = await this.getActiveProfileId();

    const didChange = await this.driver.transaction(() =>
      this.upsertLessonCompletion(profileId, lessonId, completed),
    );

    if (didChange) {
      this.notifySubscribers();
    }
  }

  /**
   * Atomically inserts one completed progress row (with its outbox mutation) per lesson ID and
   * records the `legacy_progress_imported` marker, all within a single transaction, so callers get
   * an all-or-nothing guarantee rather than one committed by each row's own transaction. See
   * `./legacy-import` for the caller and the design spec's seven-step import protocol.
   */
  async importLegacyCompletions(lessonIds: readonly string[]): Promise<void> {
    const profileId = await this.getActiveProfileId();

    const didChange = await this.driver.transaction(async () => {
      let anyChanged = false;
      for (const lessonId of lessonIds) {
        const rowChanged = await this.upsertLessonCompletion(profileId, lessonId, true);
        anyChanged = anyChanged || rowChanged;
      }

      await this.writeLegacyImportMarker();
      return anyChanged;
    });

    if (didChange) {
      this.notifySubscribers();
    }
  }

  /**
   * Inserts or updates the single `lesson_progress` row for `lessonId` and, only if the explicit
   * completion state actually changed, appends the matching `sync_outbox` mutation. Must be called
   * from within a `driver.transaction`; the driver implementations here do not support nesting
   * transactions, so callers that need this atomic with other writes (e.g.
   * `importLegacyCompletions`) share one transaction rather than opening their own per call.
   */
  private async upsertLessonCompletion(
    profileId: string,
    lessonId: string,
    completed: boolean,
  ): Promise<boolean> {
    const completedValue = completed ? 1 : 0;

    const existing = await this.driver.first<ProgressRow>(
      `SELECT completed, server_revision FROM lesson_progress
       WHERE profile_id = ? AND lesson_id = ?`,
      [profileId, lessonId],
    );

    if (existing?.completed === completedValue) {
      return false;
    }

    const timestamp = this.now();
    await this.driver.run(
      `INSERT INTO lesson_progress
        (profile_id, lesson_id, completed, server_revision, locally_modified_at, server_updated_at)
       VALUES (?, ?, ?, 0, ?, NULL)
       ON CONFLICT(profile_id, lesson_id) DO UPDATE SET
         completed = excluded.completed,
         locally_modified_at = excluded.locally_modified_at`,
      [profileId, lessonId, completedValue, timestamp],
    );

    await this.driver.run(
      `INSERT INTO sync_outbox
        (profile_id, mutation_id, entity_type, entity_id, operation, payload_json,
         base_revision, attempts, created_at, last_error, merged_at)
       VALUES (?, ?, 'lesson_progress', ?, 'upsert', ?, ?, 0, ?, NULL, NULL)`,
      [
        profileId,
        this.generateId(),
        lessonId,
        JSON.stringify({ lessonId, completed }),
        existing?.server_revision ?? 0,
        timestamp,
      ],
    );

    return true;
  }

  async getPendingMutations(): Promise<ProgressMutation[]> {
    const profileId = await this.getActiveProfileId();
    const rows = await this.driver.all<MutationRow>(
      `SELECT profile_id, mutation_id, entity_id, base_revision, attempts, created_at, payload_json
       FROM sync_outbox
       WHERE profile_id = ? AND merged_at IS NULL
       ORDER BY created_at, mutation_id`,
      [profileId],
    );

    return rows.map((row) => {
      const payload = JSON.parse(row.payload_json) as { completed: boolean };
      return {
        profileId: row.profile_id,
        mutationId: row.mutation_id,
        lessonId: row.entity_id,
        completed: payload.completed,
        baseRevision: row.base_revision,
        attempts: row.attempts,
        createdAt: row.created_at,
      };
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Used only by `importLegacyProgress`; not part of `ProgressRepository`. */
  async hasImportedLegacyProgress(): Promise<boolean> {
    const row = await this.driver.first<{ value: string }>(
      `SELECT value FROM app_metadata WHERE key = ?`,
      [LEGACY_IMPORT_METADATA_KEY],
    );
    return row !== null;
  }

  /** Used only by `importLegacyProgress`; not part of `ProgressRepository`. */
  async markLegacyProgressImported(): Promise<void> {
    await this.writeLegacyImportMarker();
  }

  /** Shared by `markLegacyProgressImported` and `importLegacyCompletions`. */
  private async writeLegacyImportMarker(): Promise<void> {
    await this.driver.run(
      `INSERT INTO app_metadata (key, value) VALUES (?, 'true')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [LEGACY_IMPORT_METADATA_KEY],
    );
  }

  private notifySubscribers(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private async getOrCreateActiveProfile(): Promise<LearnerProfile> {
    if (this.cachedProfile) {
      return this.cachedProfile;
    }

    return this.driver.transaction(async () => {
      const existing = await this.driver.first<LearnerProfileRow>(
        `SELECT id, kind, supabase_user_id, merged_into_profile_id FROM learner_profiles
         WHERE kind = 'anonymous' AND merged_into_profile_id IS NULL
         ORDER BY created_at ASC
         LIMIT 1`,
      );

      if (existing) {
        this.cachedProfile = toLearnerProfile(existing);
        return this.cachedProfile;
      }

      const id = this.generateId();
      const timestamp = this.now();
      await this.driver.run(
        `INSERT INTO learner_profiles
          (id, kind, supabase_user_id, merged_into_profile_id, created_at, last_used_at)
         VALUES (?, 'anonymous', NULL, NULL, ?, ?)`,
        [id, timestamp, timestamp],
      );

      this.cachedProfile = { id, kind: "anonymous", supabaseUserId: null, mergedIntoProfileId: null };
      return this.cachedProfile;
    });
  }
}

function toLearnerProfile(row: LearnerProfileRow): LearnerProfile {
  return {
    id: row.id,
    kind: row.kind,
    supabaseUserId: row.supabase_user_id,
    mergedIntoProfileId: row.merged_into_profile_id,
  };
}
