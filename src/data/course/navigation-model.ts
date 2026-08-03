import { getModuleStatus, getProgressPercent, isLessonUnlocked } from "./domain";
import type { CourseModule, CourseRelease } from "./types";

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

  const currentLessonIndex = isPlanned && !isLocked
    ? 0
    : lessons.findIndex((lesson) => lesson.isUnlocked && !lesson.isComplete);

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

function selectFeatured(
  modules: readonly NavigationModuleViewModel[],
): { module: NavigationModuleViewModel; lesson: NavigationLessonViewModel } | null {
  const publishedModules = byPosition(modules.filter((module) => module.status !== "planned"));
  if (publishedModules.length === 0) {
    return null;
  }

  const currentModule =
    publishedModules.find((module) => module.status !== "complete") ??
    publishedModules[publishedModules.length - 1];

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
 * completed lesson IDs, and the course/progress hydration state. Pure: no React, no I/O. Every
 * module — published or planned — unlocks sequentially by position once the previous module is
 * complete. A planned module never becomes "complete" (it has no real lessons); once unlocked it
 * is labeled "planned" so it can preview its topic roadmap without ever opening a lesson route.
 */
export function buildNavigationModel(
  modules: readonly CourseModule[],
  completedLessonIds: readonly string[],
  isHydrated: boolean,
): NavigationModel {
  const orderedModules = byPosition(modules);

  let previousModuleComplete = true;
  const moduleViewModels = orderedModules.map((module) => {
    const isLocked = !previousModuleComplete;
    const viewModel = buildModuleViewModel(module, completedLessonIds, isLocked);

    previousModuleComplete = viewModel.status === "complete";

    return viewModel;
  });

  const featured = selectFeatured(moduleViewModels);
  const progressPercent = getProgressPercent({ modules } as CourseRelease, completedLessonIds);

  return {
    isHydrated,
    progressPercent,
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
