export type ModuleStatus = "published" | "planned";

/**
 * One step in a lesson's build-up. `source` is a complete, runnable `mainImage` body — not a
 * fragment and not a diff against the previous stage. That duplicates code between neighbouring
 * stages deliberately: it is what lets the sandbox compile any stage directly, lets a learner edit
 * one and see it run, and guarantees the code on screen is the code that renders.
 */
export type LessonStage = {
  id: string;
  position: number;
  title: string;
  body: string;
  source: string;
  /**
   * Optional GLSL spliced above `mainImage`, for stages whose shader needs to declare functions —
   * GLSL has no nested functions, and `source` is spliced inside `mainImage`. Absent on every stage
   * that does not, which is most of them.
   */
  helpers?: string;
};

export type CourseLesson = {
  id: string;
  moduleId: string;
  position: number;
  title: string;
  shortTitle: string;
  intro: string;
  takeaway: string;
  /** Optional invitation to experiment. No target, no solution, nothing checks it. */
  tryThis?: string;
  stages: LessonStage[];
};

export type CourseModule = {
  id: string;
  position: number;
  status: ModuleStatus;
  title: string;
  description: string;
  plannedLessonCount: number;
  plannedTopics: string[];
  lessons: CourseLesson[];
};

export type CourseRelease = {
  id: string;
  schemaVersion: 1;
  minimumAppVersion: string;
  checksum: string;
  modules: CourseModule[];
};
