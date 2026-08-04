import * as Crypto from "expo-crypto";

import type { CourseRepository } from "../course/course-repository";
import type { DatabaseDriver } from "../database/driver";
import type { AppliedProgressResult, RemoteProgressChange } from "../sync/progress-remote";
import type {
  LearnerProfile,
  LearnerProfileRepository,
  ProgressMutation,
  ProgressRepository,
  ProgressSyncRepository,
} from "./progress-repository";

const LEGACY_IMPORT_METADATA_KEY = "legacy_progress_imported";

/**
 * Which learner profile the app is reading and writing. Persisted alongside `active_release_id` so
 * a relaunch resumes the same account rather than falling back to a guest profile.
 */
const ACTIVE_PROFILE_METADATA_KEY = "active_profile_id";

const PROFILE_COLUMNS = `id, kind, supabase_user_id, merged_into_profile_id`;

/**
 * The `sync_state` row lesson progress uses. That table is keyed by `(profile_id, resource)` so a
 * later synchronized entity (saved shaders, say) can carry its own cursor without disturbing this one.
 */
const PROGRESS_SYNC_RESOURCE = "lesson_progress";

/**
 * True for a profile holding anything that is not reconstructible — explicit progress rows or outbox
 * mutations. Correlated on `learner_profiles.id`, so it only composes into queries over that table.
 */
const PROFILE_HAS_LOCAL_STATE = `(
  EXISTS (SELECT 1 FROM lesson_progress WHERE lesson_progress.profile_id = learner_profiles.id)
  OR EXISTS (SELECT 1 FROM sync_outbox WHERE sync_outbox.profile_id = learner_profiles.id)
)`;

/**
 * How many `merged_into_profile_id` hops to follow before treating the chain as corrupt. Merges are
 * refused once a profile already has a target, so a real chain is one hop; this only stops a cycle
 * from spinning forever.
 */
const MAX_MERGE_CHAIN_HOPS = 8;

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
 * SQLite-backed implementation of {@link ProgressRepository}, {@link LearnerProfileRepository} and
 * {@link ProgressSyncRepository}. One class covers all three so profile switching, progress reads and
 * synchronization share a connection and an active-profile cache — a switch has to take effect for
 * the very next read, and a pulled change has to notify the screens reading the same rows.
 *
 * Also exposes two additional methods
 * (`hasImportedLegacyProgress`, `markLegacyProgressImported`) used exclusively by the legacy
 * AsyncStorage import in `./legacy-import`; those are intentionally left off the
 * `ProgressRepository` interface because no other consumer needs them. `importLegacyCompletions`,
 * by contrast, *is* on the interface, since any future `ProgressRepository` implementation would
 * need the same atomic bulk-write guarantee to support the same one-time import.
 */
export class SqliteProgressRepository
  implements ProgressRepository, LearnerProfileRepository, ProgressSyncRepository
{
  private readonly listeners = new Set<() => void>();
  private readonly generateId: () => string;
  private readonly now: () => string;
  private cachedProfile: LearnerProfile | null = null;
  private pendingProfile: Promise<LearnerProfile> | null = null;

  constructor(
    private readonly driver: DatabaseDriver,
    private readonly courseRepository: CourseRepository,
    options: SqliteProgressRepositoryOptions = {},
  ) {
    this.generateId = options.generateId ?? (() => Crypto.randomUUID());
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async getActiveProfile(): Promise<LearnerProfile> {
    return this.getOrCreateActiveProfile();
  }

  async getActiveProfileId(): Promise<string> {
    const profile = await this.getOrCreateActiveProfile();
    return profile.id;
  }

  async getProfileBySupabaseUserId(userId: string): Promise<LearnerProfile | null> {
    const row = await this.driver.first<LearnerProfileRow>(
      `SELECT ${PROFILE_COLUMNS} FROM learner_profiles WHERE supabase_user_id = ?`,
      [userId],
    );
    return row ? toLearnerProfile(row) : null;
  }

  async createAuthenticatedProfile(userId: string): Promise<LearnerProfile> {
    return this.driver.transaction(async () => {
      const existing = await this.driver.first<LearnerProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM learner_profiles WHERE supabase_user_id = ?`,
        [userId],
      );
      if (existing) {
        return toLearnerProfile(existing);
      }

      const id = this.generateId();
      const timestamp = this.now();
      await this.driver.run(
        `INSERT INTO learner_profiles
          (id, kind, supabase_user_id, merged_into_profile_id, created_at, last_used_at)
         VALUES (?, 'authenticated', ?, NULL, ?, ?)`,
        [id, userId, timestamp, timestamp],
      );

      return { id, kind: "authenticated", supabaseUserId: userId, mergedIntoProfileId: null };
    });
  }

  async activateEmptyAnonymousProfile(): Promise<LearnerProfile> {
    await this.settleProfileResolution();

    const profile = await this.driver.transaction(async () => {
      const reusable = await this.driver.first<LearnerProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM learner_profiles
         WHERE kind = 'anonymous'
           AND merged_into_profile_id IS NULL
           AND NOT ${PROFILE_HAS_LOCAL_STATE}
         ORDER BY created_at ASC, id ASC
         LIMIT 1`,
      );

      const activated = reusable ? toLearnerProfile(reusable) : await this.insertAnonymousProfile();
      await this.activateProfileRow(activated.id);
      return activated;
    });

    this.adoptActiveProfile(profile);
    return profile;
  }

  async setActiveProfile(profileId: string): Promise<void> {
    await this.settleProfileResolution();

    const profile = await this.driver.transaction(async () => {
      const row = await this.requireProfileRow(profileId);
      await this.activateProfileRow(profileId);
      return toLearnerProfile(row);
    });

    this.adoptActiveProfile(profile);
  }

  /**
   * See {@link LearnerProfileRepository.mergeAnonymousProfile}. Everything happens in one
   * transaction so a crash can only leave the merge entirely undone — never progress half-moved or
   * mutations duplicated — and the recorded merge target makes a repeat run a no-op.
   *
   * The collapsed "latest explicit state per lesson" is read from the source's `lesson_progress`
   * rows rather than replayed from its outbox, because those rows *are* that collapsed state and
   * they outlive the mutations that produced them. Replaying the outbox instead would silently drop
   * any lesson whose mutations had already been marked merged or acknowledged.
   */
  async mergeAnonymousProfile(sourceProfileId: string, targetProfileId: string): Promise<void> {
    const outcome = await this.driver.transaction<MergeOutcome>(async () => {
      const source = await this.requireProfileRow(sourceProfileId);
      const target = await this.requireProfileRow(targetProfileId);

      if (target.merged_into_profile_id !== null) {
        throw new Error(
          `Cannot merge into learner profile ${target.id}: it was itself merged into ` +
            `${target.merged_into_profile_id}`,
        );
      }
      if (source.id === target.id) {
        throw new Error(`Cannot merge learner profile ${source.id} into itself`);
      }
      if (source.kind !== "anonymous") {
        throw new Error(`Only an anonymous learner profile can be merged; ${source.id} is not`);
      }
      if (source.merged_into_profile_id !== null) {
        if (source.merged_into_profile_id === target.id) {
          return { merged: true, changedProgress: false };
        }
        throw new Error(
          `Learner profile ${source.id} was already merged into ${source.merged_into_profile_id}, ` +
            `so it cannot also be merged into ${target.id}`,
        );
      }

      // Nothing to claim, so leave the profile unmerged and reusable by the next sign-out rather
      // than burning one profile per sign-in.
      if (await this.isProfileEmpty(source.id)) {
        return { merged: false, changedProgress: false };
      }

      const explicitRows = await this.driver.all<{ lesson_id: string; completed: number }>(
        `SELECT lesson_id, completed FROM lesson_progress WHERE profile_id = ? ORDER BY lesson_id`,
        [sourceProfileId],
      );

      let anyChanged = false;
      for (const row of explicitRows) {
        const rowChanged = await this.upsertLessonCompletion(
          targetProfileId,
          row.lesson_id,
          row.completed === 1,
        );
        anyChanged = anyChanged || rowChanged;
      }

      await this.driver.run(
        `UPDATE sync_outbox SET merged_at = ? WHERE profile_id = ? AND merged_at IS NULL`,
        [this.now(), sourceProfileId],
      );
      await this.driver.run(`UPDATE learner_profiles SET merged_into_profile_id = ? WHERE id = ?`, [
        targetProfileId,
        sourceProfileId,
      ]);

      return { merged: true, changedProgress: anyChanged };
    });

    if (outcome.merged && this.cachedProfile?.id === sourceProfileId) {
      this.cachedProfile = { ...this.cachedProfile, mergedIntoProfileId: targetProfileId };
    }
    // Only notify when the merge changed progress the app is *currently* reading — i.e. the
    // target is the active profile. Right after a sign-in, the active profile is still the
    // source (whose visible progress did not change); that switch gets its own notification from
    // `adoptActiveProfile` once the caller activates the target.
    if (outcome.changedProgress && this.cachedProfile?.id === targetProfileId) {
      this.notifySubscribers();
    }
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

  /**
   * Satisfies both {@link ProgressRepository.getPendingMutations} (the active profile, for app code)
   * and {@link ProgressSyncRepository.getPendingMutations} (an explicit profile, for the sync engine).
   */
  async getPendingMutations(profileId?: string): Promise<ProgressMutation[]> {
    const targetProfileId = profileId ?? (await this.getActiveProfileId());
    const rows = await this.driver.all<MutationRow>(
      `SELECT profile_id, mutation_id, entity_id, base_revision, attempts, created_at, payload_json
       FROM sync_outbox
       WHERE profile_id = ? AND merged_at IS NULL
       ORDER BY created_at, mutation_id`,
      [targetProfileId],
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

  /**
   * See {@link ProgressSyncRepository.acknowledgeMutation}. Deleting the outbox row and stamping the
   * lesson's server revision share one transaction, so the row can never disappear without the
   * revision that replaces it being recorded.
   *
   * Two things are deliberately *not* written here. The lesson's `completed` value is left alone:
   * the acknowledged result restates what this mutation sent, while the row already holds the
   * learner's newest choice, which may be a later queued action. And the result's `changeId` never
   * touches the pull cursor — it belongs to one global sequence, so adopting it would skip every
   * other device's changes that landed between the current cursor and this one.
   *
   * Unlike {@link rebaseMutation} and {@link recordMutationFailure}, the lookup and delete below do
   * not filter on `merged_at IS NULL`. That is deliberate, not an oversight: a mutation can be marked
   * merged by {@link mergeAnonymousProfile} while it is still in flight to the server (mid-push), and
   * the server's eventual answer for it must still be settled here so the row does not leak forever —
   * `getPendingMutations` already excludes merged rows from ever being *sent* again, so filtering here
   * too would only stop them from ever being *cleaned up*.
   */
  async acknowledgeMutation(
    profileId: string,
    mutationId: string,
    result: AppliedProgressResult,
  ): Promise<void> {
    await this.driver.transaction(async () => {
      const row = await this.driver.first<{ entity_id: string }>(
        `SELECT entity_id FROM sync_outbox WHERE profile_id = ? AND mutation_id = ?`,
        [profileId, mutationId],
      );
      // Already settled by an earlier pass; replaying the acknowledgement changes nothing.
      if (!row) {
        return;
      }

      await this.driver.run(`DELETE FROM sync_outbox WHERE profile_id = ? AND mutation_id = ?`, [
        profileId,
        mutationId,
      ]);
      await this.driver.run(
        `UPDATE lesson_progress SET server_revision = ?, server_updated_at = ?
         WHERE profile_id = ? AND lesson_id = ? AND server_revision < ?`,
        [result.revision, this.now(), profileId, row.entity_id, result.revision],
      );
    });
  }

  /** See {@link ProgressSyncRepository.rebaseMutation}. One statement, so no transaction is needed. */
  async rebaseMutation(profileId: string, mutationId: string, revision: number): Promise<void> {
    await this.driver.run(
      `UPDATE sync_outbox SET base_revision = ?
       WHERE profile_id = ? AND mutation_id = ? AND merged_at IS NULL`,
      [revision, profileId, mutationId],
    );
  }

  /** See {@link ProgressSyncRepository.recordMutationFailure}. */
  async recordMutationFailure(profileId: string, mutationId: string, error: string): Promise<void> {
    await this.driver.run(
      `UPDATE sync_outbox SET attempts = attempts + 1, last_error = ?
       WHERE profile_id = ? AND mutation_id = ? AND merged_at IS NULL`,
      [error, profileId, mutationId],
    );
  }

  /** See {@link ProgressSyncRepository.applyRemoteChanges}. */
  async applyRemoteChanges(
    profileId: string,
    changes: readonly RemoteProgressChange[],
    cursor: number,
  ): Promise<number> {
    const outcome = await this.driver.transaction<ApplyRemoteChangesOutcome>(async () => {
      const pendingRows = await this.driver.all<{ entity_id: string }>(
        `SELECT DISTINCT entity_id FROM sync_outbox WHERE profile_id = ? AND merged_at IS NULL`,
        [profileId],
      );
      const lessonsWithPendingMutation = new Set(pendingRows.map((row) => row.entity_id));

      let appliedCount = 0;
      let anyChanged = false;
      for (const change of changes) {
        if (lessonsWithPendingMutation.has(change.lessonId)) {
          continue;
        }

        const existing = await this.driver.first<ProgressRow>(
          `SELECT completed, server_revision FROM lesson_progress
           WHERE profile_id = ? AND lesson_id = ?`,
          [profileId, change.lessonId],
        );
        // A revision this row already holds — typically this device's own accepted change coming
        // back — carries no new information, and an older one would move the row backwards.
        if (existing && existing.server_revision >= change.revision) {
          continue;
        }

        const completedValue = change.completed ? 1 : 0;
        const timestamp = this.now();
        await this.driver.run(
          `INSERT INTO lesson_progress
            (profile_id, lesson_id, completed, server_revision, locally_modified_at, server_updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(profile_id, lesson_id) DO UPDATE SET
             completed = excluded.completed,
             server_revision = excluded.server_revision,
             server_updated_at = excluded.server_updated_at`,
          [profileId, change.lessonId, completedValue, change.revision, timestamp, timestamp],
        );

        appliedCount += 1;
        // Compared against the *effective* previous state — a missing row reads as not completed —
        // so a first server row confirming "not completed" is not reported as a visible change.
        anyChanged = anyChanged || (existing?.completed === 1) !== change.completed;
      }

      await this.driver.run(
        `INSERT INTO sync_state (profile_id, resource, pull_cursor, last_success_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(profile_id, resource) DO UPDATE SET
           pull_cursor = excluded.pull_cursor,
           last_success_at = excluded.last_success_at`,
        [profileId, PROGRESS_SYNC_RESOURCE, String(cursor), this.now()],
      );

      return { appliedCount, anyChanged };
    });

    // Only the active profile's rows are on screen; see `mergeAnonymousProfile` for the same rule.
    if (outcome.anyChanged && this.cachedProfile?.id === profileId) {
      this.notifySubscribers();
    }
    return outcome.appliedCount;
  }

  /** See {@link ProgressSyncRepository.getPullCursor}. */
  async getPullCursor(profileId: string): Promise<number> {
    const row = await this.driver.first<{ pull_cursor: string | null }>(
      `SELECT pull_cursor FROM sync_state WHERE profile_id = ? AND resource = ?`,
      [profileId, PROGRESS_SYNC_RESOURCE],
    );
    if (!row?.pull_cursor) {
      return 0;
    }

    const cursor = Number(row.pull_cursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new Error(
        `Learner profile ${profileId} has a corrupt ${PROGRESS_SYNC_RESOURCE} pull cursor: ` +
          `${row.pull_cursor}`,
      );
    }
    return cursor;
  }

  /**
   * See {@link ProgressSyncRepository.recordSyncSuccess}. One statement: unlike
   * {@link applyRemoteChanges}, there is no batch of rows to commit alongside it, so no transaction
   * is needed. Deliberately leaves `pull_cursor` alone on an existing row rather than rewriting it
   * with the same value the caller already read — `cursor` is only used to seed a fresh row for a
   * profile that has pushed but never yet pulled.
   */
  async recordSyncSuccess(profileId: string, cursor: number): Promise<void> {
    await this.driver.run(
      `INSERT INTO sync_state (profile_id, resource, pull_cursor, last_success_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(profile_id, resource) DO UPDATE SET last_success_at = excluded.last_success_at`,
      [profileId, PROGRESS_SYNC_RESOURCE, String(cursor), this.now()],
    );
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

  /**
   * Resolves (creating if needed) the active learner profile, memoizing both the resolved value and
   * the in-flight promise. Caching only the resolved value would leave a window between the
   * synchronous cache check and the first `await` where two concurrent cold-cache callers both see
   * `cachedProfile === null` and both open a `driver.transaction`; neither `DatabaseDriver`
   * implementation supports nested transactions, so the second `BEGIN` throws. Caching the in-flight
   * promise means every concurrent caller awaits the same transaction.
   */
  private async getOrCreateActiveProfile(): Promise<LearnerProfile> {
    if (this.cachedProfile) {
      return this.cachedProfile;
    }

    if (!this.pendingProfile) {
      this.pendingProfile = this.driver
        .transaction(() => this.loadActiveProfile())
        .then((profile) => {
          // An activation that landed while this read was in flight is the newer answer.
          const active = this.cachedProfile ?? profile;
          this.cachedProfile = active;
          return active;
        })
        .finally(() => {
          this.pendingProfile = null;
        });
    }

    return this.pendingProfile;
  }

  /**
   * Reads the recorded active profile, or picks one when the device has no record yet — for instance
   * after upgrading from a build that predates the marker. Must run inside a transaction.
   *
   * A recorded profile that has since been merged is followed to its merge target: that is exactly
   * the state left behind if the process died between committing a merge and activating the account,
   * and resuming the guest profile there would show the learner an empty course.
   */
  private async loadActiveProfile(): Promise<LearnerProfile> {
    const marker = await this.driver.first<{ value: string }>(
      `SELECT value FROM app_metadata WHERE key = ?`,
      [ACTIVE_PROFILE_METADATA_KEY],
    );

    if (marker) {
      const recorded = await this.followMergeChain(marker.value);
      if (recorded) {
        if (recorded.id !== marker.value) {
          await this.writeActiveProfileMarker(recorded.id);
        }
        return recorded;
      }
    }

    const existing = await this.driver.first<LearnerProfileRow>(
      `SELECT ${PROFILE_COLUMNS} FROM learner_profiles
       WHERE kind = 'anonymous' AND merged_into_profile_id IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
    );

    const profile = existing ? toLearnerProfile(existing) : await this.insertAnonymousProfile();
    await this.writeActiveProfileMarker(profile.id);
    return profile;
  }

  /** Resolves `profileId` to the profile its progress now lives in, or `null` if it is gone. */
  private async followMergeChain(profileId: string): Promise<LearnerProfile | null> {
    let currentId = profileId;

    for (let hop = 0; hop <= MAX_MERGE_CHAIN_HOPS; hop += 1) {
      const row = await this.driver.first<LearnerProfileRow>(
        `SELECT ${PROFILE_COLUMNS} FROM learner_profiles WHERE id = ?`,
        [currentId],
      );
      if (!row) {
        return null;
      }
      if (row.merged_into_profile_id === null) {
        return toLearnerProfile(row);
      }
      currentId = row.merged_into_profile_id;
    }

    throw new Error(`Learner profile ${profileId} has a cyclic merge chain`);
  }

  /** Must run inside a transaction. */
  private async insertAnonymousProfile(): Promise<LearnerProfile> {
    const id = this.generateId();
    const timestamp = this.now();
    await this.driver.run(
      `INSERT INTO learner_profiles
        (id, kind, supabase_user_id, merged_into_profile_id, created_at, last_used_at)
       VALUES (?, 'anonymous', NULL, NULL, ?, ?)`,
      [id, timestamp, timestamp],
    );

    return { id, kind: "anonymous", supabaseUserId: null, mergedIntoProfileId: null };
  }

  /** Must run inside a transaction. */
  private async activateProfileRow(profileId: string): Promise<void> {
    await this.writeActiveProfileMarker(profileId);
    await this.driver.run(`UPDATE learner_profiles SET last_used_at = ? WHERE id = ?`, [
      this.now(),
      profileId,
    ]);
  }

  private async writeActiveProfileMarker(profileId: string): Promise<void> {
    await this.driver.run(
      `INSERT INTO app_metadata (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [ACTIVE_PROFILE_METADATA_KEY, profileId],
    );
  }

  private async requireProfileRow(profileId: string): Promise<LearnerProfileRow> {
    const row = await this.driver.first<LearnerProfileRow>(
      `SELECT ${PROFILE_COLUMNS} FROM learner_profiles WHERE id = ?`,
      [profileId],
    );
    if (!row) {
      throw new Error(`Unknown learner profile: ${profileId}`);
    }
    return row;
  }

  /** True only when the profile holds neither progress rows nor outbox mutations. */
  private async isProfileEmpty(profileId: string): Promise<boolean> {
    const row = await this.driver.first<{ is_empty: number }>(
      `SELECT NOT ${PROFILE_HAS_LOCAL_STATE} AS is_empty
       FROM learner_profiles WHERE id = ?`,
      [profileId],
    );
    return row?.is_empty === 1;
  }

  /**
   * Adopts an explicitly activated profile as the cached one, notifying subscribers when the switch
   * changes which progress the app reads.
   */
  private adoptActiveProfile(profile: LearnerProfile): void {
    const previousId = this.cachedProfile?.id;
    this.cachedProfile = profile;
    if (previousId !== profile.id) {
      this.notifySubscribers();
    }
  }

  /**
   * Waits out an in-flight {@link getOrCreateActiveProfile} so its late `cachedProfile` write cannot
   * clobber the profile an activation is about to install. Failures belong to that caller.
   */
  private async settleProfileResolution(): Promise<void> {
    if (this.pendingProfile) {
      await this.pendingProfile.catch(() => undefined);
    }
  }
}

type MergeOutcome = {
  /** Whether the source profile is now recorded as merged into the target. */
  merged: boolean;
  /** Whether any target progress row actually changed, and so whether subscribers must be told. */
  changedProgress: boolean;
};

type ApplyRemoteChangesOutcome = {
  /** How many changes were actually written — excludes those skipped, per {@link applyRemoteChanges}. */
  appliedCount: number;
  /** Whether any applied change altered visible completion, and so whether subscribers must be told. */
  anyChanged: boolean;
};

function toLearnerProfile(row: LearnerProfileRow): LearnerProfile {
  return {
    id: row.id,
    kind: row.kind,
    supabaseUserId: row.supabase_user_id,
    mergedIntoProfileId: row.merged_into_profile_id,
  };
}
