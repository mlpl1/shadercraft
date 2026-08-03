import bundledCourse from "../../../../assets/course/bundled-course.json";

import { parseCourseRelease } from "../schema";

it("contains the complete current curriculum", () => {
  const release = parseCourseRelease(bundledCourse);
  expect(release.modules).toHaveLength(4);
  expect(release.modules.filter((module) => module.status === "published")).toHaveLength(3);
  expect(release.modules.flatMap((module) => module.lessons)).toHaveLength(14);
  expect(
    release.modules.flatMap((module) => module.lessons.flatMap((lesson) => lesson.presets)),
  ).toHaveLength(56);
  expect(release.modules[3]).toMatchObject({
    id: "procedural-textures",
    status: "planned",
    plannedLessonCount: 5,
  });
});
