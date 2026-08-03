import bundledCourse from "../../../../assets/course/bundled-course.json";

import { migrateDatabase } from "../../database/migrations";
import { installBundledRelease } from "../../database/seed";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import { SqliteCourseRepository } from "../../course/sqlite-course-repository";
import { SqliteProgressRepository } from "../sqlite-progress-repository";

export type ProgressRepositoryTestContext = {
  driver: NodeSqliteDriver;
  repository: SqliteProgressRepository;
};

/**
 * Builds an in-memory SQLite driver seeded with the bundled course plus a
 * `SqliteProgressRepository` on top of it, with deterministic IDs/timestamps for assertions.
 * Shared by `progress-repository.test.ts` and `legacy-import.test.ts`; callers are still
 * responsible for closing `driver` (typically in an `afterEach`).
 */
export async function createProgressRepositoryTestContext(): Promise<ProgressRepositoryTestContext> {
  const driver = new NodeSqliteDriver(":memory:");
  await migrateDatabase(driver);
  await installBundledRelease(driver, bundledCourse);
  const courseRepository = new SqliteCourseRepository(driver);

  let nextId = 0;
  const repository = new SqliteProgressRepository(driver, courseRepository, {
    generateId: () => `test-id-${++nextId}`,
    now: () => "2026-08-03T00:00:00.000Z",
  });

  return { driver, repository };
}
