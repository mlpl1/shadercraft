import { z } from "zod";

import { isPreviewKey } from "../../shaders/preview-registry";
import type { CourseModule, CourseRelease } from "./types";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const lessonPresetSchema = z
  .object({
    id: z.string(),
    position: z.number().int().positive(),
    label: z.string(),
    previewKey: z.string(),
    previewParameters: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
    value: z.string(),
    filename: z.string(),
    codeLines: z.array(z.string()),
    highlightedLines: z.array(z.number().int()),
  })
  .strict();

const lessonSectionSchema = z
  .object({
    id: z.string(),
    position: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
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
    conceptTitle: z.string(),
    conceptLede: z.string(),
    tryHint: z.string(),
    takeaway: z.string(),
    presets: z.array(lessonPresetSchema).min(1),
    sections: z.array(lessonSectionSchema).min(1),
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

function validateModules(modules: CourseModule[]): void {
  const moduleIds = new Set<string>();
  const lessonIds = new Set<string>();
  const presetIds = new Set<string>();
  const sectionIds = new Set<string>();

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
      validateContiguousPositions(lesson.presets, "preset");
      validateContiguousPositions(lesson.sections, "section");

      for (const preset of lesson.presets) {
        validateUniqueId(presetIds, preset.id, "preset");
        if (!isPreviewKey(preset.previewKey)) {
          fail(`Invalid preview key: ${preset.previewKey}`);
        }
        for (const highlightedLine of preset.highlightedLines) {
          if (highlightedLine < 1 || highlightedLine > preset.codeLines.length) {
            fail(`Highlighted line must be between 1 and ${preset.codeLines.length}`);
          }
        }
      }

      for (const section of lesson.sections) {
        validateUniqueId(sectionIds, section.id, "section");
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
