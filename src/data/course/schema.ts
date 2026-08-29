import { z } from "zod";

import type { CourseModule, CourseRelease, Tutorial } from "./types";
import { fillTutorialTemplate, SHADERCRAFT_BLANK } from "./tutorial-exercise";

const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const glslNumericLiteralPattern =
  /(^|[^A-Za-z_])(?:0[xX][0-9a-fA-F]+[uU]?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fFuU]?)(?=$|[^A-Za-z_])/;

const lessonStageSchema = z
  .object({
    id: z.string(),
    position: z.number().int().positive(),
    title: z.string(),
    body: z.string(),
    source: z.string(),
    helpers: z.string().optional(),
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

const tutorialChoiceSchema = z
  .object({
    id: z.string(),
    fragment: z.string(),
  })
  .strict();

const tutorialStepSchema = z
  .object({
    id: z.string(),
    position: z.number().int().positive(),
    title: z.string(),
    brief: z.string(),
    sourceTemplate: z.string(),
    answerChoices: z.array(tutorialChoiceSchema).length(4),
    correctChoiceId: z.string(),
    helpers: z.string().optional(),
    hint: z.string().optional(),
  })
  .strict();

const tutorialSchema = z
  .object({
    id: z.string(),
    moduleId: z.string(),
    position: z.number().int().positive(),
    title: z.string(),
    summary: z.string(),
    steps: z.array(tutorialStepSchema),
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
    tutorials: z.array(tutorialSchema).optional(),
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
 * Tokens that must never appear in an authored stage. The first five belong to the wrapper the app
 * supplies (see `docs/data/shader-sandbox.md`); the rest name capability this build does not provide
 * — GLSL ES 3.00 sampling, and three Shadertoy uniforms the sandbox deliberately omits.
 *
 * `#extension` is listed for a reason worth keeping: a stage body is spliced inside `mainImage`, and
 * a preprocessor directive is only legal above every non-preprocessor token. Content that declared
 * its own extension would compile nowhere, so the wrapper declares the one the curriculum needs and
 * content is stopped from trying.
 *
 * This is the job the preview registry used to do. Content could never name a preview behaviour the
 * app lacked; it now cannot name a uniform or language feature the app lacks either.
 */
const SHADER_SOURCE_FORBIDDEN_TOKENS = [
  "#version",
  "#extension",
  "precision",
  "void main(",
  "gl_FragColor",
  "texture(",
  "iMouse",
  "iFrame",
  "iTimeDelta",
] as const;

/**
 * Floors, not targets — and they match
 * `docs/superpowers/specs/2026-08-06-curriculum-syllabus-design.md` rather than sitting below it.
 *
 * They existed at 40/40/20 while the spec committed to 60/60/30, which meant an author could satisfy
 * the build with roughly half the depth the design asks for. The previous curriculum averaged ~165
 * words per lesson while reading as finished, and this floor is the only mechanical guard against
 * that recurring — a guard set below the standard it guards is not one.
 *
 * There are deliberately no ceilings: nothing about teaching a concept well gets worse because the
 * explanation ran longer than a number guessed in advance.
 */
const MIN_INTRO_WORDS = 60;
const MIN_STAGE_BODY_WORDS = 60;
const MIN_TAKEAWAY_WORDS = 30;

/**
 * Lower than a stage body's, and deliberately. A stage body explains a shader the learner is only
 * reading; a step brief sets a task they are about to attempt, and padding it to sixty words would
 * bury the ask. What it must not be is a single terse imperative, which is the failure this guards.
 */
const MIN_STEP_BRIEF_WORDS = 25;
const MIN_TUTORIAL_SUMMARY_WORDS = 20;

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

/**
 * Helper declarations are spliced above `mainImage`, so they carry the wrapper's constraints too —
 * plus one of their own. `SHADER_SOURCE_FORBIDDEN_TOKENS` bans `void main(`, which does not match
 * `void mainImage(`: the substring after `void main` is `I`, not `(`. A stage that declared its own
 * `mainImage` would therefore pass every existing check and fail to link with a duplicate
 * definition, so the name is rejected outright.
 *
 * An empty string is rejected rather than treated as absent, so "has helpers" is never ambiguous
 * between the field being missing and being blank.
 */
function validateStageHelpers(stageId: string, helpers: string): void {
  if (helpers.trim().length === 0) {
    fail(`Stage ${stageId} helpers must not be empty when present`);
  }
  for (const token of SHADER_SOURCE_FORBIDDEN_TOKENS) {
    if (helpers.includes(token)) {
      fail(`Stage ${stageId} helpers must not contain ${token}`);
    }
  }
  if (helpers.includes("mainImage")) {
    fail(`Stage ${stageId} helpers must not define mainImage`);
  }
}

/**
 * Every authored answer fragment is compiled after substitution through the same sandbox wrapper a
 * stage uses. Checking all rendered variants keeps the target and every choice preview inside the
 * GLSL subset the app actually supports.
 */
function validateTutorials(
  tutorials: Tutorial[],
  moduleId: string,
  tutorialIds: Set<string>,
  stepIds: Set<string>,
): void {
  if (tutorials.length === 0) {
    fail(`Module ${moduleId} must omit tutorials rather than carry an empty list`);
  }

  validateContiguousPositions(tutorials, "tutorial");

  for (const tutorial of tutorials) {
    validateUniqueId(tutorialIds, tutorial.id, "tutorial");
    if (tutorial.moduleId !== moduleId) {
      fail(`Tutorial ${tutorial.id} must belong to module ${moduleId}`);
    }

    validateWordCount(
      tutorial.summary,
      MIN_TUTORIAL_SUMMARY_WORDS,
      `Tutorial ${tutorial.id} summary`,
    );

    if (tutorial.steps.length === 0) {
      fail(`Tutorial ${tutorial.id} must contain at least one step`);
    }
    validateContiguousPositions(tutorial.steps, "tutorial step");

    for (const step of tutorial.steps) {
      validateUniqueId(stepIds, step.id, "tutorial step");
      validateWordCount(step.brief, MIN_STEP_BRIEF_WORDS, `Tutorial step ${step.id} brief`);

      const markerCount = step.sourceTemplate.split(SHADERCRAFT_BLANK).length - 1;
      if (markerCount !== 1) {
        fail(`Tutorial step ${step.id} source template must contain exactly one blank marker`);
      }

      const choiceIds = new Set<string>();
      const renderedSources = new Set<string>();
      for (const choice of step.answerChoices) {
        validateUniqueId(choiceIds, choice.id, "tutorial choice");
        if (choice.fragment.trim().length === 0) {
          fail(`Tutorial step ${step.id} choice ${choice.id} fragment must not be blank`);
        }
        if (glslNumericLiteralPattern.test(choice.fragment)) {
          fail(
            `Tutorial step ${step.id} choice ${choice.id} must not contain numeric literals; provide values in the source template`,
          );
        }

        const source = fillTutorialTemplate(step.sourceTemplate, choice.fragment);
        validateStageSource(step.id, source);
        if (renderedSources.has(source)) {
          fail(`Tutorial step ${step.id} has duplicate rendered source`);
        }
        renderedSources.add(source);
      }

      if (!choiceIds.has(step.correctChoiceId)) {
        fail(`Tutorial step ${step.id} correct choice id must resolve to an answer choice`);
      }

      if (step.helpers !== undefined) {
        validateStageHelpers(step.id, step.helpers);
      }
    }
  }
}

function validateModules(modules: CourseModule[]): void {
  const moduleIds = new Set<string>();
  const lessonIds = new Set<string>();
  const stageIds = new Set<string>();
  const tutorialIds = new Set<string>();
  const tutorialStepIds = new Set<string>();

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
      // A tutorial unlocks when its module is completed, and a planned module can never be
      // completed, so one here would be permanently unreachable rather than merely early.
      if (module.tutorials !== undefined) {
        fail(`Planned module ${module.id} cannot carry tutorials`);
      }
    }

    if (module.tutorials !== undefined) {
      validateTutorials(module.tutorials, module.id, tutorialIds, tutorialStepIds);
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
        if (stage.helpers !== undefined) {
          validateStageHelpers(stage.id, stage.helpers);
        }
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
