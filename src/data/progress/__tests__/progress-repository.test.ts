import type { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import type { SqliteProgressRepository } from "../sqlite-progress-repository";
import { createProgressRepositoryTestContext } from "./progress-repository-test-context";

describe("SQLite progress repository", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteProgressRepository;

  beforeEach(async () => {
    ({ driver, repository } = await createProgressRepositoryTestContext());
  });

  afterEach(async () => {
    await driver.close();
  });

  test("creates the first anonymous profile when none exists and reuses it afterward", async () => {
    const profileId = await repository.getActiveProfileId();

    expect(profileId).toBe("test-id-1");
    await expect(repository.getActiveProfileId()).resolves.toBe(profileId);
  });

  test("completes and uncompletes a lesson, recording one mutation per explicit change", async () => {
    await repository.setLessonCompleted("color-mixing", true);
    expect(await repository.isLessonCompleted("color-mixing")).toBe(true);
    expect(await repository.getPendingMutations()).toHaveLength(1);

    await repository.setLessonCompleted("color-mixing", false);
    expect(await repository.isLessonCompleted("color-mixing")).toBe(false);
    expect(await repository.getPendingMutations()).toHaveLength(2);
  });

  test("does not record another mutation for a repeated identical explicit state", async () => {
    await repository.setLessonCompleted("color-mixing", true);
    await repository.setLessonCompleted("color-mixing", true);

    expect(await repository.isLessonCompleted("color-mixing")).toBe(true);
    expect(await repository.getPendingMutations()).toHaveLength(1);
  });

  test("reports a lesson without a progress row as not completed", async () => {
    expect(await repository.isLessonCompleted("color-mixing")).toBe(false);
  });

  test("returns completed lesson IDs in curriculum order regardless of completion order", async () => {
    await repository.setLessonCompleted("colors-fragment-output", true);
    await repository.setLessonCompleted("coordinate-systems-uv-space", true);

    await expect(repository.getCompletedLessonIds()).resolves.toEqual([
      "coordinate-systems-uv-space",
      "colors-fragment-output",
    ]);
  });

  test("keeps a row for an unpublished lesson ID but excludes it from completed totals", async () => {
    await repository.setLessonCompleted("retired-legacy-lesson", true);

    await expect(repository.getCompletedLessonIds()).resolves.toEqual([]);
    await expect(repository.isLessonCompleted("retired-legacy-lesson")).resolves.toBe(true);
  });

  test("notifies subscribers only when the explicit state actually changes", async () => {
    const listener = jest.fn();
    const unsubscribe = repository.subscribe(listener);

    await repository.setLessonCompleted("color-mixing", true);
    expect(listener).toHaveBeenCalledTimes(1);

    await repository.setLessonCompleted("color-mixing", true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await repository.setLessonCompleted("color-mixing", false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
