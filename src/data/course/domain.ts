import type { CourseLesson, CourseModule, CourseRelease } from "./types";

export type CourseModuleProgressStatus =
  | "available"
  | "in-progress"
  | "complete"
  | "planned";

function getPublishedLessonIds(release: CourseRelease): string[] {
  return release.modules
    .filter(({ status }) => status === "published")
    .flatMap(({ lessons }) => lessons.map(({ id }) => id));
}

export function getPublishedLessonCount(release: CourseRelease): number {
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

export function getProgressPercent(
  release: CourseRelease,
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
