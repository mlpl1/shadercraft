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

/**
 * One step of a tutorial: something to build, the code to start from, and the code that does it.
 *
 * `solutionSource` is both the answer and the target the learner compares against — the same string
 * compiles the reference render beside their own, so the picture they are aiming at can never drift
 * from the code Reveal shows them.
 *
 * `starterSource` is what the editor is seeded with. It is a complete runnable body like every other
 * source in this app, so a learner who changes nothing still sees something render.
 */
export type TutorialStep = {
  id: string;
  position: number;
  title: string;
  /** What to do, and why. Prose, not instructions to copy. */
  brief: string;
  starterSource: string;
  solutionSource: string;
  /** Declared above `mainImage` for both renders, so target and attempt share the same functions. */
  helpers?: string;
  /** Shown on request, before the learner gives up and reveals the whole answer. */
  hint?: string;
};

/**
 * An exercise with a target, unlike a lesson, which asks nothing and grades nothing. Tutorials sit
 * behind the same gate as their module: a module's tutorial unlocks when that module is complete,
 * which is why they hang off a module rather than sitting in a flat list.
 *
 * Nothing here is checked automatically. The learner sees the target rendering beside their own and
 * decides when it matches — see `docs/data/tutorials.md`.
 */
export type Tutorial = {
  id: string;
  moduleId: string;
  position: number;
  title: string;
  summary: string;
  steps: TutorialStep[];
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
  /**
   * Absent on modules with no exercises yet, which is every planned module and may be a published
   * one. Empty and absent mean the same thing, so the schema rejects an explicit empty array to keep
   * one representation.
   */
  tutorials?: Tutorial[];
};

export type CourseRelease = {
  id: string;
  schemaVersion: 1;
  minimumAppVersion: string;
  checksum: string;
  modules: CourseModule[];
};
