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
      .find(({ id }) => id === "color-mixing");

    await expect(repository.getLesson("color-mixing")).resolves.toEqual(expectedLesson);
    await expect(repository.getLesson("color-mixing")).resolves.toMatchObject({
      moduleId: "color-light",
      presets: expect.any(Array),
      previewCaption: "Color field",
    });
  });

  test("round-trips the authored presentation fields of a lesson", async () => {
    await expect(repository.getLesson("uniforms-time")).resolves.toMatchObject({
      defaultPresetId: "time-play",
      previewCaption: "Time animation",
    });
    await expect(repository.getLesson("transforming-uvs")).resolves.not.toHaveProperty(
      "defaultPresetId",
    );
  });

  test("round-trips the bespoke preview footer of a preset", async () => {
    const lesson = await repository.getLesson("coordinate-systems-uv-space");

    expect(lesson?.presets.find((preset) => preset.id === "normalized")).toMatchObject({
      previewValueLabel: "0.0 → 1.0 · screen space",
    });

    const colorsLesson = await repository.getLesson("colors-fragment-output");
    expect(colorsLesson?.presets.find((preset) => preset.id === "rgb-gradient")).not.toHaveProperty(
      "previewValueLabel",
    );
  });

  test("round-trips the intro eyebrow of a lesson, absent rather than null when unauthored", async () => {
    await expect(repository.getLesson("step-and-smoothstep")).resolves.toMatchObject({
      introEyebrow: "Shape synthesis",
    });
    await expect(
      repository.getLesson("coordinate-systems-uv-space"),
    ).resolves.not.toHaveProperty("introEyebrow");
  });

  test("returns null for a lesson outside the active release", async () => {
    await expect(repository.getLesson("missing")).resolves.toBeNull();
  });

  test("returns only published lesson IDs in curriculum order", async () => {
    const expectedIds = release.modules
      .filter(({ status }) => status === "published")
      .flatMap(({ lessons }) => lessons.map(({ id }) => id));

    await expect(repository.getPublishedLessonIds()).resolves.toEqual(expectedIds);
    await expect(repository.getModules()).resolves.toHaveLength(4);
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
          lesson.id === "color-mixing"
            ? { ...lesson, title: "Updated color mixing" }
            : lesson,
        ),
      })),
    };

    await installBundledRelease(driver, nextRelease);

    await expect(repository.getActiveRelease()).resolves.toEqual(nextRelease);
    await expect(repository.getModules()).resolves.toEqual(nextRelease.modules);
    await expect(repository.getLesson("color-mixing")).resolves.toMatchObject({
      title: "Updated color mixing",
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
