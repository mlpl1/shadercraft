import AsyncStorage from "@react-native-async-storage/async-storage";
import { TOTAL_LESSON_COUNT } from "./curriculum";

export { COORDINATE_SYSTEMS_LESSON_ID } from "./curriculum";

const STORAGE_KEY = "@shadercraft/progress/v1";

export type ProgressState = {
  completedLessonIds: string[];
  version: 1;
};

export const EMPTY_PROGRESS: ProgressState = {
  completedLessonIds: [],
  version: 1,
};

function isProgressState(value: unknown): value is ProgressState {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<ProgressState>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.completedLessonIds) &&
    candidate.completedLessonIds.every((lessonId) => typeof lessonId === "string")
  );
}

export async function loadProgress(): Promise<ProgressState> {
  try {
    const storedProgress = await AsyncStorage.getItem(STORAGE_KEY);
    if (!storedProgress) return EMPTY_PROGRESS;

    const parsedProgress: unknown = JSON.parse(storedProgress);
    return isProgressState(parsedProgress) ? parsedProgress : EMPTY_PROGRESS;
  } catch (error) {
    console.warn("Unable to load Shadercraft progress", error);
    return EMPTY_PROGRESS;
  }
}

export async function saveProgress(progress: ProgressState) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function hasCompletedLesson(progress: ProgressState, lessonId: string) {
  return progress.completedLessonIds.includes(lessonId);
}

export function getProgressPercent(progress: ProgressState) {
  return Math.round((progress.completedLessonIds.length / TOTAL_LESSON_COUNT) * 100);
}
