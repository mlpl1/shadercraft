import {
  getModuleStatus,
  getProgressPercent,
  getPublishedLessonCount,
  isLessonUnlocked,
  isModuleUnlocked,
} from "../domain";
import type { CourseLesson, CourseModule, CourseRelease } from "../types";

/**
 * Progression logic is generic over module/lesson position and status; it does not read prose or
 * stages. Building a synthetic release here (rather than importing the real bundled course) keeps
 * these tests independent of how many modules and lessons are currently authored.
 */
function buildLesson(id: string, moduleId: string, position: number): CourseLesson {
  return {
    id,
    moduleId,
    position,
    title: id,
    shortTitle: id,
    intro: "",
    takeaway: "",
    stages: [],
  };
}

function buildModule(
  id: string,
  position: number,
  status: CourseModule["status"],
  lessonCount: number,
  plannedTopics: string[] = [],
): CourseModule {
  const lessons =
    status === "published"
      ? Array.from({ length: lessonCount }, (_, index) =>
          buildLesson(`${id}-lesson-${index + 1}`, id, index + 1),
        )
      : [];

  return {
    id,
    position,
    status,
    title: id,
    description: "",
    plannedLessonCount: status === "planned" ? plannedTopics.length : 0,
    plannedTopics: status === "planned" ? plannedTopics : [],
    lessons,
  };
}

const module1 = buildModule("module-1", 1, "published", 5);
const module2 = buildModule("module-2", 2, "published", 5);
const module3 = buildModule("module-3", 3, "published", 4);
const plannedModule4 = buildModule("module-4", 4, "planned", 0, [
  "Tiling Space",
  "Value Noise",
  "Layered Motion",
  "Fractal Brownian Motion",
  "Domain Warping",
]);

const release: CourseRelease = {
  id: "test-release",
  schemaVersion: 1,
  minimumAppVersion: "1.0.0",
  checksum: "checksum",
  modules: [module1, module2, module3, plannedModule4],
};

describe("course progression selectors", () => {
  test("counts only lessons in published modules", () => {
    expect(getPublishedLessonCount(release)).toBe(14);
  });

  test("makes the next published module available after the prior module is complete", () => {
    const completedModule1Ids = module1.lessons.map(({ id }) => id);

    expect(getModuleStatus(module2, completedModule1Ids)).toBe("available");
  });

  test("keeps a planned module planned after every published prerequisite is complete", () => {
    const completedModule3Ids = [module1, module2, module3].flatMap((module) =>
      module.lessons.map(({ id }) => id),
    );

    expect(getModuleStatus(plannedModule4, completedModule3Ids)).toBe("planned");
  });

  test("unlocks a lesson after the preceding lesson is complete", () => {
    expect(
      isLessonUnlocked(module2.lessons[1], module2.lessons, [module2.lessons[0].id]),
    ).toBe(true);
  });

  test("reports complete progress after all published lessons and excludes planned lessons", () => {
    const allPublishedLessonIds = release.modules
      .filter(({ status }) => status === "published")
      .flatMap((module) => module.lessons.map(({ id }) => id));

    expect(getProgressPercent(release, allPublishedLessonIds)).toBe(100);
  });

  test("always unlocks the first module by position, regardless of progress", () => {
    expect(isModuleUnlocked(release.modules, module1.id, [])).toBe(true);
  });

  test("keeps a module locked while its predecessor is only partially complete", () => {
    const partialModule1Ids = [module1.lessons[0].id];

    expect(isModuleUnlocked(release.modules, module2.id, partialModule1Ids)).toBe(false);
  });

  test("unlocks a module once every module ahead of it is complete", () => {
    const completedModule1Ids = module1.lessons.map(({ id }) => id);

    expect(isModuleUnlocked(release.modules, module2.id, completedModule1Ids)).toBe(true);
  });

  test("unlocks a planned module once every module ahead of it is complete", () => {
    const completedModule3Ids = [module1, module2, module3].flatMap((module) =>
      module.lessons.map(({ id }) => id),
    );

    expect(isModuleUnlocked(release.modules, plannedModule4.id, completedModule3Ids)).toBe(true);
  });
});
