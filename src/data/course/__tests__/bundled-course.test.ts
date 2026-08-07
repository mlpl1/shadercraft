import bundledCourse from "../../../../assets/course/bundled-course.json";

import { parseCourseRelease } from "../schema";

const release = parseCourseRelease(bundledCourse);

const publishedLessons = release.modules
  .filter((module) => module.status === "published")
  .flatMap((module) => module.lessons);

it("contains the complete current curriculum", () => {
  expect(release.modules).toHaveLength(11);
  expect(release.modules.filter((module) => module.status === "published")).toHaveLength(1);
  expect(release.modules.flatMap((module) => module.lessons)).toHaveLength(5);
  expect(
    release.modules.flatMap((module) => module.lessons.flatMap((lesson) => lesson.stages)),
  ).toHaveLength(20);
  expect(release.modules[1]).toMatchObject({
    id: "shaping-values",
    status: "planned",
    plannedLessonCount: 5,
  });
});

it("authors Module 1's five published lessons in order, each with real source", () => {
  expect(publishedLessons).toHaveLength(5);

  expect(publishedLessons.map(({ id }) => id)).toEqual([
    "what-a-fragment-shader-is",
    "from-pixels-to-uv",
    "centre-and-aspect",
    "time-as-an-input",
    "reading-shaders-from-elsewhere",
  ]);

  const [lesson] = publishedLessons;
  expect(lesson.id).toBe("what-a-fragment-shader-is");
  expect(lesson.stages.map(({ title }) => title)).toEqual([
    "One colour, everywhere",
    "Where am I? Raw pixels",
    "Divide by the resolution",
    "Both axes at once",
  ]);
  expect(lesson.stages[0].source).toContain("vec4(0.85");

  for (const publishedLesson of publishedLessons) {
    expect(publishedLesson.stages.length).toBeGreaterThanOrEqual(3);
    expect(publishedLesson.stages.length).toBeLessThanOrEqual(5);
  }
});

it("carries the optional tryThis prompt on the first authored lesson", () => {
  expect(publishedLessons[0].tryThis).toBe(
    "Swap uv.x and uv.y in the last stage. Which corner turns yellow now?",
  );
});

it("marks every planned module's lesson count equal to its planned topics", () => {
  const plannedModules = release.modules.filter((module) => module.status === "planned");

  expect(plannedModules).toHaveLength(10);
  for (const module of plannedModules) {
    expect(module.plannedLessonCount).toBe(module.plannedTopics.length);
    expect(module.lessons).toHaveLength(0);
  }
});
