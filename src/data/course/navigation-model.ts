import {
  getModuleStatus,
  getProgressPercent,
  getPublishedLessonCount,
  isLessonUnlocked,
  isModuleUnlocked,
} from "./domain";
import type { CourseModule } from "./types";

export type NavigationModuleStatus = "available" | "in-progress" | "complete" | "locked" | "planned";

export type NavigationLessonViewModel = {
  id: string;
  title: string;
  position: number;
  isComplete: boolean;
  isUnlocked: boolean;
};

export type NavigationModuleViewModel = {
  id: string;
  position: number;
  title: string;
  description: string;
  status: NavigationModuleStatus;
  lessonCount: number;
  completedLessonCount: number;
  /** Index into `lessons` of the lesson to surface as "current" for this module, or -1 if none. */
  currentLessonIndex: number;
  topics: string[];
  lessons: NavigationLessonViewModel[];
};

export type FeaturedLessonViewModel = {
  id: string;
  title: string;
  modulePosition: number;
  lessonPosition: number;
  isComplete: boolean;
};

export type NavigationModel = {
  isHydrated: boolean;
  progressPercent: number;
  /** Total number of lessons across published (non-planned) modules. */
  publishedLessonCount: number;
  modules: NavigationModuleViewModel[];
  /** The module containing the featured lesson, or null before the course has hydrated. */
  featuredModule: NavigationModuleViewModel | null;
  /** The lesson to resume/start next across the whole course, or null before hydration. */
  featuredLesson: FeaturedLessonViewModel | null;
  /** Whether the first module (by position) is fully complete, used to gate bonus content. */
  isFirstModuleComplete: boolean;
};

function byPosition<T extends { position: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.position - right.position);
}

function buildModuleViewModel(
  module: CourseModule,
  completedLessonIds: readonly string[],
  isLocked: boolean,
): NavigationModuleViewModel {
  const orderedLessons = byPosition(module.lessons);
  const completed = new Set(completedLessonIds);

  const lessons: NavigationLessonViewModel[] = orderedLessons.map((lesson) => ({
    id: lesson.id,
    title: lesson.title,
    position: lesson.position,
    isComplete: completed.has(lesson.id),
    isUnlocked: isLessonUnlocked(lesson, orderedLessons, completedLessonIds),
  }));

  const isPlanned = module.status === "planned";
  const status: NavigationModuleStatus = isLocked
    ? "locked"
    : isPlanned
      ? "planned"
      : getModuleStatus(module, completedLessonIds);

  // Once every lesson is complete (or the module has none), `nextIncomplete` is -1 and there is
  // no "next" lesson to resume — fall back to the last lesson so the module still has a valid
  // lesson to surface as "current" (and the card renders a "Review lesson" tap target) instead of
  // going tap-dead. `lessons.length - 1` is itself -1 when there are no lessons at all, which is
  // the only case where -1 is still the correct answer.
  const nextIncomplete = lessons.findIndex((lesson) => lesson.isUnlocked && !lesson.isComplete);
  const currentLessonIndex = isPlanned && !isLocked
    ? 0
    : nextIncomplete >= 0
      ? nextIncomplete
      : lessons.length - 1;

  return {
    id: module.id,
    position: module.position,
    title: module.title,
    description: module.description,
    status,
    lessonCount: isPlanned ? module.plannedLessonCount : orderedLessons.length,
    completedLessonCount: lessons.filter((lesson) => lesson.isComplete).length,
    currentLessonIndex,
    topics: isPlanned ? module.plannedTopics : orderedLessons.map((lesson) => lesson.title),
    lessons,
  };
}

/** The statuses a learner can actually act on — every other module is a roadmap card, not a target. */
const OPENABLE_STATUSES: readonly NavigationModuleStatus[] = ["available", "in-progress", "complete"];

function selectFeatured(
  modules: readonly NavigationModuleViewModel[],
): { module: NavigationModuleViewModel; lesson: NavigationLessonViewModel } | null {
  // An allow-list, not `!== "planned"`. `buildModuleViewModel` gives "locked" precedence over
  // "planned", so a planned module that is also locked reports "locked" and slips through a
  // deny-list — and having no lessons, it then aborts the whole selection. That is what stranded
  // Home on "Loading curriculum…" once Module 1 was the only published module: modules 3+ were
  // planned *and* locked, so the first non-complete match was an empty module.
  //
  // Filtering positively also stops a locked published module being featured, which would offer
  // the learner a lesson they are not allowed to open yet.
  const openableModules = byPosition(
    modules.filter((module) => OPENABLE_STATUSES.includes(module.status)),
  );
  if (openableModules.length === 0) {
    return null;
  }

  const currentModule =
    openableModules.find((module) => module.status !== "complete") ??
    openableModules[openableModules.length - 1];

  const orderedLessons = byPosition(currentModule.lessons);
  if (orderedLessons.length === 0) {
    return null;
  }

  const currentLesson =
    orderedLessons.find((lesson) => lesson.isUnlocked && !lesson.isComplete) ??
    orderedLessons[orderedLessons.length - 1];

  return { module: currentModule, lesson: currentLesson };
}

/**
 * Builds the Home/Course presentation view model from repository-sourced modules, the set of
 * completed lesson IDs, and the course/progress hydration state. Pure: no React, no I/O. Module
 * unlock order (see `isModuleUnlocked` in `./domain`) is a domain rule; this selector only maps
 * the resulting lock state onto a display status. A planned module never becomes "complete" (it
 * has no real lessons); once unlocked it is labeled "planned" so it can preview its topic roadmap
 * without ever opening a lesson route.
 */
export function buildNavigationModel(
  modules: readonly CourseModule[],
  completedLessonIds: readonly string[],
  isHydrated: boolean,
): NavigationModel {
  const orderedModules = byPosition(modules);

  const moduleViewModels = orderedModules.map((module) => {
    const isLocked = !isModuleUnlocked(orderedModules, module.id, completedLessonIds);

    return buildModuleViewModel(module, completedLessonIds, isLocked);
  });

  const featured = selectFeatured(moduleViewModels);
  const progressPercent = getProgressPercent({ modules }, completedLessonIds);
  const publishedLessonCount = getPublishedLessonCount({ modules });

  return {
    isHydrated,
    progressPercent,
    publishedLessonCount,
    modules: moduleViewModels,
    featuredModule: featured?.module ?? null,
    featuredLesson: featured
      ? {
          id: featured.lesson.id,
          title: featured.lesson.title,
          modulePosition: featured.module.position,
          lessonPosition: featured.lesson.position,
          isComplete: featured.lesson.isComplete,
        }
      : null,
    isFirstModuleComplete: moduleViewModels[0]?.status === "complete",
  };
}
