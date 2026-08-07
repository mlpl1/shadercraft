import bundledCourse from "../../../../assets/course/bundled-course.json";

import { parseCourseRelease } from "../schema";

const release = parseCourseRelease(bundledCourse);

const publishedLessons = release.modules
  .filter((module) => module.status === "published")
  .flatMap((module) => module.lessons);

it("contains the complete current curriculum", () => {
  expect(release.modules).toHaveLength(11);
  expect(release.modules.filter((module) => module.status === "published")).toHaveLength(2);
  expect(release.modules.flatMap((module) => module.lessons)).toHaveLength(10);
  expect(
    release.modules.flatMap((module) => module.lessons.flatMap((lesson) => lesson.stages)),
  ).toHaveLength(40);
  expect(release.modules[1]).toMatchObject({
    id: "shaping-values",
    status: "published",
    plannedLessonCount: 0,
  });
});

it("authors both modules' published lessons in order, each with real source", () => {
  expect(publishedLessons).toHaveLength(10);

  expect(publishedLessons.map(({ id }) => id)).toEqual([
    "what-a-fragment-shader-is",
    "from-pixels-to-uv",
    "centre-and-aspect",
    "time-as-an-input",
    "reading-shaders-from-elsewhere",
    "hard-edges-with-step",
    "soft-edges-with-smoothstep",
    "blending-with-mix",
    "keeping-values-in-range",
    "remapping-and-easing",
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

  // Every authored lesson so far carries exactly four stages — a fact about this content, not
  // merely `parseCourseRelease`'s already-enforced 3–5 bound (which importing this module has
  // already checked by the time this test runs, so re-asserting the bound here could never fail
  // independently of every other test in this file).
  expect(publishedLessons.map(({ stages }) => stages.length)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 4, 4]);
});

it("carries the optional tryThis prompt on the first authored lesson", () => {
  expect(publishedLessons[0].tryThis).toBe(
    "Swap uv.x and uv.y in the last stage. Which two corners trade colours, and which two stay put?",
  );
});

it("marks every planned module's lesson count equal to its planned topics", () => {
  const plannedModules = release.modules.filter((module) => module.status === "planned");

  // The ids and order below are content facts `parseCourseRelease` does not check — unlike the
  // per-module `plannedLessonCount`/`plannedTopics` equality and empty-`lessons` invariants it
  // already enforces at import time (see `validateModules`), which would fail every test in this
  // file rather than just this one, so re-asserting them here adds no coverage.
  expect(plannedModules.map(({ id }) => id)).toEqual([
    "distance-fields",
    "colour",
    "space",
    "randomness-and-noise",
    "composition",
    "ray-marching",
    "three-d-shape-and-space",
    "lighting-and-materials",
    "performance-and-craft",
  ]);
});
