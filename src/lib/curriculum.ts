export const MODULE_ONE_LESSONS = [
  {
    id: "coordinate-systems-uv-space",
    title: "Coordinate Systems & UV Space",
    shortTitle: "Coordinate systems",
  },
  {
    id: "colors-fragment-output",
    title: "Colors & Fragment Output",
    shortTitle: "Colors and output",
  },
  {
    id: "uniforms-time",
    title: "Uniforms & Time",
    shortTitle: "Uniforms and time",
  },
  {
    id: "transforming-uvs",
    title: "Transforming UVs",
    shortTitle: "Transforming UVs",
  },
  {
    id: "foundation-challenge",
    title: "Foundation Challenge",
    shortTitle: "Module challenge",
  },
] as const;

export type ModuleOneLessonId = (typeof MODULE_ONE_LESSONS)[number]["id"];

export const MODULE_TWO_LESSONS = [
  {
    id: "step-and-smoothstep",
    title: "Step & Smoothstep",
    shortTitle: "Edges and thresholds",
  },
  {
    id: "circles-and-boxes",
    title: "Circles & Boxes",
    shortTitle: "Primitive shapes",
  },
  {
    id: "boolean-shape-operations",
    title: "Boolean Shape Operations",
    shortTitle: "Shape operations",
  },
  {
    id: "shape-repetition-composition",
    title: "Repetition & Composition",
    shortTitle: "Repeat and layer",
  },
  {
    id: "shape-synthesis-challenge",
    title: "Shape Synthesis Challenge",
    shortTitle: "Module challenge",
  },
] as const;

export type ModuleTwoLessonId = (typeof MODULE_TWO_LESSONS)[number]["id"];

export const MODULE_THREE_LESSONS = [
  {
    id: "color-mixing",
    title: "Color Mixing",
    shortTitle: "Mixing color",
  },
  {
    id: "luma-and-contrast",
    title: "Luma & Contrast",
    shortTitle: "Luma and contrast",
  },
  {
    id: "procedural-palettes",
    title: "Procedural Palettes",
    shortTitle: "Procedural palettes",
  },
  {
    id: "color-light-challenge",
    title: "Color & Light Challenge",
    shortTitle: "Module challenge",
  },
] as const;

export type ModuleThreeLessonId = (typeof MODULE_THREE_LESSONS)[number]["id"];
export const MODULE_THREE_LESSON_COUNT = 4;

export const COORDINATE_SYSTEMS_LESSON_ID: ModuleOneLessonId =
  "coordinate-systems-uv-space";
export const COLORS_FRAGMENT_OUTPUT_LESSON_ID: ModuleOneLessonId =
  "colors-fragment-output";
export const UNIFORMS_TIME_LESSON_ID: ModuleOneLessonId = "uniforms-time";
export const TRANSFORMING_UVS_LESSON_ID: ModuleOneLessonId = "transforming-uvs";
export const FOUNDATION_CHALLENGE_LESSON_ID: ModuleOneLessonId = "foundation-challenge";

export const TOTAL_LESSON_COUNT = 19;

export function getModuleOneLesson(lessonId: string | undefined) {
  return MODULE_ONE_LESSONS.find((lesson) => lesson.id === lessonId);
}

export function getNextModuleOneLesson(lessonId: ModuleOneLessonId) {
  const index = MODULE_ONE_LESSONS.findIndex((lesson) => lesson.id === lessonId);
  return MODULE_ONE_LESSONS[index + 1];
}

export function getModuleOneCompletedCount(completedLessonIds: string[]) {
  return MODULE_ONE_LESSONS.filter((lesson) => completedLessonIds.includes(lesson.id)).length;
}

export function isModuleOneComplete(completedLessonIds: string[]) {
  return getModuleOneCompletedCount(completedLessonIds) === MODULE_ONE_LESSONS.length;
}

export function isModuleOneLessonUnlocked(
  lessonId: ModuleOneLessonId,
  completedLessonIds: string[],
) {
  const index = MODULE_ONE_LESSONS.findIndex((lesson) => lesson.id === lessonId);
  return index === 0 || completedLessonIds.includes(MODULE_ONE_LESSONS[index - 1].id);
}

export function getCurrentModuleOneLesson(completedLessonIds: string[]) {
  return (
    MODULE_ONE_LESSONS.find(
      (lesson) =>
        isModuleOneLessonUnlocked(lesson.id, completedLessonIds) &&
        !completedLessonIds.includes(lesson.id),
    ) ?? MODULE_ONE_LESSONS[MODULE_ONE_LESSONS.length - 1]
  );
}

export function getModuleTwoLesson(lessonId: string | undefined) {
  return MODULE_TWO_LESSONS.find((lesson) => lesson.id === lessonId);
}

export function getNextModuleTwoLesson(lessonId: ModuleTwoLessonId) {
  const index = MODULE_TWO_LESSONS.findIndex((lesson) => lesson.id === lessonId);
  return MODULE_TWO_LESSONS[index + 1];
}

export function getModuleTwoCompletedCount(completedLessonIds: string[]) {
  return MODULE_TWO_LESSONS.filter((lesson) => completedLessonIds.includes(lesson.id)).length;
}

export function isModuleTwoComplete(completedLessonIds: string[]) {
  return getModuleTwoCompletedCount(completedLessonIds) === MODULE_TWO_LESSONS.length;
}

export function isModuleTwoLessonUnlocked(
  lessonId: ModuleTwoLessonId,
  completedLessonIds: string[],
) {
  if (!isModuleOneComplete(completedLessonIds)) return false;
  const index = MODULE_TWO_LESSONS.findIndex((lesson) => lesson.id === lessonId);
  return index === 0 || completedLessonIds.includes(MODULE_TWO_LESSONS[index - 1].id);
}

export function getCurrentModuleTwoLesson(completedLessonIds: string[]) {
  if (!isModuleOneComplete(completedLessonIds)) return MODULE_TWO_LESSONS[0];

  return (
    MODULE_TWO_LESSONS.find(
      (lesson) =>
        isModuleTwoLessonUnlocked(lesson.id, completedLessonIds) &&
        !completedLessonIds.includes(lesson.id),
    ) ?? MODULE_TWO_LESSONS[MODULE_TWO_LESSONS.length - 1]
  );
}

export function getModuleThreeLesson(lessonId: string | undefined) {
  return MODULE_THREE_LESSONS.find((lesson) => lesson.id === lessonId);
}

export function getNextModuleThreeLesson(lessonId: ModuleThreeLessonId) {
  const index = MODULE_THREE_LESSONS.findIndex((lesson) => lesson.id === lessonId);
  return MODULE_THREE_LESSONS[index + 1];
}

export function getModuleThreeCompletedCount(completedLessonIds: string[]) {
  return MODULE_THREE_LESSONS.filter((lesson) => completedLessonIds.includes(lesson.id)).length;
}

export function isModuleThreeComplete(completedLessonIds: string[]) {
  return getModuleThreeCompletedCount(completedLessonIds) === MODULE_THREE_LESSON_COUNT;
}

export function isModuleThreeLessonUnlocked(
  lessonId: ModuleThreeLessonId,
  completedLessonIds: string[],
) {
  if (!isModuleTwoComplete(completedLessonIds)) return false;
  const index = MODULE_THREE_LESSONS.findIndex((lesson) => lesson.id === lessonId);
  return index === 0 || completedLessonIds.includes(MODULE_THREE_LESSONS[index - 1].id);
}

export function getCurrentModuleThreeLesson(completedLessonIds: string[]) {
  if (!isModuleTwoComplete(completedLessonIds)) return MODULE_THREE_LESSONS[0];

  return (
    MODULE_THREE_LESSONS.find(
      (lesson) =>
        isModuleThreeLessonUnlocked(lesson.id, completedLessonIds) &&
        !completedLessonIds.includes(lesson.id),
    ) ?? MODULE_THREE_LESSONS[MODULE_THREE_LESSONS.length - 1]
  );
}
