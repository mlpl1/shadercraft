import type { CourseLesson, CourseModule, CourseRelease } from "./types";

export interface CourseRepository {
  getActiveRelease(): Promise<CourseRelease>;
  getModules(): Promise<CourseModule[]>;
  getLesson(lessonId: string): Promise<CourseLesson | null>;
  getPublishedLessonIds(): Promise<string[]>;
  subscribe(listener: () => void): () => void;
}
