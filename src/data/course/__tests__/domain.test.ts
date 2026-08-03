import bundledCourse from "../../../../assets/course/bundled-course.json";

import {
  getModuleStatus,
  getProgressPercent,
  getPublishedLessonCount,
  isLessonUnlocked,
} from "../domain";
import { parseCourseRelease } from "../schema";

const release = parseCourseRelease(bundledCourse);
const [module1, module2, module3, plannedModule4] = release.modules;

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
});
