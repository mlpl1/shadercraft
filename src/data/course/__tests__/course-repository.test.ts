import bundledCourse from "../../../../assets/course/bundled-course.json";

import type { SqlValue } from "../../database/driver";
import { migrateDatabase } from "../../database/migrations";
import { installBundledRelease } from "../../database/seed";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import { parseCourseRelease } from "../schema";
import { SqliteCourseRepository } from "../sqlite-course-repository";
import type { CourseRelease } from "../types";

const release = parseCourseRelease(bundledCourse);

class FailingInstallDriver extends NodeSqliteDriver {
  override async run(sql: string, params: readonly SqlValue[] = []) {
    if (sql.includes("INSERT INTO lessons")) {
      throw new Error("injected lesson insert failure");
    }
    return super.run(sql, params);
  }
}

describe("SQLite course repository", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteCourseRepository;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(":memory:");
    await migrateDatabase(driver);
    await installBundledRelease(driver, bundledCourse);
    repository = new SqliteCourseRepository(driver);
  });

  afterEach(async () => {
    await driver.close();
  });

  test("returns the active release with exact ordered nested records", async () => {
    await expect(repository.getActiveRelease()).resolves.toEqual(release);
    await expect(repository.getModules()).resolves.toEqual(release.modules);
  });

  test("returns a requested lesson and its ordered children", async () => {
    const expectedLesson = release.modules
      .flatMap(({ lessons }) => lessons)
      .find(({ id }) => id === "what-a-fragment-shader-is");

    await expect(repository.getLesson("what-a-fragment-shader-is")).resolves.toEqual(
      expectedLesson,
    );
    await expect(repository.getLesson("what-a-fragment-shader-is")).resolves.toMatchObject({
      moduleId: "fragments-and-coordinates",
      stages: expect.any(Array),
    });
  });

  test("round-trips the authored stages of a lesson", async () => {
    const lesson = await repository.getLesson("what-a-fragment-shader-is");

    expect(lesson?.stages.map(({ title }) => title)).toEqual([
      "One colour, everywhere",
      "Where am I? Raw pixels",
      "Divide by the resolution",
      "Both axes at once",
    ]);
    expect(lesson?.stages[0].source).toContain("vec4(0.85");
  });

  test("round-trips the authored tryThis prompt", async () => {
    await expect(repository.getLesson("what-a-fragment-shader-is")).resolves.toMatchObject({
      tryThis: "Swap uv.x and uv.y in the last stage. Which two corners trade colours, and which two stay put?",
    });
  });

  test("round-trips an unauthored tryThis as absent rather than null", async () => {
    // No bundled lesson omits `tryThis`, so this writes a NULL `try_this` row directly to reach
    // the branch `sqlite-course-repository.ts`'s `toLesson` documents at its comment: an
    // unauthored prompt must come back as a missing key, not an explicit `null`, matching the
    // authored release shape `CourseLesson.tryThis?: string` allows.
    await driver.run("UPDATE lessons SET try_this = NULL WHERE release_id = ? AND id = ?", [
      release.id,
      "what-a-fragment-shader-is",
    ]);

    await expect(repository.getLesson("what-a-fragment-shader-is")).resolves.not.toHaveProperty(
      "tryThis",
    );
  });

  test("returns null for a lesson outside the active release", async () => {
    await expect(repository.getLesson("missing")).resolves.toBeNull();
  });

  test("returns only published lesson IDs in curriculum order", async () => {
    const expectedIds = release.modules
      .filter(({ status }) => status === "published")
      .flatMap(({ lessons }) => lessons.map(({ id }) => id));

    await expect(repository.getPublishedLessonIds()).resolves.toEqual(expectedIds);
    await expect(repository.getModules()).resolves.toHaveLength(11);
  });

  test("does not rewrite an already installed release with the same checksum", async () => {
    await driver.run(
      "UPDATE modules SET title = ? WHERE release_id = ? AND id = ?",
      ["sentinel title", release.id, release.modules[0].id],
    );

    await installBundledRelease(driver, bundledCourse);

    await expect(
      driver.first<{ title: string }>(
        "SELECT title FROM modules WHERE release_id = ? AND id = ?",
        [release.id, release.modules[0].id],
      ),
    ).resolves.toEqual({ title: "sentinel title" });
  });

  test("rejects a checksum mismatch for an existing release ID", async () => {
    const conflictingRelease: CourseRelease = { ...release, checksum: "different-checksum" };

    await expect(installBundledRelease(driver, conflictingRelease)).rejects.toThrow(/checksum/i);
    await expect(repository.getActiveRelease()).resolves.toMatchObject({
      id: release.id,
      checksum: release.checksum,
    });
  });

  test("queries only the newly activated release", async () => {
    const nextRelease: CourseRelease = {
      ...release,
      id: "bundled-2026-08-05",
      checksum: "next-release-checksum",
      modules: release.modules.map((module, index) => ({
        ...module,
        title: index === 0 ? "Updated foundations" : module.title,
        lessons: module.lessons.map((lesson) =>
          lesson.id === "what-a-fragment-shader-is"
            ? { ...lesson, title: "Updated fragment shaders" }
            : lesson,
        ),
      })),
    };

    await installBundledRelease(driver, nextRelease);

    await expect(repository.getActiveRelease()).resolves.toEqual(nextRelease);
    await expect(repository.getModules()).resolves.toEqual(nextRelease.modules);
    await expect(repository.getLesson("what-a-fragment-shader-is")).resolves.toMatchObject({
      title: "Updated fragment shaders",
    });
  });
});

test("rolls back every row and leaves activation unset when installation fails", async () => {
  const driver = new FailingInstallDriver(":memory:");
  await migrateDatabase(driver);

  try {
    await expect(installBundledRelease(driver, bundledCourse)).rejects.toThrow(
      "injected lesson insert failure",
    );
    await expect(
      driver.first<{ id: string }>("SELECT id FROM content_releases WHERE id = ?", [release.id]),
    ).resolves.toBeNull();
    await expect(
      driver.first<{ value: string }>(
        "SELECT value FROM app_metadata WHERE key = 'active_release_id'",
      ),
    ).resolves.toBeNull();
  } finally {
    await driver.close();
  }
});
