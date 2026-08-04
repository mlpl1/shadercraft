import bundledCourse from "../../../../assets/course/bundled-course.json";

import { parseCourseRelease } from "../schema";

const release = parseCourseRelease(bundledCourse);

const publishedLessons = release.modules
  .filter((module) => module.status === "published")
  .flatMap((module) => module.lessons);

it("contains the complete current curriculum", () => {
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

it("captions the preview of every published lesson", () => {
  expect(publishedLessons).toHaveLength(14);
  expect(
    Object.fromEntries(publishedLessons.map((lesson) => [lesson.id, lesson.previewCaption])),
  ).toEqual({
    "coordinate-systems-uv-space": "UV preview",
    "colors-fragment-output": "Fragment color",
    "uniforms-time": "Time animation",
    "transforming-uvs": "Transformed shape",
    "foundation-challenge": "Foundation composition",
    "step-and-smoothstep": "Shape field",
    "circles-and-boxes": "Shape field",
    "boolean-shape-operations": "Shape field",
    "shape-repetition-composition": "Shape field",
    "shape-synthesis-challenge": "Shape field",
    "color-mixing": "Color field",
    "luma-and-contrast": "Color field",
    "procedural-palettes": "Color field",
    "color-light-challenge": "Color field",
  });
});

it("opens the two Module 1 lessons that do not start on their first preset", () => {
  expect(
    publishedLessons
      .filter((lesson) => lesson.defaultPresetId)
      .map((lesson) => [lesson.id, lesson.defaultPresetId]),
  ).toEqual([
    ["uniforms-time", "time-play"],
    ["foundation-challenge", "challenge-final"],
  ]);
});

it("pauses only the static preset of Uniforms & Time", () => {
  const pausedPresetIds = publishedLessons.flatMap((lesson) =>
    lesson.presets
      .filter((preset) => preset.previewParameters.animated === false)
      .map((preset) => preset.id),
  );

  expect(pausedPresetIds).toEqual(["time-static"]);
});
