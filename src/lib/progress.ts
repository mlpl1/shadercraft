import AsyncStorage from "@react-native-async-storage/async-storage";
import { TOTAL_LESSON_COUNT } from "./curriculum";

/**
 * The single AsyncStorage key that held all learner progress before the SQLite migration.
 * `src/data/progress/legacy-import.ts` reads and clears this key exactly once; this file now
 * only exists to keep `src/context/progress-context.tsx` compiling until it is rewired to the
 * SQLite-backed progress repository, and to provide the legacy parsing helper the importer needs.
 */
export const LEGACY_PROGRESS_STORAGE_KEY = "@shadercraft/progress/v1";

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

/** Parses a raw legacy AsyncStorage value, returning `null` if it is missing or malformed. */
export function parseLegacyProgressState(rawValue: string | null): ProgressState | null {
  if (!rawValue) return null;

  try {
    const parsed: unknown = JSON.parse(rawValue);
    return isProgressState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadProgress(): Promise<ProgressState> {
  try {
    const storedProgress = await AsyncStorage.getItem(LEGACY_PROGRESS_STORAGE_KEY);
    return parseLegacyProgressState(storedProgress) ?? EMPTY_PROGRESS;
  } catch (error) {
    console.warn("Unable to load Shadercraft progress", error);
    return EMPTY_PROGRESS;
  }
}

export async function saveProgress(progress: ProgressState) {
  await AsyncStorage.setItem(LEGACY_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

export function hasCompletedLesson(progress: ProgressState, lessonId: string) {
  return progress.completedLessonIds.includes(lessonId);
}

export function getProgressPercent(progress: ProgressState) {
  return Math.round((progress.completedLessonIds.length / TOTAL_LESSON_COUNT) * 100);
}
