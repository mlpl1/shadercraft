import {
  importLegacyProgress,
  LEGACY_PROGRESS_STORAGE_KEY,
  type LegacyProgressStorage,
} from "../legacy-import";
import type { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import type { SqliteProgressRepository } from "../sqlite-progress-repository";
import { createProgressRepositoryTestContext } from "./progress-repository-test-context";

const LEGACY_STORAGE_KEY = LEGACY_PROGRESS_STORAGE_KEY;

function createStorage(value: string | null): LegacyProgressStorage {
  return {
    getItem: jest.fn().mockResolvedValue(value),
    removeItem: jest.fn().mockResolvedValue(undefined),
  };
}

describe("importLegacyProgress", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteProgressRepository;

  beforeEach(async () => {
    ({ driver, repository } = await createProgressRepositoryTestContext());
  });

  afterEach(async () => {
    await driver.close();
  });

  test("imports valid legacy completions and removes the AsyncStorage entry", async () => {
    // The bundled release currently authors only one published lesson, so this only exercises a
    // single completion; the multi-row upsert path is covered elsewhere with a fabricated release.
    const storage = createStorage(
      JSON.stringify({
        version: 1,
        completedLessonIds: ["what-a-fragment-shader-is"],
      }),
    );

    await importLegacyProgress(storage, repository);

    expect(await repository.getCompletedLessonIds()).toEqual(["what-a-fragment-shader-is"]);
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
  });

  test("treats malformed legacy JSON as empty, still clears storage, and warns about the discarded value", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const storage = createStorage("{not valid json");

      await importLegacyProgress(storage, repository);

      expect(await repository.getCompletedLessonIds()).toEqual([]);
      expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
      // The non-empty malformed value is discarded irreversibly with no salvage attempt (matching
      // `main`'s `isProgressState` semantics exactly) — this is the only record of that loss.
      expect(warnSpy).toHaveBeenCalledWith(
        "Shadercraft: discarding malformed legacy progress value",
        "{not valid json",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("treats an empty-string legacy value as absent, clears storage, and does not warn", async () => {
    // An empty string is falsy, so it fails the same `if (!rawValue)` check as a missing key in
    // `parseLegacyProgressState` and yields `legacyState === null` — but it never went through the
    // JSON-parse-failure path, so it is not "malformed" and should not be reported as if real
    // historical data were discarded.
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const storage = createStorage("");

      await importLegacyProgress(storage, repository);

      expect(await repository.getCompletedLessonIds()).toEqual([]);
      expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("deduplicates repeated legacy lesson IDs into a single completion", async () => {
    const storage = createStorage(
      JSON.stringify({
        version: 1,
        completedLessonIds: ["color-mixing", "color-mixing"],
      }),
    );

    await importLegacyProgress(storage, repository);

    expect(await repository.isLessonCompleted("color-mixing")).toBe(true);
    expect(await repository.getPendingMutations()).toHaveLength(1);
  });

  test("retains rows for unknown historical lesson IDs but excludes them from visible totals", async () => {
    const storage = createStorage(
      JSON.stringify({
        version: 1,
        completedLessonIds: ["retired-legacy-lesson", "what-a-fragment-shader-is"],
      }),
    );

    await importLegacyProgress(storage, repository);

    expect(await repository.getCompletedLessonIds()).toEqual(["what-a-fragment-shader-is"]);
    expect(await repository.isLessonCompleted("retired-legacy-lesson")).toBe(true);
  });

  test("resumes cleanup without reinserting rows when the marker is already set", async () => {
    await repository.setLessonCompleted("what-a-fragment-shader-is", true);
    await repository.markLegacyProgressImported();

    // `importLegacyProgress` never calls `setLessonCompleted` (it writes rows through
    // `importLegacyCompletions`), so spying on `setLessonCompleted` here would pass regardless of
    // whether the marker short-circuit actually works. Spy on the method the early return in
    // `legacy-import.ts` is meant to skip.
    const importLegacyCompletionsSpy = jest.spyOn(repository, "importLegacyCompletions");

    const storage = createStorage(
      JSON.stringify({
        version: 1,
        completedLessonIds: ["what-a-fragment-shader-is"],
      }),
    );

    await importLegacyProgress(storage, repository);

    expect(importLegacyCompletionsSpy).not.toHaveBeenCalled();
    expect(await repository.getCompletedLessonIds()).toEqual(["what-a-fragment-shader-is"]);
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
  });

  test("running the import twice against real storage and the real repository does not resurrect a lesson the learner has since uncompleted", async () => {
    // The only end-to-end coverage of the restart path for a one-time, irreversible migration.
    // `storage` never actually loses its value across calls (see `createStorage`), which models
    // exactly the scenario the marker guards against: the app crashed after step 5 (marker
    // written) but before step 7 (AsyncStorage cleared), so the legacy value is still present on
    // restart. Re-running `importLegacyCompletions` against the same lesson IDs is otherwise a
    // silent no-op (the per-row upsert already skips unchanged rows) — the one thing that *would*
    // observably differ is a lesson the learner explicitly un-completed in between: without the
    // marker short-circuit, the resumed import would unconditionally re-mark it completed and
    // clobber that action. Asserting only "no additional rows" (as an earlier draft of this test
    // did) can't fail, because the upsert's own idempotency already guarantees that regardless of
    // the marker; this asserts the one outcome that actually depends on the guard.
    const storage = createStorage(
      JSON.stringify({
        version: 1,
        completedLessonIds: ["what-a-fragment-shader-is"],
      }),
    );

    await importLegacyProgress(storage, repository);
    expect(await repository.getCompletedLessonIds()).toEqual(["what-a-fragment-shader-is"]);

    await repository.setLessonCompleted("what-a-fragment-shader-is", false);
    const pendingMutationsBeforeSecondRun = await repository.getPendingMutations();

    await importLegacyProgress(storage, repository);

    expect(await repository.isLessonCompleted("what-a-fragment-shader-is")).toBe(false);
    expect(await repository.getPendingMutations()).toEqual(pendingMutationsBeforeSecondRun);
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
  });
});
