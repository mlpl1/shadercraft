import { LEGACY_PROGRESS_STORAGE_KEY, parseLegacyProgressState } from "../../lib/progress";
import type { SqliteProgressRepository } from "./sqlite-progress-repository";

/** The subset of AsyncStorage's API the legacy importer needs. */
export type LegacyProgressStorage = {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
};

/**
 * Imports the legacy `@shadercraft/progress/v1` AsyncStorage value into SQLite, following the
 * seven-step flow from `docs/superpowers/specs/2026-08-03-offline-curriculum-sync-design.md`
 * (schema migration is the caller's responsibility, performed before this runs):
 *
 * 2. Check the SQLite `legacy_progress_imported` marker.
 * 3. Read and validate the AsyncStorage value.
 * 4. Insert one explicit completed progress row per valid lesson ID under the active anonymous
 *    learner profile.
 * 5. Record the import marker, in the same SQLite transaction as step 4 (see
 *    `SqliteProgressRepository.importLegacyCompletions`).
 * 6. Read the inserted rows back and verify them.
 * 7. Remove the AsyncStorage value only after verification (or immediately, on a resumed import
 *    where the marker was already set by a prior run that crashed before this cleanup step).
 *
 * Unknown historical lesson IDs are still imported as rows; they simply never contribute to
 * `getCompletedLessonIds()` because that only returns published lesson IDs.
 */
export async function importLegacyProgress(
  storage: LegacyProgressStorage,
  repository: SqliteProgressRepository,
): Promise<void> {
  const alreadyImported = await repository.hasImportedLegacyProgress();

  if (alreadyImported) {
    await storage.removeItem(LEGACY_PROGRESS_STORAGE_KEY);
    return;
  }

  const rawValue = await storage.getItem(LEGACY_PROGRESS_STORAGE_KEY);
  const legacyState = parseLegacyProgressState(rawValue);
  const uniqueLessonIds = Array.from(new Set(legacyState?.completedLessonIds ?? []));

  await repository.importLegacyCompletions(uniqueLessonIds);

  const verifiedCompletions = await Promise.all(
    uniqueLessonIds.map((lessonId) => repository.isLessonCompleted(lessonId)),
  );

  if (!verifiedCompletions.every(Boolean)) {
    throw new Error("Legacy progress import verification failed; retaining AsyncStorage value");
  }

  await storage.removeItem(LEGACY_PROGRESS_STORAGE_KEY);
}
