# Local SQLite Curriculum Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace module-specific TypeScript curriculum imports and AsyncStorage progress with a validated, fully offline SQLite curriculum and progress repository while preserving existing user progress and lesson behavior.

**Architecture:** Version-controlled module JSON is validated into one generated bundled release. Expo SQLite stores the active release, learner profiles, explicit progress, and a future-ready outbox. React providers read only repository APIs; all lesson routes use one database-backed lesson workspace.

**Tech Stack:** Expo SDK 57, React Native 0.86, TypeScript 6, `expo-sqlite`, `expo-crypto`, AsyncStorage for one-time migration only, Zod, Jest with `jest-expo`, `tsx` for content tooling.

## Global Constraints

- Read the exact Expo SDK 57 documentation at https://docs.expo.dev/versions/v57.0.0/ before implementation.
- The complete published curriculum must work without connectivity.
- SQLite is the only runtime curriculum and progress source read by screens.
- Existing `@shadercraft/progress/v1` completion data must migrate automatically and idempotently.
- Curriculum IDs are stable and never reused.
- Module 4 remains visible as `planned` but contributes no lessons to progress totals.
- Remote execution and Supabase integration are outside this plan.
- Every task ends in a focused commit and leaves the application runnable.

---

## File Structure

### Authoring and generated data

- `content/module-01-foundations.json` — authored Module 1 curriculum.
- `content/module-02-shapes.json` — authored Module 2 curriculum.
- `content/module-03-color-light.json` — authored Module 3 curriculum.
- `content/module-04-textures.json` — planned Module 4 roadmap metadata.
- `assets/course/bundled-course.json` — generated, checksummed release imported on installation.
- `scripts/content/build-course.ts` — validates authoring files and emits the bundled release.

### Domain and validation

- `src/data/course/types.ts` — shared curriculum domain types.
- `src/data/course/schema.ts` — Zod authoring/release schemas and validation functions.
- `src/data/course/domain.ts` — pure ordering, unlocking, and progress calculations.
- `src/shaders/preview-registry.ts` — preview key union, numeric shader mode map, and validation.

### SQLite and repositories

- `src/data/database/client.ts` — Expo SQLite open/configure lifecycle.
- `src/data/database/driver.ts` — platform-neutral database operations used by repositories.
- `src/data/database/expo-sqlite-driver.ts` — production Expo SQLite adapter.
- `src/data/database/testing/node-sqlite-driver.ts` — Node 22 in-memory SQLite adapter for tests.
- `src/data/database/migrations.ts` — ordered, transactional schema migrations.
- `src/data/database/seed.ts` — bundled release installation.
- `src/data/course/course-repository.ts` — course repository interface.
- `src/data/course/sqlite-course-repository.ts` — SQLite course queries and mapping.
- `src/data/progress/progress-repository.ts` — progress repository interface.
- `src/data/progress/sqlite-progress-repository.ts` — local mutation/outbox implementation.
- `src/data/progress/legacy-import.ts` — one-time AsyncStorage migration.
- `src/context/data-context.tsx` — database readiness and repository instances.
- `src/context/course-context.tsx` — reactive course snapshot and refresh API.
- `src/context/progress-context.tsx` — retained public progress API backed by SQLite.

### UI consolidation

- `src/app/lesson.tsx` — single database-backed route for every published lesson.
- `src/components/lesson-workspace.tsx` — reusable lesson content and Try It renderer.
- `src/app/index.tsx` — repository-backed Home screen.
- `src/app/course.tsx` — repository-backed curriculum screen.
- Remove `src/app/module-two-lesson.tsx`, `src/app/module-three-lesson.tsx`,
  `src/lib/curriculum.ts`, `src/lib/module-two-content.ts`, and
  `src/lib/module-three-content.ts` after migration.

---

### Task 1: Add the test harness and extract the preview registry

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `jest.config.js`
- Create: `src/shaders/preview-registry.ts`
- Create: `src/shaders/__tests__/preview-registry.test.ts`
- Modify: `src/components/live-shader-preview.tsx`

**Interfaces:**
- Produces: `ShaderPreviewKey`, `SHADER_PREVIEW_MODE_VALUES`, `isPreviewKey(value)`.
- Consumes: Existing preview names and numeric values from `LiveShaderPreview`.

- [ ] **Step 1: Install the test tooling using Expo-compatible versions**

Run:

```bash
npx expo install jest-expo jest @types/jest --dev
npm install --save-dev @testing-library/react-native react-test-renderer@19.2.3 @types/react-test-renderer
```

Add `"test": "jest"` and `"test:watch": "jest --watch"` to `package.json`.

- [ ] **Step 2: Configure Jest**

Create `jest.config.js`:

```js
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.test.tsx"],
};
```

- [ ] **Step 3: Write the failing preview-registry test**

```ts
import {
  isPreviewKey,
  SHADER_PREVIEW_MODE_VALUES,
} from "../preview-registry";

describe("preview registry", () => {
  it("recognizes every current preview and rejects unknown remote keys", () => {
    expect(SHADER_PREVIEW_MODE_VALUES["lighting-final"]).toBe(59);
    expect(isPreviewKey("edge-smooth")).toBe(true);
    expect(isPreviewKey("remote-arbitrary-shader")).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test and verify the missing module failure**

Run: `npm test -- --runInBand src/shaders/__tests__/preview-registry.test.ts`

Expected: FAIL because `preview-registry.ts` does not exist.

- [ ] **Step 5: Move the preview type and numeric map into the registry**

Move the complete `modeValue` object currently inside `LiveShaderPreview.render` into
`src/shaders/preview-registry.ts`, rename it `SHADER_PREVIEW_MODE_VALUES`, export it, and preserve
every existing key and numeric value from `0` through `59`. Append these exports beneath the moved
object:

```ts
export type ShaderPreviewKey = keyof typeof SHADER_PREVIEW_MODE_VALUES;

export function isPreviewKey(value: string): value is ShaderPreviewKey {
  return Object.hasOwn(SHADER_PREVIEW_MODE_VALUES, value);
}
```

Replace the local union and render-loop map in `live-shader-preview.tsx` with imports. Preserve the
public compatibility alias:

```ts
export type ShaderPreviewMode = ShaderPreviewKey;
```

- [ ] **Step 6: Verify tests and TypeScript**

Run:

```bash
npm test -- --runInBand src/shaders/__tests__/preview-registry.test.ts
npx tsc --noEmit
```

Expected: PASS, and the Android preview mode numbers remain unchanged.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json jest.config.js src/shaders src/components/live-shader-preview.tsx
git commit -m "test(shaders): establish the preview capability registry"
```

### Task 2: Define and test the curriculum authoring schema

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/data/course/types.ts`
- Create: `src/data/course/schema.ts`
- Create: `src/data/course/__tests__/schema.test.ts`

**Interfaces:**
- Consumes: `ShaderPreviewKey`, `isPreviewKey` from Task 1.
- Produces: `CourseRelease`, `CourseModule`, `CourseLesson`, `LessonPreset`,
  `parseAuthoredModules(value)`, `parseCourseRelease(value)`.

- [ ] **Step 1: Install shared validation and script tooling**

Run:

```bash
npm install zod
npm install --save-dev tsx @types/node
```

- [ ] **Step 2: Write failing schema tests**

Create fixtures inline in `schema.test.ts` and assert:

```ts
expect(() => parseAuthoredModules(validModules)).not.toThrow();
expect(() => parseAuthoredModules(duplicateLessonIds)).toThrow(/duplicate lesson id/i);
expect(() => parseAuthoredModules(unknownPreviewKey)).toThrow(/preview key/i);
expect(() => parseAuthoredModules(outOfRangeHighlight)).toThrow(/highlighted line/i);
expect(() => parseAuthoredModules(publishedModuleWithoutLessons)).toThrow(/published module/i);
expect(() => parseAuthoredModules(plannedModuleWithLessons)).toThrow(/planned module/i);
```

The valid fixture must contain one published lesson with one preset and one planned module with
`plannedLessonCount` and `plannedTopics`.

- [ ] **Step 3: Run the schema tests and verify failure**

Run: `npm test -- --runInBand src/data/course/__tests__/schema.test.ts`

Expected: FAIL because the course schema and parser are absent.

- [ ] **Step 4: Add exact domain types**

Define:

```ts
export type ModuleStatus = "published" | "planned";

export type LessonPreset = {
  id: string;
  position: number;
  label: string;
  previewKey: ShaderPreviewKey;
  previewParameters: Record<string, boolean | number | string>;
  value: string;
  filename: string;
  codeLines: string[];
  highlightedLines: number[];
};

export type CourseLesson = {
  id: string;
  moduleId: string;
  position: number;
  title: string;
  shortTitle: string;
  intro: string;
  conceptTitle: string;
  conceptLede: string;
  tryHint: string;
  takeaway: string;
  presets: LessonPreset[];
  sections: { id: string; position: number; title: string; body: string }[];
};

export type CourseModule = {
  id: string;
  position: number;
  status: ModuleStatus;
  title: string;
  description: string;
  plannedLessonCount: number;
  plannedTopics: string[];
  lessons: CourseLesson[];
};

export type CourseRelease = {
  id: string;
  schemaVersion: 1;
  minimumAppVersion: string;
  checksum: string;
  modules: CourseModule[];
};
```

- [ ] **Step 5: Implement Zod structural and cross-record validation**

Use strict Zod objects. After parsing, perform cross-record validation that:

- IDs match `^[a-z0-9]+(?:-[a-z0-9]+)*$` and are globally unique by entity type.
- Positions are unique and contiguous from `1` inside each parent.
- Published modules contain at least one complete lesson.
- Published modules use `plannedLessonCount: 0` and an empty `plannedTopics` array.
- Planned modules contain no lesson rows and provide matching planned count/topic length.
- Every preview key passes `isPreviewKey`.
- Every highlighted line is an integer between `1` and `codeLines.length`.
- `minimumAppVersion` matches `^\d+\.\d+\.\d+$`.

- [ ] **Step 6: Run tests and TypeScript**

Run:

```bash
npm test -- --runInBand src/data/course/__tests__/schema.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/data/course
git commit -m "feat(content): define the validated curriculum schema"
```

### Task 3: Convert the existing curriculum into authoring JSON and generate the bundled release

**Files:**
- Create: `content/module-01-foundations.json`
- Create: `content/module-02-shapes.json`
- Create: `content/module-03-color-light.json`
- Create: `content/module-04-textures.json`
- Create: `scripts/content/build-course.ts`
- Create: `assets/course/bundled-course.json`
- Create: `src/data/course/__tests__/bundled-course.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseAuthoredModules` and `CourseRelease` from Task 2.
- Produces: deterministic `assets/course/bundled-course.json` and `npm run content:check`.

- [ ] **Step 1: Write the failing bundled-content test**

```ts
import bundledCourse from "../../../../assets/course/bundled-course.json";
import { parseCourseRelease } from "../schema";

it("contains the complete current curriculum", () => {
  const release = parseCourseRelease(bundledCourse);
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
```

- [ ] **Step 2: Run the test and verify the missing generated asset failure**

Run: `npm test -- --runInBand src/data/course/__tests__/bundled-course.test.ts`

Expected: FAIL because the bundled course does not exist.

- [ ] **Step 3: Create the four authoring files from current source data**

Transcribe, without rewriting copy or shader examples:

- Module 1 lesson metadata, presets, code lines, sections, and highlights from `src/app/lesson.tsx`.
- Module 2 from `src/lib/module-two-content.ts` and `MODULE_TWO_LESSONS`.
- Module 3 from `src/lib/module-three-content.ts` and `MODULE_THREE_LESSONS`.
- Module 4 title, description, five-topic roadmap, and planned count from `src/app/course.tsx`.

Assign stable preset IDs based on their preview keys and stable section IDs based on lesson ID plus
section position. Preserve all 56 preview keys and their current highlighted lines.

- [ ] **Step 4: Implement deterministic release generation**

The script must:

```ts
const moduleFiles = [
  "content/module-01-foundations.json",
  "content/module-02-shapes.json",
  "content/module-03-color-light.json",
  "content/module-04-textures.json",
];
```

Parse all files, sort by explicit position, canonicalize object keys, calculate a SHA-256 checksum
over the release without its checksum field, and write:

```ts
{
  id: "bundled-2026-08-03",
  schemaVersion: 1,
  minimumAppVersion: "1.0.0",
  checksum,
  modules: parsedModules,
}
```

Support `--check`: generate in memory, compare with the tracked asset, and exit nonzero when stale.
Add scripts:

```json
"content:build": "tsx scripts/content/build-course.ts",
"content:check": "tsx scripts/content/build-course.ts --check"
```

- [ ] **Step 5: Generate and validate the bundled release**

Run:

```bash
npm run content:build
npm run content:check
npm test -- --runInBand src/data/course/__tests__/bundled-course.test.ts
npx tsc --noEmit
```

Expected: all commands PASS and the generated release has 4 modules, 14 published lessons, and 56
presets.

- [ ] **Step 6: Commit**

```bash
git add content assets/course scripts/content package.json src/data/course/__tests__
git commit -m "feat(content): generate the bundled course from authored modules"
```

### Task 4: Add the SQLite lifecycle and transactional schema migrations

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/data/database/client.ts`
- Create: `src/data/database/driver.ts`
- Create: `src/data/database/expo-sqlite-driver.ts`
- Create: `src/data/database/testing/node-sqlite-driver.ts`
- Create: `src/data/database/migrations.ts`
- Create: `src/data/database/__tests__/migrations.test.ts`
- Modify: `src/app/_layout.tsx`

**Interfaces:**
- Produces: `DatabaseDriver`, `ExpoSqliteDriver`, `NodeSqliteDriver`,
  `openShadercraftDatabase()`, `migrateDatabase(driver)`, `LATEST_SCHEMA_VERSION`.
- Consumes: Expo SDK 57 `SQLiteDatabase`; tests consume Node 22 `node:sqlite`.

- [ ] **Step 1: Install Expo SQLite**

Run:

```bash
npx expo install expo-sqlite expo-crypto
```

- [ ] **Step 2: Write failing migration-selection tests**

```ts
const driver = new NodeSqliteDriver(":memory:");
await migrateDatabase(driver);
expect(await driver.first<{ user_version: number }>("PRAGMA user_version")).toEqual({
  user_version: 1,
});
expect(getPendingMigrations(0).map((migration) => migration.version)).toEqual([1]);
expect(getPendingMigrations(LATEST_SCHEMA_VERSION)).toEqual([]);
expect(() => getPendingMigrations(LATEST_SCHEMA_VERSION + 1)).toThrow(/newer schema/i);
```

- [ ] **Step 3: Run the test and verify failure**

Run: `npm test -- --runInBand src/data/database/__tests__/migrations.test.ts`

Expected: FAIL because migrations do not exist.

- [ ] **Step 4: Implement the shared driver and both adapters**

```ts
export type SqlValue = string | number | null | Uint8Array;

export interface DatabaseDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: readonly SqlValue[]): Promise<{ changes: number; lastInsertRowId: number }>;
  first<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
```

`ExpoSqliteDriver` delegates to Expo SQLite async methods and `withTransactionAsync`.
`NodeSqliteDriver` wraps Node 22 `DatabaseSync` and exposes promises so production and test code use
the same contract. Keep `node-sqlite-driver.ts` out of all production imports.

- [ ] **Step 5: Implement migration 1**

Migration 1 creates the exact tables from the approved spec, including:

- Composite release-scoped primary keys for modules, lessons, presets, and sections.
- `learner_profiles` with anonymous/authenticated kind constraint and nullable
  `merged_into_profile_id` self-reference.
- Composite `(profile_id, lesson_id)` progress key.
- Profile-partitioned outbox and sync state; outbox rows include nullable `merged_at`.
- `app_metadata(key PRIMARY KEY, value NOT NULL)` for active release and import markers.
- Foreign keys with `ON DELETE CASCADE` for staged curriculum releases.
- Indexes on ordered module/lesson queries and pending outbox creation time.

Wrap each migration with `driver.transaction`, set `PRAGMA user_version`, and configure:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

- [ ] **Step 6: Implement database opening**

```ts
export async function openShadercraftDatabase() {
  const db = await SQLite.openDatabaseAsync("shadercraft.db");
  const driver = new ExpoSqliteDriver(db);
  await driver.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  await migrateDatabase(driver);
  return driver;
}
```

Do not mount screens until opening and migrations resolve. Add a temporary loading/error boundary in
`_layout.tsx`; Task 7 replaces it with `DataProvider`.

- [ ] **Step 7: Verify**

Run:

```bash
npm test -- --runInBand src/data/database/__tests__/migrations.test.ts
npx tsc --noEmit
```

Then launch Android and verify a new `shadercraft.db` opens without a red screen.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/data/database src/app/_layout.tsx
git commit -m "feat(data): add the versioned SQLite lifecycle"
```

### Task 5: Install the bundled release and implement the course repository

**Files:**
- Create: `src/data/database/seed.ts`
- Create: `src/data/course/course-repository.ts`
- Create: `src/data/course/sqlite-course-repository.ts`
- Create: `src/data/course/domain.ts`
- Create: `src/data/course/__tests__/domain.test.ts`
- Create: `src/data/course/__tests__/course-repository.test.ts`

**Interfaces:**
- Produces: `installBundledRelease(db, release)`, `CourseRepository`,
  `SqliteCourseRepository`, pure unlock/progress selectors.
- Consumes: `CourseRelease`, SQLite database from Task 4.

- [ ] **Step 1: Write failing domain tests**

Cover exact outcomes:

```ts
expect(getPublishedLessonCount(release)).toBe(14);
expect(getModuleStatus(module2, completedModule1Ids)).toBe("available");
expect(getModuleStatus(plannedModule4, completedModule3Ids)).toBe("planned");
expect(isLessonUnlocked(module2.lessons[1], module2.lessons, [module2.lessons[0].id])).toBe(true);
expect(getProgressPercent(release, allPublishedLessonIds)).toBe(100);
```

- [ ] **Step 2: Write failing repository contract tests**

Against `NodeSqliteDriver(":memory:")` after migrations and bundled-release installation, assert:

```ts
await expect(repository.getModules()).resolves.toHaveLength(4);
await expect(repository.getLesson("color-mixing")).resolves.toMatchObject({
  moduleId: "color-light",
  presets: expect.any(Array),
});
await expect(repository.getLesson("missing")).resolves.toBeNull();
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/course/__tests__`

Expected: FAIL because domain functions and repository are absent.

- [ ] **Step 4: Implement atomic bundled release installation**

`installBundledRelease` must parse the generated asset again, insert the release and normalized rows
inside one transaction, then set `app_metadata.active_release_id`. If the release ID already exists
and its checksum matches, return without rewriting rows. A checksum mismatch for the same release ID
is an error.

- [ ] **Step 5: Implement the repository interface**

```ts
export interface CourseRepository {
  getActiveRelease(): Promise<CourseRelease>;
  getModules(): Promise<CourseModule[]>;
  getLesson(lessonId: string): Promise<CourseLesson | null>;
  getPublishedLessonIds(): Promise<string[]>;
  subscribe(listener: () => void): () => void;
}
```

The SQLite implementation queries only the active release and reconstructs ordered nested records.
Repository mutations later call an internal notifier; screens never subscribe to SQLite directly.

- [ ] **Step 6: Run tests, content validation, and TypeScript**

Run:

```bash
npm run content:check
npm test -- --runInBand src/data/course
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/database/seed.ts src/data/course
git commit -m "feat(course): read the bundled curriculum through SQLite"
```

### Task 6: Implement local progress and idempotent AsyncStorage import

**Files:**
- Create: `src/data/progress/progress-repository.ts`
- Create: `src/data/progress/sqlite-progress-repository.ts`
- Create: `src/data/progress/legacy-import.ts`
- Create: `src/data/progress/__tests__/legacy-import.test.ts`
- Create: `src/data/progress/__tests__/progress-repository.test.ts`
- Modify: `src/lib/progress.ts`

**Interfaces:**
- Produces: `ProgressRepository`, `SqliteProgressRepository`,
  `importLegacyProgress(storage, repository)`.
- Consumes: published lesson IDs from `CourseRepository` and current AsyncStorage key.

- [ ] **Step 1: Write failing legacy-import tests**

Test valid, malformed, duplicate, unknown, and resumed imports. The resumed case must pre-set the
SQLite marker while leaving AsyncStorage intact, then assert cleanup runs without reinserting rows.

```ts
expect(await repository.getCompletedLessonIds()).toEqual([
  "coordinate-systems-uv-space",
  "colors-fragment-output",
]);
expect(storage.removeItem).toHaveBeenCalledWith("@shadercraft/progress/v1");
```

- [ ] **Step 2: Write failing local-mutation tests**

```ts
await repository.setLessonCompleted("color-mixing", true);
expect(await repository.isLessonCompleted("color-mixing")).toBe(true);
expect(await repository.getPendingMutations()).toHaveLength(1);

await repository.setLessonCompleted("color-mixing", false);
expect(await repository.isLessonCompleted("color-mixing")).toBe(false);
expect(await repository.getPendingMutations()).toHaveLength(2);
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/progress/__tests__`

Expected: FAIL because progress repositories are absent.

- [ ] **Step 4: Implement the repository contract**

```ts
export interface ProgressRepository {
  getActiveProfileId(): Promise<string>;
  getCompletedLessonIds(): Promise<string[]>;
  isLessonCompleted(lessonId: string): Promise<boolean>;
  setLessonCompleted(lessonId: string, completed: boolean): Promise<void>;
  getPendingMutations(): Promise<ProgressMutation[]>;
  subscribe(listener: () => void): () => void;
}
```

Use these shared types:

```ts
export type LearnerProfile = {
  id: string;
  kind: "anonymous" | "authenticated";
  supabaseUserId: string | null;
  mergedIntoProfileId: string | null;
};

export type ProgressMutation = {
  profileId: string;
  mutationId: string;
  lessonId: string;
  completed: boolean;
  baseRevision: number;
  attempts: number;
  createdAt: string;
};
```

Create the first anonymous profile when none exists. `setLessonCompleted` upserts the explicit row
and inserts a mutation whose ID comes from `Crypto.randomUUID()` in one transaction. Repeated
requests for the already-current explicit state return without another mutation.

- [ ] **Step 5: Implement the legacy import protocol**

Use the exact seven-step flow from the design. Unknown string IDs remain rows but visible totals are
calculated by intersecting with published lesson IDs. Delete `src/lib/progress.ts` only after the
provider migration in Task 7; for this task reduce it to legacy parsing helpers used by the importer.

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- --runInBand src/data/progress
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data/progress src/lib/progress.ts
git commit -m "feat(progress): persist local progress and migrate legacy data"
```

### Task 7: Provide repository-backed application state

**Files:**
- Create: `src/context/data-context.tsx`
- Create: `src/context/course-context.tsx`
- Create: `src/context/__tests__/course-context.test.tsx`
- Modify: `src/context/progress-context.tsx`
- Modify: `src/app/_layout.tsx`
- Remove: `src/lib/progress.ts`

**Interfaces:**
- Produces: `useData()`, `useCourse()`, retained `useProgress()` API.
- Consumes: repositories from Tasks 5 and 6.

- [ ] **Step 1: Write failing provider tests**

With fake repositories, verify hydration and refresh after subscription notification:

```tsx
expect(result.current.isHydrated).toBe(false);
await waitFor(() => expect(result.current.modules).toHaveLength(4));
act(() => fakeCourseRepository.emit());
await waitFor(() => expect(fakeCourseRepository.getModules).toHaveBeenCalledTimes(2));
```

Also assert `completeLesson` and `uncompleteLesson` retain their existing signatures.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --runInBand src/context/__tests__/course-context.test.tsx`

Expected: FAIL because the data and course providers are absent.

- [ ] **Step 3: Implement `DataProvider` initialization**

On mount:

1. Open and migrate SQLite.
2. Parse and install the bundled release.
3. Create the SQLite repositories.
4. Run legacy progress import.
5. Expose repositories only after all steps succeed.

Expose explicit `loading`, `ready`, and `error` states with a retry action. Do not catch and ignore
database initialization errors.

- [ ] **Step 4: Implement course and progress providers**

`CourseProvider` loads modules and active release, subscribes to course repository invalidations,
and exposes `getLesson(id)`. Refactor `ProgressProvider` to load explicit progress from SQLite and
subscribe to both progress and course invalidations. Calculate percentage against the active
release's published lesson IDs only, so a curriculum activation refreshes totals immediately.

- [ ] **Step 5: Wire provider order in root layout**

```tsx
<DataProvider>
  <CourseProvider>
    <ProgressProvider>
      <StatusBar style="light" />
      <Stack screenOptions={screenOptions} />
    </ProgressProvider>
  </CourseProvider>
</DataProvider>
```

- [ ] **Step 6: Verify tests and TypeScript**

Run:

```bash
npm test -- --runInBand src/context
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/context src/app/_layout.tsx src/lib/progress.ts
git commit -m "feat(data): expose SQLite course and progress providers"
```

### Task 8: Move Home and Course to repository data

**Files:**
- Modify: `src/app/index.tsx`
- Modify: `src/app/course.tsx`
- Modify: `src/components/course-module-card.tsx`
- Create: `src/data/course/__tests__/navigation-model.test.ts`

**Interfaces:**
- Consumes: `useCourse()`, `useProgress()`, domain selectors.
- Produces: no new public interface.

- [ ] **Step 1: Write failing navigation-model tests**

Assert the database-derived presentation model:

```ts
expect(model.featuredLesson.id).toBe("coordinate-systems-uv-space");
expect(completedModule2Model.featuredLesson.id).toBe("color-mixing");
expect(completedModule3Model.modules[3].status).toBe("planned");
expect(completedModule3Model.progressPercent).toBe(100);
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- --runInBand src/data/course/__tests__/navigation-model.test.ts`

Expected: FAIL because the navigation presentation selector is absent.

- [ ] **Step 3: Implement the pure presentation selector**

Build Home/Course view models from `CourseModule[]`, completed IDs, and hydration state. Planned
modules expose their planned count/topics, never a lesson route.

- [ ] **Step 4: Replace hardcoded arrays and counts in both screens**

Remove imports from `src/lib/curriculum.ts` and the local `modules` constant in `course.tsx`. Route
every published lesson to:

```ts
router.push({ pathname: "/lesson", params: { lessonId } });
```

For Module 4, preserve the current coming-next alert using its database status rather than its
numeric module position.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --runInBand src/data/course/__tests__/navigation-model.test.ts
npx tsc --noEmit
```

On Android, verify Home and Course show 4 modules, 14 published lessons, Module 4 as planned, and
100% after the 14th completion.

- [ ] **Step 6: Commit**

```bash
git add src/app/index.tsx src/app/course.tsx src/components/course-module-card.tsx src/data/course
git commit -m "refactor(course): render navigation from the SQLite curriculum"
```

### Task 9: Consolidate every published lesson onto one repository-backed route

**Files:**
- Create: `src/components/lesson-workspace.tsx`
- Modify: `src/app/lesson.tsx`
- Modify: `src/components/live-shader-preview.tsx`
- Remove: `src/app/module-two-lesson.tsx`
- Remove: `src/app/module-three-lesson.tsx`
- Remove: `src/lib/curriculum.ts`
- Remove: `src/lib/module-two-content.ts`
- Remove: `src/lib/module-three-content.ts`
- Create: `src/components/__tests__/lesson-workspace.test.tsx`

**Interfaces:**
- Consumes: `CourseLesson`, `useCourse()`, `useProgress()`, `LiveShaderPreview`.
- Produces: one `/lesson?lessonId=color-mixing` route shape for all 14 published stable lesson IDs.

- [ ] **Step 1: Write failing lesson-workspace tests**

Render a lesson fixture and assert:

```tsx
expect(screen.getByText("Palette albedo")).toBeTruthy();
fireEvent.press(screen.getByText("Diffuse light"));
expect(screen.getByText("float diffuse = max(dot(normal, lightDir), 0.0);")).toBeTruthy();
expect(screen.getByText("2")).toBeTruthy();
```

Add tests for multiple highlighted lines, a restartable animated preset, completion, undo, next
lesson navigation, and locked deep-link fallback.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm test -- --runInBand src/components/__tests__/lesson-workspace.test.tsx`

Expected: FAIL because the generic workspace does not exist.

- [ ] **Step 3: Extract a generic workspace from the Module 3 screen**

The component accepts:

```ts
type LessonWorkspaceProps = {
  lesson: CourseLesson;
  moduleTitle: string;
  lessonIndex: number;
  lessonCount: number;
  completed: boolean;
  hydrated: boolean;
  progressPercent: number;
  onComplete(): Promise<void>;
  onUndo(): Promise<void>;
  onBack(): void;
  onNext(): void;
};
```

Use `preset.highlightedLines.includes(index + 1)` and pass `previewKey` to `LiveShaderPreview`.
Honor a validated `restartable` preview parameter by showing the existing restart control.

- [ ] **Step 4: Replace the route implementation**

`lesson.tsx` loads the requested lesson from `CourseRepository`, checks sequential unlock state,
falls back to the current unlocked lesson, and renders `LessonWorkspace`. Completion navigates with
`router.replace` to the next lesson or Course.

- [ ] **Step 5: Remove obsolete routes and TypeScript content**

After all links target `/lesson`, remove the two module-specific routes and old curriculum files.
Ensure the bonus Scanline S tutorial remains code-backed because it is not a progress-bearing course
lesson in this migration.

- [ ] **Step 6: Verify all lesson modes**

Run:

```bash
npm test -- --runInBand src/components/__tests__/lesson-workspace.test.tsx
npm run content:check
npm test -- --runInBand
npx tsc --noEmit
git diff --check
```

On Android, open the first and last lesson of every published module, change all four presets, verify
the correct lines highlight, complete/undo one lesson, and confirm Back behavior remains linear.

- [ ] **Step 7: Commit**

```bash
git add src/app src/components src/lib src/data content assets/course
git commit -m "refactor(lessons): load every course lesson from SQLite"
```

### Task 10: Document and verify the offline local foundation

**Files:**
- Modify: `README.md`
- Create: `docs/data/local-curriculum.md`

**Interfaces:**
- Consumes: completed Tasks 1–9.
- Produces: contributor workflow for editing, generating, and validating curriculum.

- [ ] **Step 1: Document the author workflow**

Document these exact commands:

```bash
npm run content:build
npm run content:check
npm test -- --runInBand
npx tsc --noEmit
```

Explain that authors edit `content/module-*.json`, generated content must be committed, and preview
keys require app support.

- [ ] **Step 2: Run the full verification suite**

Run:

```bash
npm run content:check
npm test -- --runInBand
npx tsc --noEmit
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Run the Android offline acceptance pass**

Verify:

- Existing AsyncStorage completions survive the upgrade.
- Relaunching in airplane mode shows all 14 published lessons.
- Completion and undo persist across a process restart.
- Module 4 remains a planned five-topic card.
- Every GL preview compiles without React Native or Android runtime errors.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/data/local-curriculum.md
git commit -m "docs(data): explain the offline curriculum workflow"
```
