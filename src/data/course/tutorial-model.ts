import { getModuleStatus } from "./domain";
import type { CourseModule, Tutorial } from "./types";

export type TutorialStatus = "locked" | "available" | "in-progress" | "complete";

export type TutorialViewModel = {
  id: string;
  moduleId: string;
  moduleTitle: string;
  modulePosition: number;
  title: string;
  summary: string;
  status: TutorialStatus;
  stepCount: number;
  completedStepCount: number;
  /** The step a learner should open: their first unfinished one, or the last if all are done. */
  resumeStepId: string;
};

export type TutorialsModel = {
  tutorials: TutorialViewModel[];
  /** The one Home offers. Null when nothing is unlocked yet. */
  featured: TutorialViewModel | null;
  unlockedCount: number;
};

/**
 * A tutorial unlocks when its own module is complete — not when the module is merely reachable.
 *
 * That is a deliberately later gate than a lesson's. Lessons gate on prior modules so a learner can
 * start module three having finished modules one and two; a tutorial gates on its *own* module,
 * because it exercises material that module teaches. Reaching a module is not the same as having
 * read it.
 */
export function isTutorialUnlocked(
  module: CourseModule,
  completedLessonIds: readonly string[],
): boolean {
  return getModuleStatus(module, completedLessonIds) === "complete";
}

function statusFor(
  unlocked: boolean,
  stepCount: number,
  completedStepCount: number,
): TutorialStatus {
  if (!unlocked) return "locked";
  if (completedStepCount === 0) return "available";
  return completedStepCount >= stepCount ? "complete" : "in-progress";
}

/**
 * The step to open. A learner returning to a half-finished tutorial wants the step they stopped on,
 * not the one they last completed — and one who finished it wants the last step rather than being
 * bounced back to the start.
 */
function resumeStepId(tutorial: Tutorial, completedStepIds: ReadonlySet<string>): string {
  const ordered = [...tutorial.steps].sort((left, right) => left.position - right.position);
  return (ordered.find((step) => !completedStepIds.has(step.id)) ?? ordered[ordered.length - 1]).id;
}

/**
 * Every tutorial in the release with its lock state and progress, ordered by their modules.
 *
 * `featured` deliberately prefers an unfinished tutorial over a finished one, and the earliest such
 * — a learner who has unlocked four and finished two should be offered the third, not the newest.
 * When every unlocked tutorial is complete it offers the last one rather than nothing, so Home has
 * something to point at instead of an empty slot.
 */
export function buildTutorialsModel(
  modules: readonly CourseModule[],
  completedLessonIds: readonly string[],
  completedStepIds: ReadonlySet<string>,
): TutorialsModel {
  const tutorials: TutorialViewModel[] = [];

  for (const module of [...modules].sort((left, right) => left.position - right.position)) {
    const unlocked = isTutorialUnlocked(module, completedLessonIds);

    for (const tutorial of [...(module.tutorials ?? [])].sort(
      (left, right) => left.position - right.position,
    )) {
      const completedStepCount = tutorial.steps.filter((step) =>
        completedStepIds.has(step.id),
      ).length;

      tutorials.push({
        id: tutorial.id,
        moduleId: module.id,
        moduleTitle: module.title,
        modulePosition: module.position,
        title: tutorial.title,
        summary: tutorial.summary,
        status: statusFor(unlocked, tutorial.steps.length, completedStepCount),
        stepCount: tutorial.steps.length,
        completedStepCount,
        resumeStepId: resumeStepId(tutorial, completedStepIds),
      });
    }
  }

  const unlocked = tutorials.filter((tutorial) => tutorial.status !== "locked");
  const featured =
    unlocked.find((tutorial) => tutorial.status !== "complete") ??
    unlocked[unlocked.length - 1] ??
    null;

  return { tutorials, featured, unlockedCount: unlocked.length };
}
