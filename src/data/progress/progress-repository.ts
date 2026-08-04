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
   * is refused rather than silently moving progress between accounts.
   */
  mergeAnonymousProfile(sourceProfileId: string, targetProfileId: string): Promise<void>;
}

export interface ProgressRepository {
  getActiveProfileId(): Promise<string>;
  getCompletedLessonIds(): Promise<string[]>;
  isLessonCompleted(lessonId: string): Promise<boolean>;
  setLessonCompleted(lessonId: string, completed: boolean): Promise<void>;
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
