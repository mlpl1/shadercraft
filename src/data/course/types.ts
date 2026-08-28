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

export type TutorialChoice = {
  id: string;
  fragment: string;
};

/**
 * One multiple-choice tutorial step: sourceTemplate is a complete runnable body with exactly one
 * blank. Each answer choice supplies a fragment for that blank, and correctChoiceId selects the
 * fragment that derives the reference target, so the rendered target cannot drift from the answer.
 */
export type TutorialStep = {
  id: string;
  position: number;
  title: string;
  /** What to do, and why. Prose, not instructions to copy. */
  brief: string;
  /** Complete runnable shader body with exactly one `SHADERCRAFT_BLANK` marker. */
  sourceTemplate: string;
  /** Exactly four authored fragments the learner may choose from. */
  answerChoices: TutorialChoice[];
  /** The authored choice that renders the reference target. */
  correctChoiceId: string;
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
 * Each step checks the learner's authored choice against `correctChoiceId`, records completion
 * locally for the active profile, and keeps the target and learner renderings side by side.
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
