import type { CourseLesson, CourseModule } from "./types";

export type CourseModuleProgressStatus =
  | "available"
  | "in-progress"
  | "complete"
  | "planned";

/** Anything shaped like a release's module list — accepts a full `CourseRelease` or a bare list. */
type ModuleSource = { modules: readonly CourseModule[] };

function getPublishedLessonIds(release: ModuleSource): string[] {
  return release.modules
    .filter(({ status }) => status === "published")
    .flatMap(({ lessons }) => lessons.map(({ id }) => id));
}

export function getPublishedLessonCount(release: ModuleSource): number {
  return getPublishedLessonIds(release).length;
}

export function getModuleStatus(
  module: CourseModule,
  completedLessonIds: readonly string[],
): CourseModuleProgressStatus {
  if (module.status === "planned") {
    return "planned";
  }

  const completed = new Set(completedLessonIds);
  const completedInModule = module.lessons.filter(({ id }) => completed.has(id)).length;

  if (completedInModule === module.lessons.length) {
    return "complete";
  }
  return completedInModule > 0 ? "in-progress" : "available";
}

export function isLessonUnlocked(
  lesson: CourseLesson,
  moduleLessons: readonly CourseLesson[],
  completedLessonIds: readonly string[],
): boolean {
  const orderedLessons = [...moduleLessons].sort(
    (left, right) => left.position - right.position,
  );
  const lessonIndex = orderedLessons.findIndex(({ id }) => id === lesson.id);

  if (lessonIndex < 0) {
    return false;
  }
  if (lessonIndex === 0) {
    return true;
  }
  return completedLessonIds.includes(orderedLessons[lessonIndex - 1].id);
}

/**
 * A module unlocks once every module ahead of it (by position) is complete. The first module (by
 * position) is always unlocked. A planned module never reports "complete" (see
 * `getModuleStatus`), so once the chain reaches one, every module after it stays locked.
 */
export function isModuleUnlocked(
  modules: readonly CourseModule[],
  moduleId: string,
  completedLessonIds: readonly string[],
): boolean {
  const orderedModules = [...modules].sort((left, right) => left.position - right.position);
  const moduleIndex = orderedModules.findIndex(({ id }) => id === moduleId);

  if (moduleIndex < 0) {
    return false;
  }
  if (moduleIndex === 0) {
    return true;
  }

  return orderedModules
    .slice(0, moduleIndex)
    .every((module) => getModuleStatus(module, completedLessonIds) === "complete");
}

export function getProgressPercent(
  release: ModuleSource,
  completedLessonIds: readonly string[],
): number {
  const publishedLessonIds = getPublishedLessonIds(release);
  if (publishedLessonIds.length === 0) {
    return 0;
  }

  const completed = new Set(completedLessonIds);
  const completedPublishedCount = publishedLessonIds.filter((id) => completed.has(id)).length;
  return Math.round((completedPublishedCount / publishedLessonIds.length) * 100);
}
