import bundledCourse from "../../../../assets/course/bundled-course.json";

import type { DatabaseDriver } from "../../database/driver";
import { migrateDatabase } from "../../database/migrations";
import { installBundledRelease } from "../../database/seed";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import { SqliteCourseRepository } from "../../course/sqlite-course-repository";
import { SqliteProgressRepository } from "../sqlite-progress-repository";

export type ProgressRepositoryTestContext = {
  driver: NodeSqliteDriver;
  repository: SqliteProgressRepository;
  /**
   * Builds another repository over the same database — used to stand in for an app restart (a cold
   * in-memory cache) or to inject a driver that fails a chosen statement. Generated IDs continue the
   * same sequence as `repository`, so two instances never mint the same one.
   */
  createRepository(override?: DatabaseDriver): SqliteProgressRepository;
};

export type ProgressRepositoryTestContextOptions = {
  /**
   * Overrides the ascending `test-id-N` sequence. Worth setting when a test needs IDs that do *not*
   * sort in insertion order, the way production's random UUIDs do not.
   */
  generateId?: () => string;
  /** Overrides the frozen clock. */
  now?: () => string;
};

/**
 * Builds an in-memory SQLite driver seeded with the bundled course plus a
 * `SqliteProgressRepository` on top of it, with deterministic IDs/timestamps for assertions.
 * Shared by `progress-repository.test.ts`, `legacy-import.test.ts` and the profile-service tests;
 * callers are still responsible for closing `driver` (typically in an `afterEach`).
 */
export async function createProgressRepositoryTestContext(
  options: ProgressRepositoryTestContextOptions = {},
): Promise<ProgressRepositoryTestContext> {
  const driver = new NodeSqliteDriver(":memory:");
  await migrateDatabase(driver);
  await installBundledRelease(driver, bundledCourse);
  const courseRepository = new SqliteCourseRepository(driver);

  let nextId = 0;
  const createRepository = (override: DatabaseDriver = driver) =>
    new SqliteProgressRepository(override, courseRepository, {
      generateId: options.generateId ?? (() => `test-id-${++nextId}`),
      now: options.now ?? (() => "2026-08-03T00:00:00.000Z"),
    });

  return { driver, repository: createRepository(), createRepository };
}
