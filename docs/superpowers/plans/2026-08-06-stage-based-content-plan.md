# Stage-Based Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the preset/`previewKey` content model with stages carrying real GLSL that the sandbox compiles, author Module 1 in the new shape, and delete the `u_mode` preview machinery.

**Architecture:** A lesson becomes prose plus 3–5 stages, each carrying a complete runnable `mainImage` body. `lesson_stages` replaces both `lesson_presets` and `lesson_sections`. The lesson workspace renders `ShaderSandbox` with stage navigation instead of a preset switcher indexing a hardcoded shader. Content validation gains the job the preview registry used to do: rejecting source that names capability the app does not provide.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript 6, `expo-sqlite`, Zod, Jest with `jest-expo`, `node:sqlite` for repository tests, `tsx` for content tooling.

**Spec:** `docs/superpowers/specs/2026-08-06-curriculum-syllabus-design.md`

## Global Constraints

- Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing code against any Expo API.
- **No new dependencies.**
- **Every stage's `source` is a complete `mainImage` body.** No `precision`, no `main()`, no `#version`, no `gl_FragColor`.
- **GLSL ES 1.00 only.** No stage-level `in`/`out`, no `texture(`.
- **`iResolution` (vec3) and `iTime` (float) are the only uniforms.** No `iMouse`, `iFrame`, `iTimeDelta`.
- **No lesson may use a technique a later lesson introduces.** Module 1 has no `step`, `smoothstep`, `mix`, `clamp`, no SDF shape functions, and no branching. `length()` is permitted in Module 1 purely as a *measurement* — showing that a radial gradient goes elliptical on a non-square screen — because measuring a distance is not making a shape. Module 3 introduces it as a shape tool. Any stage relying on this carve-out must say so in its body.
- **Word minimums per lesson:** intro ≥ 40 words, each stage body ≥ 40, takeaway ≥ 20. Enforced by the schema, not by good intentions.
- **3–5 stages per lesson**, enforced.
- Nothing under `src/data` may import React or `expo-gl`.
- Run before every commit: `npm test`, `npx tsc --noEmit`, and `npm run content:check`.
- **One declared exception, and only one.** Task 1 necessarily commits red: `src/components/__tests__/lesson-workspace.test.tsx` and `src/app/__tests__/lesson.test.tsx` fail to load, and `tsc` reports errors confined to `lesson-workspace.tsx` and its test, because the workspace still reads `lesson.presets` until Task 2 rewrites it. Tasks 1 and 2 together restore green. Task 1 must still leave `content:check` passing and every other suite green. No other task may commit red.

## Scope Decision, and One Deviation From The Spec

The spec's boot-order list has step 5 authoring all five Module 1 lessons in this landing. **This plan authors Lesson 1.1 only in Task 1**, and lessons 1.2–1.5 in Task 5 as pure content work.

The reason is that an implementation plan is the wrong artifact to hold ~2,500 words of prose and 20 shaders. Task 1 needs *one* real lesson to prove the format and to regenerate a bootable bundled release; a published module is valid with one lesson. Task 5 then adds the rest with no code involved — which is exactly the property this whole change exists to create.

**Supabase is deliberately out of scope for this plan.** `content_presets`, `publish_course_release` and `get_course_release` still speak the old shape, so `npm run content:publish` would produce a release no device can parse. That is safe to defer because publishing runs only from CI behind a manual-approval environment whose secrets and reviewers were never configured — the workflow is inert. It gets its own plan before anyone publishes. **Do not run `content:publish` until that lands.**

## What Validation Cannot Do

`content:check` verifies a stage's source **statically**: non-empty, and free of the forbidden tokens. It does not compile it. Compiling GLSL in Node needs a headless GL context, which would mean a new dependency, and this plan adds none.

So a stage with a genuine syntax error — a missing semicolon, an undeclared variable, a `vec3` assigned to a `vec4` — passes every automated check and fails on device, where the learner sees the compile error instead of the shader. **The only real verification is walking the lessons on a device**, which is why Task 5 Step 6 exists and is not optional. Treat the spec's "every stage's source compiles" criterion as satisfied by that walk, not by CI.

If this becomes painful once there are 30-plus lessons, the fix is a `content:compile` script running the sources through a headless GL context in CI. That is its own piece of work, deliberately not smuggled in here.

## Before You Start: You Must Uninstall The App

This plan collapses the migration chain to a single version 1. A device already at `user_version = 2` will hit `Database has newer schema version 2; this app supports 1` and refuse to start — deliberately, since silently reinterpreting a newer schema is worse. Uninstall the app (or clear its data) on every device and emulator before running this.

## File Structure

**Created:**
- `content/module-01-fragments.json` — Module 1 in the new shape
- `content/module-02-shaping.json` … `content/module-07-composition.json` — planned modules, topic lists only
- `content/module-08-raymarching.json` … `content/module-11-performance.json` — planned modules, topic lists only

**Modified:**
- `src/data/course/types.ts` — `LessonStage` replaces `LessonPreset`; `CourseLesson` loses preset/section fields
- `src/data/course/schema.ts` — stage validation replaces preview-key validation
- `src/data/database/migrations.ts` — `lesson_stages` replaces `lesson_presets` and `lesson_sections`; chain collapsed to v1
- `src/data/course/sqlite-course-repository.ts` — stage rows
- `src/data/course/release-installer.ts` — stage inserts and deletes
- `src/components/lesson-workspace.tsx` — `ShaderSandbox` with stage navigation
- `scripts/content/build-course.ts` — new module file list, new release id
- `src/app/index.tsx` — remove the bonus-tutorial card
- `docs/data/local-curriculum.md` — rewritten as the stage authoring guide
- `README.md`

**Deleted:**
- `src/shaders/preview-registry.ts` and `src/shaders/__tests__/preview-registry.test.ts`
- `src/components/live-shader-preview.tsx`
- `src/app/bonus-scanline.tsx`
- `content/module-01-foundations.json`, `module-02-shapes.json`, `module-03-color-light.json`, `module-04-textures.json`

---

### Task 1: Swap presets for stages across the data layer

**Large and atomic by necessity.** The types, schema, tables, repository, installer, content and generated release all describe one shape; changing them separately leaves no state where the suite is green, because every repository and installer test seeds from `assets/course/bundled-course.json`.

**Files:**
- Modify: `src/data/course/types.ts`
- Modify: `src/data/course/schema.ts`
- Modify: `src/data/database/migrations.ts`
- Modify: `src/data/course/sqlite-course-repository.ts`
- Modify: `src/data/course/release-installer.ts`
- Modify: `scripts/content/build-course.ts`
- Create: `content/module-01-fragments.json`
- Create: `content/module-02-shaping.json` through `content/module-11-performance.json` (planned)
- Delete: the four old `content/module-*.json`
- Test: `src/data/course/__tests__/schema.test.ts`, `src/data/database/__tests__/migrations.test.ts`

**Interfaces:**
- Consumes: `DatabaseDriver` from `../database/driver`.
- Produces:
  - `type LessonStage = { id: string; position: number; title: string; body: string; source: string }`
  - `CourseLesson` = `{ id, moduleId, position, title, shortTitle, intro, takeaway, tryThis?, stages }`
  - `parseAuthoredModules(value: unknown): CourseModule[]` — unchanged signature
  - `SHADER_SOURCE_FORBIDDEN_TOKENS: readonly string[]`

- [ ] **Step 1: Write the failing schema tests**

Add to `src/data/course/__tests__/schema.test.ts`. Read the existing file first and reuse its fixture helpers; these tests replace every preset- and section-related case in it.

```ts
import { parseAuthoredModules } from "../schema";

const stage = (position: number, overrides: Record<string, unknown> = {}) => ({
  id: `stage-${position}`,
  position,
  title: `Stage ${position}`,
  body: "This body is deliberately long enough to clear the forty word minimum that the schema enforces, because a stage that explains itself in a dozen words is the thinness this whole redesign exists to prevent, and the rule has to bite somewhere.",
  source: "fragColor = vec4(1.0, 0.0, 0.0, 1.0);",
  ...overrides,
});

const lesson = (overrides: Record<string, unknown> = {}) => ({
  id: "a-lesson",
  moduleId: "a-module",
  position: 1,
  title: "A lesson",
  shortTitle: "Lesson",
  intro: "An intro long enough to clear its own forty word minimum, which exists so that a lesson cannot ship as a title and a shrug the way the previous curriculum did across all fourteen of its published lessons without anything at all noticing.",
  takeaway: "A takeaway with enough words in it to clear the twenty word minimum the schema applies to this field.",
  stages: [stage(1), stage(2), stage(3)],
  ...overrides,
});

const publishedModule = (overrides: Record<string, unknown> = {}) => ({
  id: "a-module",
  position: 1,
  status: "published",
  title: "A module",
  description: "A module description.",
  plannedLessonCount: 0,
  plannedTopics: [],
  lessons: [lesson()],
  ...overrides,
});

describe("stage validation", () => {
  it("accepts a lesson with three stages", () => {
    expect(() => parseAuthoredModules([publishedModule()])).not.toThrow();
  });

  it("accepts a lesson with five stages", () => {
    const lessons = [lesson({ stages: [1, 2, 3, 4, 5].map((n) => stage(n)) })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).not.toThrow();
  });

  it("rejects fewer than three stages", () => {
    const lessons = [lesson({ stages: [stage(1), stage(2)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/between 3 and 5/i);
  });

  it("rejects more than five stages", () => {
    const lessons = [lesson({ stages: [1, 2, 3, 4, 5, 6].map((n) => stage(n)) })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/between 3 and 5/i);
  });

  it("rejects non-contiguous stage positions", () => {
    const lessons = [lesson({ stages: [stage(1), stage(2), stage(4)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/contiguous/i);
  });

  it("rejects duplicate stage ids across the release", () => {
    const lessons = [lesson({ stages: [stage(1), stage(2), stage(3, { id: "stage-1" })] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/duplicate stage id/i);
  });

  it("rejects an empty source", () => {
    const lessons = [lesson({ stages: [stage(1, { source: "  " }), stage(2), stage(3)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/source must not be empty/i);
  });
});

describe("stage source respects the sandbox contract", () => {
  it.each([
    ["precision highp float;\nfragColor = vec4(1.0);", "precision"],
    ["void main() { }", "void main("],
    ["#version 300 es\nfragColor = vec4(1.0);", "#version"],
    ["gl_FragColor = vec4(1.0);", "gl_FragColor"],
    ["vec4 c = texture(tex, uv);", "texture("],
    ["fragColor = vec4(iMouse.xy, 0.0, 1.0);", "iMouse"],
    ["fragColor = vec4(float(iFrame));", "iFrame"],
    ["fragColor = vec4(iTimeDelta);", "iTimeDelta"],
  ])("rejects source containing %s", (source) => {
    const lessons = [lesson({ stages: [stage(1, { source }), stage(2), stage(3)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/must not contain/i);
  });

  it("allows iResolution and iTime", () => {
    const source = "vec2 uv = fragCoord / iResolution.xy;\nfragColor = vec4(uv, sin(iTime), 1.0);";
    const lessons = [lesson({ stages: [stage(1, { source }), stage(2), stage(3)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).not.toThrow();
  });
});

describe("prose depth", () => {
  it("rejects a short intro", () => {
    const lessons = [lesson({ intro: "Too short." })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/intro.*40 words/i);
  });

  it("rejects a short stage body", () => {
    const lessons = [lesson({ stages: [stage(1, { body: "Too short." }), stage(2), stage(3)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/body.*40 words/i);
  });

  it("rejects a short takeaway", () => {
    const lessons = [lesson({ takeaway: "Too short." })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/takeaway.*20 words/i);
  });
});

describe("tryThis", () => {
  it("is optional", () => {
    expect(() => parseAuthoredModules([publishedModule()])).not.toThrow();
  });

  it("is accepted when present", () => {
    const lessons = [lesson({ tryThis: "Change the divisor and watch the gradient stretch." })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the schema tests and verify they fail**

Run: `npx jest src/data/course/__tests__/schema.test.ts`

Expected: FAIL. The current schema is `.strict()` and rejects `stages` as an unknown key, while requiring `presets` and `sections`.

- [ ] **Step 3: Rewrite the domain types**

In `src/data/course/types.ts`, delete the `ShaderPreviewKey` import and the entire `LessonPreset` type, and replace them:

```ts
export type ModuleStatus = "published" | "planned";

/**
 * One step in a lesson's build-up. `source` is a complete, runnable `mainImage` body — not a
 * fragment and not a diff against the previous stage. That duplicates code between neighbouring
 * stages deliberately: it is what lets the sandbox compile any stage directly, lets a learner edit
 * one and see it run, and guarantees the code on screen is the code that renders.
 */
export type LessonStage = {
  id: string;
  position: number;
  title: string;
  body: string;
  source: string;
};

export type CourseLesson = {
  id: string;
  moduleId: string;
  position: number;
  title: string;
  shortTitle: string;
  intro: string;
  takeaway: string;
  /** Optional invitation to experiment. No target, no solution, nothing checks it. */
  tryThis?: string;
  stages: LessonStage[];
};
```

Leave `CourseModule` and `CourseRelease` exactly as they are.

- [ ] **Step 4: Rewrite the schema**

In `src/data/course/schema.ts`: delete the `preview-registry` import, `lessonPresetSchema`, `lessonSectionSchema`, and `validatePreviewParameters`. Then add:

```ts
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
```

In `validateModules`, replace the `presetIds`/`sectionIds` sets with `stageIds`, and replace the per-lesson preset and section blocks with:

```ts
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
```

- [ ] **Step 5: Run the schema tests and verify they pass**

Run: `npx jest src/data/course/__tests__/schema.test.ts`

Expected: PASS for the new cases. Pre-existing tests asserting preset or section behaviour will fail — delete them; they describe a model that no longer exists.

- [ ] **Step 6: Replace the content tables**

In `src/data/database/migrations.ts`, inside `CREATE_INITIAL_SCHEMA`: delete the `lesson_presets` and `lesson_sections` table definitions and their indexes, remove `concept_title`, `concept_lede`, `try_hint`, `preview_caption`, `default_preset_id` and `intro_eyebrow` from `lessons`, add `try_this TEXT`, and add:

```sql
  CREATE TABLE lesson_stages (
    release_id TEXT NOT NULL,
    id TEXT NOT NULL,
    lesson_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position > 0),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    source TEXT NOT NULL,
    PRIMARY KEY (release_id, id),
    FOREIGN KEY (release_id, lesson_id)
      REFERENCES lessons(release_id, id) ON DELETE CASCADE
  );

  CREATE INDEX idx_lesson_stages_release_lesson_position
    ON lesson_stages(release_id, lesson_id, position);
```

Then fold the sketches table into `CREATE_INITIAL_SCHEMA` too, and reduce `migrations` to a single entry:

```ts
const migrations: readonly DatabaseMigration[] = [
  {
    version: 1,
    async migrate(driver) {
      await driver.exec(CREATE_INITIAL_SCHEMA);
    },
  },
];
```

- [ ] **Step 7: Update the migration tests**

In `src/data/database/__tests__/migrations.test.ts`: change the expected `user_version` from 2 to 1, change `getPendingMigrations(0)` to expect `[1]`, delete the `getPendingMigrations(1)` case and the "applies migration 2" test, replace `lesson_presets`/`lesson_sections` with `lesson_stages` in the table list and composite-key cases, and add:

```ts
  test("lesson_stages cascades from its lesson and carries required source", async () => {
    await migrateDatabase(driver);

    const columns = await driver.all<TableInfoRow>("PRAGMA table_info(lesson_stages)");
    expect(columns.map(({ name }) => name).sort()).toEqual([
      "body",
      "id",
      "lesson_id",
      "position",
      "release_id",
      "source",
      "title",
    ]);
    expect(columns.every(({ notnull }) => notnull === 1)).toBe(true);

    const foreignKeys = await driver.all<ForeignKeyRow>("PRAGMA foreign_key_list(lesson_stages)");
    expect(foreignKeys.map(({ from }) => from).sort()).toEqual(["lesson_id", "release_id"]);
    expect(foreignKeys[0].on_delete).toBe("CASCADE");
  });
```

The expected table list becomes: `app_metadata`, `content_releases`, `learner_profiles`, `lesson_progress`, `lesson_stages`, `lessons`, `modules`, `sketches`, `sync_outbox`, `sync_state`.

- [ ] **Step 8: Update the repository**

In `src/data/course/sqlite-course-repository.ts`: replace `PresetRow` and `SectionRow` with

```ts
type StageRow = {
  id: string;
  lesson_id: string;
  position: number;
  title: string;
  body: string;
  source: string;
};
```

Replace the two `driver.all` calls for presets and sections with one:

```ts
      this.driver.all<StageRow>(
        `SELECT id, lesson_id, position, title, body, source
         FROM lesson_stages
         WHERE release_id = ?
         ORDER BY lesson_id, position`,
        [release.id],
      ),
```

Replace `presetsByLesson`/`sectionsByLesson` with `stagesByLesson`, and the lesson mapping's tail with:

```ts
    ...(lesson.try_this === null ? {} : { tryThis: lesson.try_this }),
    stages: (stagesByLesson.get(lesson.id) ?? []).map((stage) => ({
      id: stage.id,
      position: stage.position,
      title: stage.title,
      body: stage.body,
      source: stage.source,
    })),
```

Also update the `lessons` SELECT to fetch `try_this` instead of the six removed columns.

- [ ] **Step 9: Update the installer**

In `src/data/course/release-installer.ts`: in the delete loop replace the two child deletes with

```ts
        await this.driver.run("DELETE FROM lesson_stages WHERE release_id = ?", [id]);
```

and replace the preset/section insert loops with

```ts
      for (const stage of lesson.stages) {
        await driver.run(
          `INSERT INTO lesson_stages
            (release_id, id, lesson_id, position, title, body, source)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [release.id, stage.id, lesson.id, stage.position, stage.title, stage.body, stage.source],
        );
      }
```

Update the lesson insert to write `try_this` (`lesson.tryThis ?? null`) and drop the six removed columns.

- [ ] **Step 10: Author Module 1 Lesson 1**

Create `content/module-01-fragments.json`. Note the stage arc: it motivates normalising by showing the arbitrary-divisor problem first, and uses no function Module 2 has yet introduced.

```json
{
  "id": "fragments-and-coordinates",
  "position": 1,
  "status": "published",
  "title": "Fragments & Coordinates",
  "description": "Understand what runs where, and put a deliberate colour at a deliberate place.",
  "plannedLessonCount": 0,
  "plannedTopics": [],
  "lessons": [
    {
      "id": "what-a-fragment-shader-is",
      "moduleId": "fragments-and-coordinates",
      "position": 1,
      "title": "What a fragment shader is",
      "shortTitle": "Fragment shaders",
      "intro": "A fragment shader is one small function, and the GPU runs a separate copy of it for every single pixel on screen. Your job is to return one colour. You never loop over pixels and you never know which pixel you are, except through the coordinate handed to you. That constraint is what makes shaders fast, and what makes them feel strange at first.",
      "takeaway": "One function, run once per pixel, returning a colour. Divide the incoming coordinate by the resolution to get a number that means the same thing on every screen.",
      "tryThis": "Swap uv.x and uv.y in the last stage. Which corner turns yellow now?",
      "stages": [
        {
          "id": "one-colour-everywhere",
          "position": 1,
          "title": "One colour, everywhere",
          "body": "The simplest possible shader ignores position entirely and returns the same colour for every pixel. This still runs once per pixel — hundreds of thousands of times for a phone screen — it just happens to produce the same answer each time. fragColor is what you assign to, and its four components are red, green, blue and alpha, each running from zero to one rather than zero to 255.",
          "source": "fragColor = vec4(0.85, 0.28, 0.22, 1.0);"
        },
        {
          "id": "raw-pixel-coordinates",
          "position": 2,
          "title": "Where am I? Raw pixels",
          "body": "fragCoord tells you which pixel this copy of the function is responsible for, measured in pixels from the bottom-left corner. Feeding it into red makes position visible as a gradient. But notice the divisor: four hundred is a guess. On a narrower screen the gradient finishes early, and on a wider one it never reaches full brightness. The coordinate is real, but the scale is arbitrary.",
          "source": "fragColor = vec4(fragCoord.x / 400.0, 0.28, 0.22, 1.0);"
        },
        {
          "id": "divide-by-resolution",
          "position": 3,
          "title": "Divide by the resolution",
          "body": "iResolution holds the size of the surface being drawn, so dividing fragCoord by it converts pixels into a fraction of the way across. Now zero is the left edge and one is the right edge on every device, and the guess is gone. This normalised coordinate is conventionally called uv, and almost everything else in this course starts from it. Elsewhere you will see it called u_resolution, declared as a vec2.",
          "source": "vec2 uv = fragCoord / iResolution.xy;\nfragColor = vec4(uv.x, 0.28, 0.22, 1.0);"
        },
        {
          "id": "both-axes",
          "position": 4,
          "title": "Both axes at once",
          "body": "Feeding uv.x into red and uv.y into green makes both axes visible in one image, and gives you a permanently useful debugging tool: when coordinates misbehave, render them as colour and look. Bottom-left is black because both values are zero there. Top-right is yellow because red and green are both at full. Any corner that surprises you means your coordinates are not what you assumed.",
          "source": "vec2 uv = fragCoord / iResolution.xy;\nfragColor = vec4(uv.x, uv.y, 0.22, 1.0);"
        }
      ]
    }
  ]
}
```

- [ ] **Step 11: Create the ten planned modules**

Create one file per remaining module. Each is a `planned` module with no lessons, whose `plannedTopics` are the real lesson goals from the spec. `plannedLessonCount` must equal `plannedTopics.length`. Example for Module 2 (`content/module-02-shaping.json`):

```json
{
  "id": "shaping-values",
  "position": 2,
  "status": "planned",
  "title": "Shaping Values",
  "description": "Turn any continuous measurement into a controlled visual signal.",
  "plannedLessonCount": 5,
  "plannedTopics": [
    "Hard edges with step",
    "Soft edges with smoothstep",
    "Blending with mix",
    "Keeping values in range",
    "Remapping and easing"
  ],
  "lessons": []
}
```

Repeat for modules 3–11 using the titles, descriptions and topic lists in the spec's Act 1 and Act 2 sections. Module ids: `distance-fields`, `colour`, `space`, `randomness-and-noise`, `composition`, `ray-marching`, `three-d-shape-and-space`, `lighting-and-materials`, `performance-and-craft`.

- [ ] **Step 12: Point the build script at the new content**

In `scripts/content/build-course.ts`, replace `moduleFiles` with the eleven new paths in position order, and bump the release id:

```ts
const moduleFiles = [
  "content/module-01-fragments.json",
  "content/module-02-shaping.json",
  "content/module-03-distance-fields.json",
  "content/module-04-colour.json",
  "content/module-05-space.json",
  "content/module-06-noise.json",
  "content/module-07-composition.json",
  "content/module-08-raymarching.json",
  "content/module-09-3d-shape.json",
  "content/module-10-lighting.json",
  "content/module-11-performance.json",
];
```

and in `buildBundledRelease`, `id: "bundled-2026-08-06"`. Delete the four old content files.

- [ ] **Step 13: Regenerate the bundled release and run everything**

`src/data/database/seed.ts` needs no change — it delegates to `ReleaseInstaller` rather than inserting rows itself, so Step 9 already covers seeding.

```bash
npm run content:build
npm run content:check
npx tsc --noEmit
npm test
```

Repository and installer tests asserting preset or section content will fail. The fixtures come from the regenerated `assets/course/bundled-course.json`, so expected values are Lesson 1.1's four stages. The substitution is mechanical — for example, in `src/data/course/__tests__/course-repository.test.ts`:

```ts
// Before
expect(lesson.presets.map(({ label }) => label)).toEqual([...]);
expect(lesson.sections).toHaveLength(3);

// After
expect(lesson.stages.map(({ title }) => title)).toEqual([
  "One colour, everywhere",
  "Where am I? Raw pixels",
  "Divide by the resolution",
  "Both axes at once",
]);
expect(lesson.stages[0].source).toContain("vec4(0.85");
```

Tests asserting 14 lessons or four published modules become one published module with one lesson. `PUBLISHED_LESSON_COUNT` in `src/context/data-context.tsx` is derived from the bundled JSON and needs no edit, but any test hardcoding 14 does.

- [ ] **Step 14: Commit**

```bash
git add src/data content scripts/content/build-course.ts assets/course/bundled-course.json
git commit -m "feat(content): carry runnable shader stages instead of preview keys"
```

---

### Task 2: Render stages in the lesson workspace

**Files:**
- Modify: `src/components/lesson-workspace.tsx`
- Test: `src/components/__tests__/lesson-workspace.test.tsx`
- Test: `src/app/__tests__/lesson.test.tsx` — its `findModule` helper reaches into the old lesson shape and fails to load after Task 1. It must be updated here; Task 1 correctly left it alone as out of scope.

**Interfaces:**
- Consumes: `LessonStage`, `CourseLesson` from `../data/course/types`; `ShaderSandbox` from `./shader-sandbox`.
- Produces: `LessonWorkspace` renders one stage at a time with forward/back navigation.

- [ ] **Step 1: Write the failing tests**

Rewrite `src/components/__tests__/lesson-workspace.test.tsx`. Keep its existing provider scaffolding; replace the preview mock target and every preset assertion.

```tsx
jest.mock("../shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text, View } = require("react-native") as typeof import("react-native");

  return {
    ShaderSandbox: ({ source }: { source: string }) =>
      React.createElement(View, { testID: "sandbox" }, React.createElement(Text, null, source)),
  };
});
```

```tsx
  it("opens on the first stage", async () => {
    await renderWorkspace();

    expect(screen.getByText("Stage 1 of 4")).toBeTruthy();
    expect(screen.getByTestId("sandbox")).toHaveTextContent(/vec4\(0\.85/);
  });

  it("advances to the next stage and shows its source", async () => {
    await renderWorkspace();

    await fireEvent.press(screen.getByLabelText("Next stage"));

    expect(screen.getByText("Stage 2 of 4")).toBeTruthy();
    expect(screen.getByTestId("sandbox")).toHaveTextContent(/400\.0/);
  });

  it("goes back", async () => {
    await renderWorkspace();

    await fireEvent.press(screen.getByLabelText("Next stage"));
    await fireEvent.press(screen.getByLabelText("Previous stage"));

    expect(screen.getByText("Stage 1 of 4")).toBeTruthy();
  });

  it("disables previous on the first stage and next on the last", async () => {
    await renderWorkspace();
    expect(screen.getByLabelText("Previous stage").props.accessibilityState.disabled).toBe(true);

    for (let i = 0; i < 3; i += 1) {
      await fireEvent.press(screen.getByLabelText("Next stage"));
    }

    expect(screen.getByLabelText("Next stage").props.accessibilityState.disabled).toBe(true);
  });

  it("shows the current stage's title and body", async () => {
    await renderWorkspace();

    expect(screen.getByText("One colour, everywhere")).toBeTruthy();
    expect(screen.getByText(/simplest possible shader/)).toBeTruthy();
  });

  it("shows the takeaway and the optional tryThis prompt", async () => {
    await renderWorkspace();

    expect(screen.getByText(/One function, run once per pixel/)).toBeTruthy();
    expect(screen.getByText(/Swap uv.x and uv.y/)).toBeTruthy();
  });
```

- [ ] **Step 2: Run and verify failure**

Run: `npx jest src/components/__tests__/lesson-workspace.test.tsx`

Expected: FAIL — the workspace still imports `live-shader-preview` and reads `lesson.presets`.

- [ ] **Step 3: Rewrite the workspace's state and preview**

In `src/components/lesson-workspace.tsx`: replace the `LessonPreset` import with `LessonStage`, replace `live-shader-preview` with `./shader-sandbox`, and replace `presetIndex`/`defaultPresetIndex`/`isRestartable`/`isAnimated` with:

```tsx
const [stageIndex, setStageIndex] = useState(0);
const stages = byPosition(lesson.stages);
const stage = stages[stageIndex] ?? stages[0];
```

Replace the preview block and preset switcher with:

```tsx
        <ShaderSandbox height={200} source={stage.source} />

        <View style={styles.stageBar}>
          <Pressable
            accessibilityLabel="Previous stage"
            accessibilityRole="button"
            accessibilityState={{ disabled: stageIndex === 0 }}
            disabled={stageIndex === 0}
            onPress={() => setStageIndex((index) => Math.max(0, index - 1))}
          >
            <Text style={styles.stageNav}>Back</Text>
          </Pressable>

          <Text style={styles.stageCount}>
            Stage {stageIndex + 1} of {stages.length}
          </Text>

          <Pressable
            accessibilityLabel="Next stage"
            accessibilityRole="button"
            accessibilityState={{ disabled: stageIndex === stages.length - 1 }}
            disabled={stageIndex === stages.length - 1}
            onPress={() => setStageIndex((index) => Math.min(stages.length - 1, index + 1))}
          >
            <Text style={styles.stageNav}>Next</Text>
          </Pressable>
        </View>

        <Text style={styles.stageTitle}>{stage.title}</Text>
        <Text style={styles.stageBody}>{stage.body}</Text>
```

Replace the sections list with the takeaway and `tryThis`:

```tsx
        <Text style={styles.takeaway}>{lesson.takeaway}</Text>
        {lesson.tryThis !== undefined && <Text style={styles.tryThis}>{lesson.tryThis}</Text>}
```

Delete every style whose preset or section element is gone, and add `stageBar`, `stageNav`, `stageCount`, `stageTitle`, `stageBody`, `tryThis` using `Colors`, `Spacing` and `Radius` from `../constants/theme`.

- [ ] **Step 4: Run tests, typecheck, commit**

```bash
npx jest src/components/__tests__/lesson-workspace.test.tsx
npx tsc --noEmit
npm test
git add src/components/lesson-workspace.tsx src/components/__tests__/lesson-workspace.test.tsx
git commit -m "feat(components): navigate lesson stages in the live sandbox"
```

---

### Task 3: Delete the preview machinery

**Files:**
- Delete: `src/shaders/preview-registry.ts`, `src/shaders/__tests__/preview-registry.test.ts`, `src/components/live-shader-preview.tsx`, `src/app/bonus-scanline.tsx`
- Modify: `src/app/index.tsx`
- Test: `src/app/__tests__/index.test.tsx`

**Interfaces:**
- Consumes: nothing. Produces: nothing. Pure removal.

- [ ] **Step 1: Confirm nothing still imports them**

```bash
grep -rn "preview-registry\|live-shader-preview\|bonus-scanline" src/ scripts/
```

Expected after Tasks 1 and 2: matches only in the files being deleted, plus the bonus card in `src/app/index.tsx` and any test asserting it.

- [ ] **Step 2: Write the failing test**

In `src/app/__tests__/index.test.tsx`, replace any assertion about the bonus tutorial with:

```tsx
  it("offers no bonus tutorial card", async () => {
    await renderHome();

    expect(screen.queryByText("Bonus tutorial")).toBeNull();
    expect(screen.queryByText("Recreate the Scanline S")).toBeNull();
  });
```

- [ ] **Step 3: Run and verify failure**

Run: `npx jest src/app/__tests__/index.test.tsx`

Expected: FAIL — the card still renders.

- [ ] **Step 4: Delete**

```bash
git rm src/shaders/preview-registry.ts src/shaders/__tests__/preview-registry.test.ts
git rm src/components/live-shader-preview.tsx src/app/bonus-scanline.tsx
```

In `src/app/index.tsx`, remove the `Pressable` block that pushes `/bonus-scanline` (around line 163) together with its styles, keeping the surrounding conditional branches intact.

- [ ] **Step 5: Run everything and commit**

```bash
npx tsc --noEmit
npm test
git add -A src/
git commit -m "refactor(shaders): delete the u_mode preview chain"
```

---

### Task 4: Rewrite the authoring guide

**Files:**
- Modify: `docs/data/local-curriculum.md`
- Modify: `README.md`

- [ ] **Step 1: Rewrite the guide**

Replace `docs/data/local-curriculum.md` wholesale. It must cover, in this order:

1. **Where content lives** — the eleven files, one per module, in position order.
2. **The lesson shape** — intro, 3–5 stages, takeaway, optional `tryThis`. State the word minimums (intro 40, stage body 40, takeaway 20) and that `content:check` enforces them.
3. **Writing a stage's source** — a complete `mainImage` body, GLSL ES 1.00, `iResolution` and `iTime` only. List `SHADER_SOURCE_FORBIDDEN_TOKENS` and explain that each entry is either supplied by the wrapper or a capability the app lacks. Link `docs/data/shader-sandbox.md`.
4. **Why stages duplicate each other** — complete source per stage rather than diffs, and what that buys.
5. **The build workflow** — `npm run content:build`, `npm run content:check`, commit the regenerated `assets/course/bundled-course.json`.
6. **Release ids and checksums** — editing content without bumping the id in `build-course.ts` makes `release-installer.ts` reject the install, since the id matches but the checksum does not.
7. **Published versus planned modules** — planned modules carry `plannedTopics` equal in length to `plannedLessonCount`, and those topics are real lesson goals from the syllabus spec, not placeholders.
8. **Teaching order** — no lesson may use a technique a later lesson introduces, with a pointer to the syllabus spec as the authority on order.

Delete every reference to `previewKey`, `previewParameters`, preview parameters, presets, sections, and the preview registry.

- [ ] **Step 2: Update the README**

In the features list, replace the three lines describing the old module structure with the eleven-module arc and note that Module 1 is published while the rest are planned. In the technology list, drop any mention of preview keys.

- [ ] **Step 3: Verify no stale references and commit**

```bash
grep -rn "previewKey\|previewParameters\|preview registry\|preview-registry" docs/ README.md
```

Expected: no matches.

```bash
git add docs/data/local-curriculum.md README.md
git commit -m "docs(data): rewrite the authoring guide for stages"
```

---

### Task 5: Author Module 1 lessons 2 through 5

Pure content. No code changes, which is the property Tasks 1–4 exist to create.

**Files:**
- Modify: `content/module-01-fragments.json`
- Modify: `assets/course/bundled-course.json` (regenerated)

**Interfaces:** Consumes the schema from Task 1. Produces no new API.

- [ ] **Step 1: Author lesson 2 — "From pixels to UV"**

Four stages, building on Lesson 1: the y axis and which corner is the origin; `iResolution.xy` versus `iResolution.z`; a gradient that survives rotation of the device; and a note that other codebases call this `u_resolution` and declare it `vec2`, so their code needs `.xy` appended here. Every body ≥ 40 words. No `step`, `smoothstep`, `mix`, `clamp`, or shape functions.

- [ ] **Step 2: Author lesson 3 — "Centre and aspect"**

Four stages: remap 0…1 to −1…1 by doubling and subtracting one; show that a circle-ish radial gradient is an ellipse on a non-square screen; multiply x by `iResolution.x / iResolution.y` to fix it; confirm the centre is now exactly `(0, 0)`. `length()` is permitted here as a measurement, since Module 3 introduces it as a *shape* tool rather than as arithmetic — say so in the body.

- [ ] **Step 3: Author lesson 4 — "Time as an input"**

Four stages: `iTime` driving brightness directly, so it climbs and clips; `sin(iTime)` for a bounded oscillation; multiplying time to change speed; and why elapsed seconds rather than a frame counter keeps motion identical on a 60Hz and a 120Hz screen. Mention `u_time` and `iGlobalTime` as names found elsewhere.

- [ ] **Step 4: Author lesson 5 — "Reading shaders from elsewhere"**

Four stages, and the only lesson whose subject is the tooling rather than the maths: the body you write; the complete program it compiles into, quoted from `docs/data/shader-sandbox.md` and shown as prose rather than as `source` (the forbidden-token rule will reject `precision` and `void main(` in a stage's source, which is correct — this stage discusses them, it does not compile them); the same shader written in `u_*` naming; and what changes under GLSL ES 3.00.

Because the wrapper cannot appear in `source`, stage two's shader stays a normal body while its *body text* carries the full program. Verify `content:check` passes rather than assuming it.

- [ ] **Step 5: Rebuild, verify, commit**

```bash
npm run content:build
npm run content:check
npm test
git add content assets/course/bundled-course.json
git commit -m "content(module-01): author the remaining four lessons"
```

- [ ] **Step 6: Device check**

Run `npm start`, open Course, and walk all five lessons. Confirm each stage compiles, the preview animates in lesson 4, stage navigation bounds correctly at both ends, and no lesson uses a technique its predecessors have not introduced.

---

## Follow-On Work, Not In This Plan

- **Supabase release format.** `content_presets`, `publish_course_release` and `get_course_release` still speak presets and sections, so `npm run content:publish` would emit a release no device can parse. Its own plan, required before anyone publishes.
- **Modules 2–7 authoring.** ~27 lessons, pure content against the schema this plan builds.
- **Act 2 lesson design.** Modules 8–11 need their own spec before authoring.
- **Tutorials section.** Sub-project 3.
