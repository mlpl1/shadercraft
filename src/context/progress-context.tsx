import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  EMPTY_PROGRESS,
  getProgressPercent,
  hasCompletedLesson,
  loadProgress,
  type ProgressState,
  saveProgress,
} from "../lib/progress";

type ProgressContextValue = {
  completeLesson: (lessonId: string) => Promise<void>;
  hasCompletedLesson: (lessonId: string) => boolean;
  isHydrated: boolean;
  progress: ProgressState;
  progressPercent: number;
};

const ProgressContext = createContext<ProgressContextValue | null>(null);

export function ProgressProvider({ children }: PropsWithChildren) {
  const [progress, setProgress] = useState(EMPTY_PROGRESS);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    let isMounted = true;

    loadProgress().then((storedProgress) => {
      if (!isMounted) return;
      setProgress(storedProgress);
      setIsHydrated(true);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const completeLesson = useCallback(
    async (lessonId: string) => {
      if (hasCompletedLesson(progress, lessonId)) return;

      const nextProgress: ProgressState = {
        ...progress,
        completedLessonIds: [...progress.completedLessonIds, lessonId],
      };

      setProgress(nextProgress);

      try {
        await saveProgress(nextProgress);
      } catch (error) {
        setProgress(progress);
        throw error;
      }
    },
    [progress],
  );

  const value = useMemo<ProgressContextValue>(
    () => ({
      completeLesson,
      hasCompletedLesson: (lessonId) => hasCompletedLesson(progress, lessonId),
      isHydrated,
      progress,
      progressPercent: getProgressPercent(progress),
    }),
    [completeLesson, isHydrated, progress],
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

