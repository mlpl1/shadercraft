import type { AppliedProgressResult, RemoteProgressChange } from "../sync/progress-remote";

export type LearnerProfile = {
  id: string;
  kind: "anonymous" | "authenticated";
  supabaseUserId: string | null;
  mergedIntoProfileId: string | null;
};

export type ProgressMutation = {
  profileId: string;
  mutationId: string;
  lessonId: string;
  completed: boolean;
  baseRevision: number;
  attempts: number;
  createdAt: string;
};

/**
 * Deciding *which* learner profile the app reads and writes, kept apart from
 * {@link ProgressRepository} because they have different consumers: screens read progress and never
 * touch profiles, while `src/data/auth/profile-service` does the opposite. One SQLite class
 * implements both, so an implementation is free to share a connection and a cache between them.
 */
export interface LearnerProfileRepository {
  /**
   * The learner profile every progress read and write is scoped to, creating the first anonymous
   * profile if the device has none yet.
   */
  getActiveProfile(): Promise<LearnerProfile>;
  /** The locally cached profile for a Supabase account, or `null` if this device has never seen it. */
  getProfileBySupabaseUserId(userId: string): Promise<LearnerProfile | null>;
  /** Creates the profile bound to `userId`, or reopens it if this device already cached one. */
  createAuthenticatedProfile(userId: string): Promise<LearnerProfile>;
  /**
   * Activates an anonymous profile holding no progress and no mutations — reusing one left behind by
   * an earlier sign-out when there is one, otherwise creating a new one. Never resurrects a profile
   * that still holds unclaimed guest progress, so signing out cannot show someone else's work.
   */
  activateEmptyAnonymousProfile(): Promise<LearnerProfile>;
  setActiveProfile(profileId: string): Promise<void>;
  /**
   * Moves the anonymous profile's explicit progress into `targetProfileId` in one transaction:
   * collapsing it to the latest explicit state per lesson, queueing fresh mutations under the target
   * (new IDs, the target's own base revisions), marking the source's mutations merged so they can
   * never upload or be re-imported, and recording the merge target on the source profile.
   *
   * Idempotent: repeating a merge that already happened changes nothing, and a source holding
   * nothing to claim is left unmerged and reusable. Merging a source into a second, different target
   * is refused rather than silently moving progress between accounts, and so is merging into a
   * target that has itself already been merged away — that profile is a dead end no active profile
   * can resolve to, so anything written there would be permanently invisible.
   */
  mergeAnonymousProfile(sourceProfileId: string, targetProfileId: string): Promise<void>;
}

/**
 * The local half of synchronization: everything `../sync/progress-sync-engine` needs to read and
 * settle one profile's outbox and pull cursor.
 *
 * Kept apart from {@link ProgressRepository} for the same reason as
 * {@link LearnerProfileRepository}: screens never call any of it, and every method here takes its
 * profile explicitly rather than resolving the active one, because a sync pass must keep writing to
 * the profile it started with even if the learner signs out mid-pass.
 *
 * Each method is one unit of work, and therefore at most one transaction. None of them may be
 * called from inside another transaction — see `../database/transaction-queue`.
 */
export interface ProgressSyncRepository {
  /** Unmerged outbox mutations for `profileId`, oldest first. Creation order is upload order. */
  getPendingMutations(profileId: string): Promise<ProgressMutation[]>;
  /**
   * Records that the server accepted `mutationId`: drops the outbox row and stamps the resulting
   * server revision on the lesson. The only place an outbox row is ever removed.
   */
  acknowledgeMutation(
    profileId: string,
    mutationId: string,
    result: AppliedProgressResult,
  ): Promise<void>;
  /** Repoints a still-queued mutation at a newer server revision, keeping its mutation ID. */
  rebaseMutation(profileId: string, mutationId: string, revision: number): Promise<void>;
  /**
   * Counts one failed delivery attempt against a mutation and stores why, so repeated failure is
   * durable enough to surface as a non-blocking attention state. Never deletes the row.
   */
  recordMutationFailure(profileId: string, mutationId: string, error: string): Promise<void>;
  /**
   * Applies one batch of server changes and advances the pull cursor to `cursor` in a single
   * transaction, so a crash can never leave the cursor ahead of the rows it accounts for.
   *
   * A lesson that still has a pending local mutation is left alone: that mutation is about to be
   * pushed and become authoritative, so the server's older value must not overwrite it. So is a
   * lesson already at or ahead of the incoming revision.
   */
  applyRemoteChanges(
    profileId: string,
    changes: readonly RemoteProgressChange[],
    cursor: number,
  ): Promise<void>;
  /** The last change ID this profile has applied, or `0` when it has never pulled. */
  getPullCursor(profileId: string): Promise<number>;
}

export interface ProgressRepository {
  getActiveProfileId(): Promise<string>;
  getCompletedLessonIds(): Promise<string[]>;
  isLessonCompleted(lessonId: string): Promise<boolean>;
  setLessonCompleted(lessonId: string, completed: boolean): Promise<void>;
  /** Unmerged outbox mutations for the active profile, oldest first. */
  getPendingMutations(): Promise<ProgressMutation[]>;
  /**
   * Atomically inserts one completed progress row (and its outbox mutation) per given lesson ID
   * under the active learner profile, and records that the one-time legacy AsyncStorage import has
   * run — all within a single underlying transaction. Used by `./legacy-import` to satisfy the
   * design spec's requirement that the per-lesson rows and the import marker commit together.
   */
  importLegacyCompletions(lessonIds: readonly string[]): Promise<void>;
  subscribe(listener: () => void): () => void;
}
