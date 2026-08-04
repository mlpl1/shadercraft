import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import type { CourseLesson, CourseModule, CourseRelease } from "../data/course/types";
import { useData } from "./data-context";

type CourseContextValue = {
  activeRelease: CourseRelease | null;
  error: Error | null;
  getLesson: (lessonId: string) => CourseLesson | null;
  isHydrated: boolean;
  modules: CourseModule[];
  retry: () => void;
};

const CourseContext = createContext<CourseContextValue | null>(null);

/**
 * Loads the active release's modules from the course repository, keeps them fresh whenever the
 * repository reports an invalidation (e.g. a newly activated release), and exposes a synchronous
 * `getLesson` lookup over the currently hydrated modules.
 *
 * `getActiveRelease()` re-runs full release validation on every read, so a rejection here is a
 * live failure mode, not just a startup concern. A rejection is caught and surfaced through
 * `error` rather than left to hang `isHydrated` forever — consumers can retry via `retry()`.
 */
export function CourseProvider({ children }: PropsWithChildren) {
  const data = useData();
  const courseRepository = data.status === "ready" ? data.courseRepository : null;

  const [modules, setModules] = useState<CourseModule[]>([]);
  const [activeRelease, setActiveRelease] = useState<CourseRelease | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!courseRepository) return;

    try {
      const [nextModules, nextActiveRelease] = await Promise.all([
        courseRepository.getModules(),
        courseRepository.getActiveRelease(),
      ]);

      setModules(nextModules);
      setActiveRelease(nextActiveRelease);
      setIsHydrated(true);
      setError(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError : new Error("Failed to load curriculum"),
      );
    }
  }, [courseRepository]);

  useEffect(() => {
    if (!courseRepository) return;

    let isMounted = true;
    void refresh();

    const unsubscribe = courseRepository.subscribe(() => {
      if (isMounted) {
        void refresh();
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [courseRepository, refresh]);

  const getLesson = useCallback(
    (lessonId: string): CourseLesson | null =>
      modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === lessonId) ?? null,
    [modules],
  );

  const retry = useCallback(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<CourseContextValue>(
    () => ({ activeRelease, error, getLesson, isHydrated, modules, retry }),
    [activeRelease, error, getLesson, isHydrated, modules, retry],
  );

  return <CourseContext.Provider value={value}>{children}</CourseContext.Provider>;
}

export function useCourse(): CourseContextValue {
  const courseContext = useContext(CourseContext);
  if (!courseContext) {
    throw new Error("useCourse must be used inside CourseProvider");
  }

  return courseContext;
}
