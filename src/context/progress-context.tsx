import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { getProgressPercent } from "../data/course/domain";
import { useCourse } from "./course-context";
import { useData } from "./data-context";

export type ProgressState = {
  completedLessonIds: string[];
  version: 1;
};

type ProgressContextValue = {
  completeLesson: (lessonId: string) => Promise<void>;
  hasCompletedLesson: (lessonId: string) => boolean;
  isHydrated: boolean;
  progress: ProgressState;
  progressPercent: number;
  uncompleteLesson: (lessonId: string) => Promise<void>;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

/**
 * Loads explicit lesson completions from the progress repository and keeps them fresh whenever
 * either the progress repository (a completion changed) or the course repository (the active
 * release changed, so which lesson IDs count toward the total changed) reports an invalidation.
 * The progress percentage is always computed against the active release's published lesson IDs, so
 * a curriculum activation refreshes totals immediately.
 */
export function ProgressProvider({ children }: PropsWithChildren) {
  const data = useData();
  const courseRepository = data.status === "ready" ? data.courseRepository : null;
  const progressRepository = data.status === "ready" ? data.progressRepository : null;
  const { activeRelease } = useCourse();

  const [completedLessonIds, setCompletedLessonIds] = useState<string[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);

  const refresh = useCallback(async () => {
    if (!progressRepository) return;

    const nextCompletedLessonIds = await progressRepository.getCompletedLessonIds();
    setCompletedLessonIds(nextCompletedLessonIds);
    setIsHydrated(true);
  }, [progressRepository]);

  useEffect(() => {
    if (!progressRepository || !courseRepository) return;

    let isMounted = true;
    void refresh();

    const unsubscribeProgress = progressRepository.subscribe(() => {
      if (isMounted) {
        void refresh();
      }
    });
    const unsubscribeCourse = courseRepository.subscribe(() => {
      if (isMounted) {
        void refresh();
      }
    });

    return () => {
      isMounted = false;
      unsubscribeProgress();
      unsubscribeCourse();
    };
  }, [progressRepository, courseRepository, refresh]);

  const hasCompletedLesson = useCallback(
    (lessonId: string) => completedLessonIds.includes(lessonId),
    [completedLessonIds],
  );

  const setLessonCompletion = useCallback(
    async (lessonId: string, completed: boolean) => {
      if (!progressRepository) return;
      if (completedLessonIds.includes(lessonId) === completed) return;

      const previousCompletedLessonIds = completedLessonIds;
      const nextCompletedLessonIds = completed
        ? [...previousCompletedLessonIds, lessonId]
        : previousCompletedLessonIds.filter(
            (completedLessonId) => completedLessonId !== lessonId,
          );

      setCompletedLessonIds(nextCompletedLessonIds);

      try {
        await progressRepository.setLessonCompleted(lessonId, completed);
      } catch (error) {
        setCompletedLessonIds(previousCompletedLessonIds);
        throw error;
      }
    },
    [completedLessonIds, progressRepository],
  );

  const completeLesson = useCallback(
    (lessonId: string) => setLessonCompletion(lessonId, true),
    [setLessonCompletion],
  );

  const uncompleteLesson = useCallback(
    (lessonId: string) => setLessonCompletion(lessonId, false),
    [setLessonCompletion],
  );

  const progress = useMemo<ProgressState>(
    () => ({ completedLessonIds, version: 1 }),
    [completedLessonIds],
  );

  const progressPercent = useMemo(
    () => (activeRelease ? getProgressPercent(activeRelease, completedLessonIds) : 0),
    [activeRelease, completedLessonIds],
  );

  const value = useMemo<ProgressContextValue>(
    () => ({
      completeLesson,
      hasCompletedLesson,
      isHydrated,
      progress,
      progressPercent,
      uncompleteLesson,
    }),
    [completeLesson, hasCompletedLesson, isHydrated, progress, progressPercent, uncompleteLesson],
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress() {
  const progressContext = useContext(ProgressContext);
  if (!progressContext) {
    throw new Error("useProgress must be used inside ProgressProvider");
  }

  return progressContext;
}
