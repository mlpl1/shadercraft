import bundledCourse from "../../../../assets/course/bundled-course.json";

import { parseCourseRelease } from "../schema";

const release = parseCourseRelease(bundledCourse);

const publishedLessons = release.modules
  .filter((module) => module.status === "published")
  .flatMap((module) => module.lessons);

/**
 * Lesson count per published module, in syllabus order — the one line that moves when a module
 * ships. Authoring Modules 2 and 3 each broke three tests here, because they enumerated every
 * published lesson id and stage count: lists that grow with the curriculum and say nothing a shorter
 * assertion would not.
 *
 * A count per module rather than a single module count, because the syllabus does not give every
 * module five lessons — Module 4 has four. The first attempt at this multiplied a module count by
 * five and would have broken again the moment that turned out to be false, which it did.
 */
const LESSONS_PER_PUBLISHED_MODULE = [5, 5, 5, 4, 5];

const PUBLISHED_MODULE_COUNT = LESSONS_PER_PUBLISHED_MODULE.length;

/** Fixed by `docs/superpowers/specs/2026-08-06-curriculum-syllabus-design.md`, published or not. */
const MODULE_IDS = [
  "fragments-and-coordinates",
  "shaping-values",
  "distance-fields",
  "colour",
  "space",
  "randomness-and-noise",
  "composition",
  "ray-marching",
  "three-d-shape-and-space",
  "lighting-and-materials",
  "performance-and-craft",
] as const;

it("carries the full syllabus in order, whatever has been authored so far", () => {
  expect(release.modules.map(({ id }) => id)).toEqual(MODULE_IDS);
});

it("publishes a prefix of the syllabus, with every later module still planned", () => {
  // Publishing out of order would let a learner reach a module whose prerequisites do not exist
  // yet — the ordering the whole curriculum design rests on, and nothing in `parseCourseRelease`
  // checks it.
  const statuses = release.modules.map(({ status }) => status);

  expect(statuses.slice(0, PUBLISHED_MODULE_COUNT).every((s) => s === "published")).toBe(true);
  expect(statuses.slice(PUBLISHED_MODULE_COUNT).every((s) => s === "planned")).toBe(true);
});

it("gives every published lesson four stages and real source", () => {
  const published = release.modules.filter((module) => module.status === "published");

  expect(published.map(({ lessons }) => lessons.length)).toEqual(LESSONS_PER_PUBLISHED_MODULE);

  // Four is a fact about this content, not merely `parseCourseRelease`'s already-enforced 3–5 bound
  // (which importing this module has checked by the time this test runs, so re-asserting it here
  // could never fail independently of every other test in the file).
  expect(publishedLessons.every(({ stages }) => stages.length === 4)).toBe(true);
  expect(publishedLessons.every(({ stages }) => stages.every((s) => s.source.includes("fragColor"))))
    .toBe(true);
});

it("authors Module 1's five lessons in order, each with real source", () => {
  const [moduleOne] = release.modules;

  expect(moduleOne.lessons.map(({ id }) => id)).toEqual([
    "what-a-fragment-shader-is",
    "from-pixels-to-uv",
    "centre-and-aspect",
    "time-as-an-input",
    "reading-shaders-from-elsewhere",
  ]);

  const [lesson] = moduleOne.lessons;
  expect(lesson.stages.map(({ title }) => title)).toEqual([
    "One colour, everywhere",
    "Where am I? Raw pixels",
    "Divide by the resolution",
    "Both axes at once",
  ]);
  expect(lesson.stages[0].source).toContain("vec4(0.85");
});

it("carries the optional tryThis prompt on the first authored lesson", () => {
  expect(publishedLessons[0].tryThis).toBe(
    "Swap uv.x and uv.y in the last stage. Which two corners trade colours, and which two stay put?",
  );
});
