import { z } from "zod";

import type { CourseModule, CourseRelease } from "./types";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const lessonStageSchema = z
  .object({
    id: z.string(),
    position: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
    source: z.string(),
  })
  .strict();

const courseLessonSchema = z
  .object({
    id: z.string(),
    moduleId: z.string(),
    position: z.number().int().positive(),
    title: z.string(),
    shortTitle: z.string(),
    intro: z.string(),
    takeaway: z.string(),
    tryThis: z.string().optional(),
    stages: z.array(lessonStageSchema),
  })
  .strict();

const courseModuleSchema = z
  .object({
    id: z.string(),
    position: z.number().int().positive(),
    status: z.enum(["published", "planned"]),
    title: z.string(),
    description: z.string(),
    plannedLessonCount: z.number().int().nonnegative(),
    plannedTopics: z.array(z.string()),
    lessons: z.array(courseLessonSchema),
  })
  .strict();

const courseReleaseSchema = z
  .object({
    id: z.string(),
    schemaVersion: z.literal(1),
    minimumAppVersion: z.string(),
    checksum: z.string(),
    modules: z.array(courseModuleSchema),
  })
  .strict();

function fail(message: string): never {
  throw new Error(message);
}

function validateId(id: string, entityType: string): void {
  if (!idPattern.test(id)) {
    fail(`Invalid ${entityType} id: ${id}`);
  }
}

function validateUniqueId(ids: Set<string>, id: string, entityType: string): void {
  validateId(id, entityType);
  if (ids.has(id)) {
    fail(`Duplicate ${entityType} id: ${id}`);
  }
  ids.add(id);
}

function validateContiguousPositions(
  entries: { position: number }[],
  entityType: string,
): void {
  const positions = new Set(entries.map((entry) => entry.position));
  if (positions.size !== entries.length) {
    fail(`Duplicate ${entityType} position`);
  }
  for (let position = 1; position <= entries.length; position += 1) {
    if (!positions.has(position)) {
      fail(`${entityType} positions must be contiguous from 1`);
    }
  }
}

/**
 * Tokens that must never appear in an authored stage. The first four belong to the wrapper the app
 * supplies (see `docs/data/shader-sandbox.md`); the rest name capability this build does not provide
 * — GLSL ES 3.00 sampling, and three Shadertoy uniforms the sandbox deliberately omits.
 *
 * This is the job the preview registry used to do. Content could never name a preview behaviour the
 * app lacked; it now cannot name a uniform or language feature the app lacks either.
 */
export const SHADER_SOURCE_FORBIDDEN_TOKENS = [
  "#version",
  "precision",
  "void main(",
  "gl_FragColor",
  "texture(",
  "iMouse",
  "iFrame",
  "iTimeDelta",
] as const;

const MIN_INTRO_WORDS = 40;
const MIN_STAGE_BODY_WORDS = 40;
const MIN_TAKEAWAY_WORDS = 20;

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Enforces the depth the syllabus design committed to numerically. The previous curriculum averaged
 * ~165 words per lesson while reading as finished, so the floor is checked rather than trusted.
 */
function validateWordCount(value: string, minimum: number, label: string): void {
  if (countWords(value) < minimum) {
    fail(`${label} must be at least ${minimum} words`);
  }
}

function validateStageSource(stageId: string, source: string): void {
  if (source.trim().length === 0) {
    fail(`Stage ${stageId} source must not be empty`);
  }
  for (const token of SHADER_SOURCE_FORBIDDEN_TOKENS) {
    if (source.includes(token)) {
      fail(`Stage ${stageId} source must not contain ${token}`);
    }
  }
}

function validateModules(modules: CourseModule[]): void {
  const moduleIds = new Set<string>();
  const lessonIds = new Set<string>();
  const stageIds = new Set<string>();

  validateContiguousPositions(modules, "module");

  for (const module of modules) {
    validateUniqueId(moduleIds, module.id, "module");
    validateContiguousPositions(module.lessons, "lesson");

    if (module.status === "published") {
      if (module.lessons.length === 0) {
        fail(`Published module ${module.id} must contain at least one lesson`);
      }
      if (module.plannedLessonCount !== 0 || module.plannedTopics.length !== 0) {
        fail(`Published module ${module.id} cannot include planned lessons or topics`);
      }
    } else {
      if (module.lessons.length !== 0) {
        fail(`Planned module ${module.id} cannot contain lesson rows`);
      }
      if (module.plannedLessonCount !== module.plannedTopics.length) {
        fail(`Planned module ${module.id} lesson count must match planned topics`);
      }
    }

    for (const lesson of module.lessons) {
      validateUniqueId(lessonIds, lesson.id, "lesson");
      if (lesson.moduleId !== module.id) {
        fail(`Lesson ${lesson.id} must belong to module ${module.id}`);
      }

      validateWordCount(lesson.intro, MIN_INTRO_WORDS, `Lesson ${lesson.id} intro`);
      validateWordCount(lesson.takeaway, MIN_TAKEAWAY_WORDS, `Lesson ${lesson.id} takeaway`);

      if (lesson.stages.length < 3 || lesson.stages.length > 5) {
        fail(`Lesson ${lesson.id} must have between 3 and 5 stages`);
      }
      validateContiguousPositions(lesson.stages, "stage");

      for (const stage of lesson.stages) {
        validateUniqueId(stageIds, stage.id, "stage");
        validateWordCount(stage.body, MIN_STAGE_BODY_WORDS, `Stage ${stage.id} body`);
        validateStageSource(stage.id, stage.source);
      }
    }
  }
}

export function parseAuthoredModules(value: unknown): CourseModule[] {
  const modules = z.array(courseModuleSchema).parse(value) as CourseModule[];
  validateModules(modules);
  return modules;
}

export function parseCourseRelease(value: unknown): CourseRelease {
  const release = courseReleaseSchema.parse(value) as CourseRelease;
  validateId(release.id, "release");
  if (!/^\d+\.\d+\.\d+$/.test(release.minimumAppVersion)) {
    fail(`Invalid minimum app version: ${release.minimumAppVersion}`);
  }
  validateModules(release.modules);
  return release;
}
