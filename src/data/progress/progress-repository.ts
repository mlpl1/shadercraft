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
