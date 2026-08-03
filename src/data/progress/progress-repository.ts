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
  subscribe(listener: () => void): () => void;
}
