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

export const COORDINATE_SYSTEMS_LESSON_ID: ModuleOneLessonId =
  "coordinate-systems-uv-space";
export const COLORS_FRAGMENT_OUTPUT_LESSON_ID: ModuleOneLessonId =
  "colors-fragment-output";

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
