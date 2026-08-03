// `../legacy-import` imports `src/lib/progress.ts`, which imports the AsyncStorage native module
// at module scope for `loadProgress`/`saveProgress` (kept only so progress-context.tsx still
// compiles until Task 7). That native module isn't available under plain Jest, so it needs the
// package's own documented mock swapped in before anything requires it transitively.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import bundledCourse from "../../../../assets/course/bundled-course.json";

import { migrateDatabase } from "../../database/migrations";
import { installBundledRelease } from "../../database/seed";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import { SqliteCourseRepository } from "../../course/sqlite-course-repository";
import { importLegacyProgress, type LegacyProgressStorage } from "../legacy-import";
import { SqliteProgressRepository } from "../sqlite-progress-repository";

const LEGACY_STORAGE_KEY = "@shadercraft/progress/v1";

function createStorage(value: string | null): LegacyProgressStorage {
  return {
    getItem: jest.fn().mockResolvedValue(value),
    removeItem: jest.fn().mockResolvedValue(undefined),
  };
}

describe("importLegacyProgress", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteProgressRepository;
  let nextId: number;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(":memory:");
    await migrateDatabase(driver);
    await installBundledRelease(driver, bundledCourse);
    const courseRepository = new SqliteCourseRepository(driver);
    nextId = 0;
    repository = new SqliteProgressRepository(driver, courseRepository, {
      generateId: () => `test-id-${++nextId}`,
      now: () => "2026-08-03T00:00:00.000Z",
    });
  });

  afterEach(async () => {
    await driver.close();
  });

  test("imports valid legacy completions and removes the AsyncStorage entry", async () => {
    const storage = createStorage(
      JSON.stringify({
        version: 1,
        completedLessonIds: ["coordinate-systems-uv-space", "colors-fragment-output"],
      }),
    );

    await importLegacyProgress(storage, repository);

    expect(await repository.getCompletedLessonIds()).toEqual([
      "coordinate-systems-uv-space",
      "colors-fragment-output",
    ]);
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
  });

  test("treats malformed legacy JSON as empty and still clears storage", async () => {
    const storage = createStorage("{not valid json");

    await importLegacyProgress(storage, repository);

    expect(await repository.getCompletedLessonIds()).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
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
        completedLessonIds: ["retired-legacy-lesson", "coordinate-systems-uv-space"],
      }),
    );

    await importLegacyProgress(storage, repository);

    expect(await repository.getCompletedLessonIds()).toEqual(["coordinate-systems-uv-space"]);
    expect(await repository.isLessonCompleted("retired-legacy-lesson")).toBe(true);
  });

  test("resumes cleanup without reinserting rows when the marker is already set", async () => {
    await repository.setLessonCompleted("coordinate-systems-uv-space", true);
    await repository.setLessonCompleted("colors-fragment-output", true);
    await repository.markLegacyProgressImported();

    const setLessonCompletedSpy = jest.spyOn(repository, "setLessonCompleted");

    const storage = createStorage(
      JSON.stringify({
        version: 1,
        completedLessonIds: ["coordinate-systems-uv-space", "colors-fragment-output"],
      }),
    );

    await importLegacyProgress(storage, repository);

    expect(setLessonCompletedSpy).not.toHaveBeenCalled();
    expect(await repository.getCompletedLessonIds()).toEqual([
      "coordinate-systems-uv-space",
      "colors-fragment-output",
    ]);
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_STORAGE_KEY);
  });
});
