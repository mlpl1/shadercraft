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

it("labels the bespoke preview footer of every Coordinate Systems & UV Space preset", () => {
  const lesson = publishedLessons.find(
    (candidate) => candidate.id === "coordinate-systems-uv-space",
  );

  expect(
    Object.fromEntries(
      (lesson?.presets ?? []).map((preset) => [preset.id, preset.previewValueLabel]),
    ),
  ).toEqual({
    normalized: "0.0 → 1.0 · screen space",
    centered: "−1.0 → 1.0 · centered",
    "pixel-space": "0 → resolution · pixel coordinates",
    "aspect-aware": "−aspect → aspect · corrected",
  });
});

it("authors no other preset with a bespoke preview footer", () => {
  const otherLessonPresetIds = publishedLessons
    .filter((lesson) => lesson.id !== "coordinate-systems-uv-space")
    .flatMap((lesson) => lesson.presets)
    .filter((preset) => preset.previewValueLabel !== undefined)
    .map((preset) => preset.id);

  expect(otherLessonPresetIds).toEqual([]);
});

it("labels the intro eyebrow of Module 2 and Module 3 lessons, leaving Module 1 on the default", () => {
  expect(
    Object.fromEntries(publishedLessons.map((lesson) => [lesson.id, lesson.introEyebrow])),
  ).toEqual({
    "coordinate-systems-uv-space": undefined,
    "colors-fragment-output": undefined,
    "uniforms-time": undefined,
    "transforming-uvs": undefined,
    "foundation-challenge": undefined,
    "step-and-smoothstep": "Shape synthesis",
    "circles-and-boxes": "Shape synthesis",
    "boolean-shape-operations": "Shape synthesis",
    "shape-repetition-composition": "Shape synthesis",
    "shape-synthesis-challenge": "Shape synthesis",
    "color-mixing": "Color & light",
    "luma-and-contrast": "Color & light",
    "procedural-palettes": "Color & light",
    "color-light-challenge": "Color & light",
  });
});
