import { createHash } from "node:crypto";

import bundledCourse from "../../../../assets/course/bundled-course.json";

import { calculateNodeReleaseChecksum } from "../../../../scripts/content/node-checksum";
import type { SqlValue } from "../../database/driver";
import type { ReleaseLike } from "../canonicalize";
import { migrateDatabase } from "../../database/migrations";
import { installBundledRelease } from "../../database/seed";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import {
  ACTIVE_RELEASE_KEY,
  PREVIOUS_ACTIVE_RELEASE_KEY,
  ReleaseInstaller,
  verifyReleaseChecksum,
} from "../release-installer";
import { parseCourseRelease } from "../schema";
import { SqliteCourseRepository } from "../sqlite-course-repository";
import type { CourseRelease } from "../types";

const TEST_TUTORIAL_TEMPLATE = "float value = /*__SHADERCRAFT_BLANK__*/;\nfragColor = vec4(vec3(value), 1.0);";
const TEST_TUTORIAL_CHOICES = [
  { id: "answer-15", fragment: "0.15" },
  { id: "answer-35", fragment: "0.35" },
  { id: "answer-55", fragment: "0.55" },
  { id: "answer-75", fragment: "0.75" },
];

const bundledCourseWithChoiceTutorialsInput = {
  ...bundledCourse,
  modules: bundledCourse.modules.map((module) => ({
    ...module,
    tutorials: module.tutorials?.map((tutorial) => ({
      ...tutorial,
      steps: tutorial.steps.map((step) => ({
        ...step,
        sourceTemplate: TEST_TUTORIAL_TEMPLATE,
        answerChoices: TEST_TUTORIAL_CHOICES,
        correctChoiceId: "answer-35",
      })),
    })),
  })),
};

const bundledCourseWithChoiceTutorials = {
  ...bundledCourseWithChoiceTutorialsInput,
  checksum: calculateNodeReleaseChecksum(bundledCourseWithChoiceTutorialsInput as ReleaseLike),
};
/**
 * jest-expo stubs `expo-crypto`'s native module, so `digestStringAsync` resolves to `""` and would
 * make every checksum comparison fail for reasons unrelated to the code under test. Hashing with
 * `node:crypto` here is exactly what the device does with the same algorithm, and — because the
 * installer feeds it the shared `releaseChecksumInput` bytes — lets the suite assert byte identity
 * with the Node publishing tooling (see the bundled-checksum test below).
 */
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: jest.fn(async (algorithm: string, data: string) => {
    if (algorithm !== "SHA-256") {
      throw new Error(`unexpected digest algorithm ${algorithm}`);
    }
    // Required lazily: `jest.mock` factories cannot close over module-scope imports.
    return (require("node:crypto") as typeof import("node:crypto"))
      .createHash("sha256")
      .update(data)
      .digest("hex");
  }),
}));

const bundledRelease = parseCourseRelease(bundledCourseWithChoiceTutorials);

type ReleaseShape = Record<string, unknown> & { checksum?: string };

/**
 * A release derived from the bundled one under a new id, carrying the checksum the Node publishing
 * tooling would compute for it. `mutate` may produce structurally invalid content on purpose, so it
 * is typed loosely rather than as `CourseRelease`.
 */
function derivedRelease(
  id: string,
  mutate: (release: CourseRelease) => ReleaseShape = (release) => release as ReleaseShape,
): unknown {
  const { checksum: _ignored, ...rest } = mutate({ ...bundledRelease, id });
  return { ...rest, checksum: calculateNodeReleaseChecksum(rest as unknown as ReleaseLike) };
}

class FailingInsertDriver extends NodeSqliteDriver {
  override async run(sql: string, params: readonly SqlValue[] = []) {
    if (sql.includes("INSERT INTO lessons")) {
      throw new Error("injected lesson insert failure");
    }
    return super.run(sql, params);
  }
}

class RecordingDriver extends NodeSqliteDriver {
  readonly statements: string[] = [];

  override async run(sql: string, params: readonly SqlValue[] = []) {
    this.statements.push(sql);
    return super.run(sql, params);
  }
}

class CountingTransactionDriver extends NodeSqliteDriver {
  transactionCount = 0;

  override async transaction<T>(work: () => Promise<T>): Promise<T> {
    this.transactionCount += 1;
    return super.transaction(work);
  }
}

async function readMetadata(driver: NodeSqliteDriver, key: string): Promise<string | null> {
  const row = await driver.first<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

async function countRows(driver: NodeSqliteDriver, releaseId: string): Promise<number> {
  const row = await driver.first<{ total: number }>(
    `SELECT
       (SELECT COUNT(*) FROM content_releases WHERE id = ?)
     + (SELECT COUNT(*) FROM modules WHERE release_id = ?)
     + (SELECT COUNT(*) FROM lessons WHERE release_id = ?)
     + (SELECT COUNT(*) FROM lesson_stages WHERE release_id = ?) AS total`,
    [releaseId, releaseId, releaseId, releaseId],
  );
  return row?.total ?? 0;
}

describe("mobile release checksum verification", () => {
  test("accepts the bundled release's tracked checksum, proving shared checksum bytes", async () => {
    // bundled-course.json's checksum was produced by the Node build tooling; if the mobile verifier
    // hashed different bytes this would fail.
    await expect(verifyReleaseChecksum(bundledRelease)).resolves.toBeUndefined();
  });

  test("rejects a payload whose content no longer matches its checksum", async () => {
    const tampered: CourseRelease = {
      ...bundledRelease,
      modules: bundledRelease.modules.map((module, index) =>
        index === 0 ? { ...module, title: "Tampered" } : module,
      ),
    };

    await expect(verifyReleaseChecksum(tampered)).rejects.toThrow(
      new RegExp(`Release ${bundledRelease.id} content hashes to .*does not match its declared checksum`),
    );
  });

  test("rejects a payload whose checksum disagrees with the manifest checksum", async () => {
    await expect(verifyReleaseChecksum(bundledRelease, "f".repeat(64))).rejects.toThrow(
      /manifest checksum/i,
    );
  });

  test("accepts a digest reported in uppercase hexadecimal", async () => {
    const crypto = jest.requireMock("expo-crypto") as {
      digestStringAsync: jest.Mock<Promise<string>, [string, string]>;
    };
    crypto.digestStringAsync.mockImplementationOnce(async (_algorithm, data) =>
      createHash("sha256").update(data).digest("hex").toUpperCase(),
    );

    await expect(verifyReleaseChecksum(bundledRelease)).resolves.toBeUndefined();
  });
});

describe("release installer", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteCourseRepository;
  let installer: ReleaseInstaller;
  let notifications: number;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(":memory:");
    await migrateDatabase(driver);
    repository = new SqliteCourseRepository(driver);
    notifications = 0;
    repository.subscribe(() => {
      notifications += 1;
    });
    installer = new ReleaseInstaller(driver, repository);
    await installer.stageAndActivate(bundledCourseWithChoiceTutorials);
    notifications = 0;
  });

  afterEach(async () => {
    await driver.close();
  });

  test("treats the already active release with the same checksum as a no-op", async () => {
    await driver.run("UPDATE modules SET title = ? WHERE release_id = ? AND id = ?", [
      "sentinel title",
      bundledRelease.id,
      bundledRelease.modules[0].id,
    ]);

    await expect(installer.stageAndActivate(bundledCourseWithChoiceTutorials)).resolves.toEqual({
      status: "unchanged",
      releaseId: bundledRelease.id,
    });

    await expect(
      driver.first<{ title: string }>(
        "SELECT title FROM modules WHERE release_id = ? AND id = ?",
        [bundledRelease.id, bundledRelease.modules[0].id],
      ),
    ).resolves.toEqual({ title: "sentinel title" });
    expect(notifications).toBe(0);
  });

  test("rejects the same release ID carrying a different checksum", async () => {
    const conflicting: CourseRelease = { ...bundledRelease, checksum: "a".repeat(64) };

    await expect(
      installer.stageAndActivate(conflicting, { verifyChecksum: false }),
    ).rejects.toThrow(/already installed with a different checksum/i);
    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe(bundledRelease.id);
    await expect(repository.getActiveRelease()).resolves.toMatchObject({
      id: bundledRelease.id,
      checksum: bundledRelease.checksum,
    });
    expect(notifications).toBe(0);
  });

  test("round-trips a module's tutorials through install and read-back", async () => {
    const TUTORIAL = {
      id: "make-it-pulse",
      moduleId: bundledRelease.modules[0].id,
      position: 1,
      title: "Make it pulse",
      summary:
        "A summary carrying enough words to clear the twenty word floor the schema applies to it, so this fixture exercises the persistence rather than the validator.",
      steps: [
        {
          id: "pulse-step-one",
          position: 1,
          title: "Drive the radius from time",
          brief:
            "Take the static disc and make its radius breathe, using the same sine you met in Module 1, so the shape changes size without moving.",
          sourceTemplate: TEST_TUTORIAL_TEMPLATE,
          answerChoices: TEST_TUTORIAL_CHOICES,
          correctChoiceId: "answer-35",
          helpers: "float unused(float x) {\n  return x;\n}",
          hint: "Radius is just a number.",
        },
      ],
    };

    // Every other module has its tutorials stripped rather than left as authored, so the
    // "absent means absent" assertion below stays about the read path instead of about which
    // modules happen to ship exercises — which is exactly what broke this test once they all did.
    const withTutorials = derivedRelease("remote-tutorials", (release) => ({
      ...release,
      modules: release.modules.map((module, index) => {
        const { tutorials: _authored, ...rest } = module;
        return index === 0 ? { ...rest, tutorials: [TUTORIAL] } : rest;
      }),
    }));

    await expect(installer.stageAndActivate(withTutorials)).resolves.toMatchObject({
      releaseId: "remote-tutorials",
    });

    await expect(
      driver.first<{
        source_template: string;
        answer_choices_json: string;
        correct_choice_id: string;
      }>(
        `SELECT source_template, answer_choices_json, correct_choice_id
         FROM tutorial_steps
         WHERE release_id = ? AND id = ?`,
        ["remote-tutorials", "pulse-step-one"],
      ),
    ).resolves.toEqual({
      source_template: TEST_TUTORIAL_TEMPLATE,
      answer_choices_json: JSON.stringify(TEST_TUTORIAL_CHOICES),
      correct_choice_id: "answer-35",
    });
    const modules = await new SqliteCourseRepository(driver).getModules();

    // Deep equality rather than field-by-field: the optional `helpers`/`hint` come back as absent
    // keys, not nulls, and that distinction is what `parseCourseRelease` enforces on the way out.
    expect(modules[0].tutorials).toEqual([TUTORIAL]);
    // A module with no tutorials omits the key rather than carrying an empty array.
    expect(modules[1].tutorials).toBeUndefined();
  });

  test("round-trips a stage's helpers through install and read-back", async () => {
    const HELPERS = ["float hash(vec2 p) {", "  return fract(sin(p.x) * 43758.5453);", "}"].join(
      "\n",
    );

    // The column is nullable and most stages leave it unset, so the interesting case is that a
    // value survives the whole path -- INSERT, SELECT, and the row-to-domain mapping -- while its
    // absent neighbours come back absent rather than as null or empty string.
    const withHelpers = derivedRelease("remote-helpers", (release) => ({
      ...release,
      modules: release.modules.map((module, moduleIndex) =>
        moduleIndex !== 0
          ? module
          : {
              ...module,
              lessons: module.lessons.map((lesson, lessonIndex) =>
                lessonIndex !== 0
                  ? lesson
                  : {
                      ...lesson,
                      stages: lesson.stages.map((stage, stageIndex) =>
                        stageIndex === 0 ? { ...stage, helpers: HELPERS } : stage,
                      ),
                    },
              ),
            },
      ),
    }));

    await expect(installer.stageAndActivate(withHelpers)).resolves.toMatchObject({
      releaseId: "remote-helpers",
    });

    const modules = await new SqliteCourseRepository(driver).getModules();
    const stages = modules[0].lessons[0].stages;

    expect(stages[0].helpers).toBe(HELPERS);
    expect(stages[1].helpers).toBeUndefined();
  });
  test("rejects a stage source violating the sandbox contract before any SQL write", async () => {
    const counting = new CountingTransactionDriver(":memory:");
    await migrateDatabase(counting);
    counting.transactionCount = 0;
    const invalid = derivedRelease("remote-bad-source", (release) => ({
      ...release,
      modules: release.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson, lessonIndex) =>
          lessonIndex === 0
            ? {
                ...lesson,
                stages: lesson.stages.map((stage, stageIndex) =>
                  stageIndex === 0 ? { ...stage, source: "gl_FragColor = vec4(1.0);" } : stage,
                ),
              }
            : lesson,
        ),
      })),
    }));

    try {
      await expect(
        new ReleaseInstaller(counting).stageAndActivate(invalid),
      ).rejects.toThrow(/must not contain gl_FragColor/i);
      expect(counting.transactionCount).toBe(0);
      await expect(countRows(counting, "remote-bad-source")).resolves.toBe(0);
    } finally {
      await counting.close();
    }
  });

  test("rejects a lesson with too few stages before any SQL write", async () => {
    const counting = new CountingTransactionDriver(":memory:");
    await migrateDatabase(counting);
    counting.transactionCount = 0;
    const invalid = derivedRelease("remote-bad-stage-count", (release) => ({
      ...release,
      modules: release.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson, lessonIndex) =>
          lessonIndex === 0 ? { ...lesson, stages: lesson.stages.slice(0, 2) } : lesson,
        ),
      })),
    }));

    try {
      await expect(
        new ReleaseInstaller(counting).stageAndActivate(invalid),
      ).rejects.toThrow(/between 3 and 5 stages/i);
      expect(counting.transactionCount).toBe(0);
      await expect(countRows(counting, "remote-bad-stage-count")).resolves.toBe(0);
    } finally {
      await counting.close();
    }
  });

  test("rejects a checksum mismatch before any SQL write", async () => {
    const counting = new CountingTransactionDriver(":memory:");
    await migrateDatabase(counting);
    counting.transactionCount = 0;
    const tampered: CourseRelease = { ...bundledRelease, id: "remote-tampered" };

    try {
      await expect(new ReleaseInstaller(counting).stageAndActivate(tampered)).rejects.toThrow(
        /checksum/i,
      );
      expect(counting.transactionCount).toBe(0);
      await expect(countRows(counting, "remote-tampered")).resolves.toBe(0);
    } finally {
      await counting.close();
    }
  });

  test("leaves the previous active release intact when an insert fails mid-transaction", async () => {
    const failing = new FailingInsertDriver(":memory:");
    await migrateDatabase(failing);
    let failingNotifications = 0;
    const failingRepository = new SqliteCourseRepository(failing);
    failingRepository.subscribe(() => {
      failingNotifications += 1;
    });
    // Seed the "previous" release through a driver that can still write lessons.
    await failing.run("INSERT INTO app_metadata (key, value) VALUES (?, ?)", [
      ACTIVE_RELEASE_KEY,
      "already-active",
    ]);

    try {
      await expect(
        new ReleaseInstaller(failing, failingRepository).stageAndActivate(
          derivedRelease("remote-doomed"),
        ),
      ).rejects.toThrow("injected lesson insert failure");

      await expect(readMetadata(failing, ACTIVE_RELEASE_KEY)).resolves.toBe("already-active");
      await expect(countRows(failing, "remote-doomed")).resolves.toBe(0);
      expect(failingNotifications).toBe(0);
    } finally {
      await failing.close();
    }
  });

  test("activates a new release, notifies subscribers once, and keeps the old rows", async () => {
    const next = derivedRelease("remote-2026-08-05", (release) => ({
      ...release,
      modules: release.modules.map((module, index) =>
        index === 0 ? { ...module, title: "Updated foundations" } : module,
      ),
    }));

    await expect(installer.stageAndActivate(next)).resolves.toEqual({
      status: "activated",
      releaseId: "remote-2026-08-05",
    });

    expect(notifications).toBe(1);
    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe("remote-2026-08-05");
    await expect(readMetadata(driver, PREVIOUS_ACTIVE_RELEASE_KEY)).resolves.toBe(
      bundledRelease.id,
    );
    await expect(repository.getActiveRelease()).resolves.toEqual(next);
    // Old release rows survive activation; only explicit cleanup removes them.
    await expect(countRows(driver, bundledRelease.id)).resolves.toBeGreaterThan(0);
  });

  test("writes the active release pointer after every release-scoped row", async () => {
    const recording = new RecordingDriver(":memory:");
    await migrateDatabase(recording);
    await new ReleaseInstaller(recording).stageAndActivate(bundledCourseWithChoiceTutorials, {
      verifyChecksum: false,
    });

    try {
      const activation = recording.statements.findIndex(
        (sql) => sql.includes("INSERT INTO app_metadata") && sql.includes("ON CONFLICT"),
      );
      const lastContentWrite = recording.statements.reduce(
        (last, sql, index) => (/INSERT INTO (content_releases|modules|lessons|lesson_)/.test(sql) ? index : last),
        -1,
      );

      expect(activation).toBeGreaterThan(-1);
      expect(lastContentWrite).toBeGreaterThan(-1);
      // The pointer flip is the transaction's last write: nothing can ever observe it aimed at a
      // release whose rows are still being written.
      expect(activation).toBeGreaterThan(lastContentWrite);
    } finally {
      await recording.close();
    }
  });

  test("activates an already staged release without rewriting its rows", async () => {
    const staged = derivedRelease("remote-staged") as CourseRelease;
    await installer.stageAndActivate(staged);
    await driver.run("UPDATE modules SET title = ? WHERE release_id = ? AND id = ?", [
      "staged sentinel",
      "remote-staged",
      staged.modules[0].id,
    ]);
    await driver.run("UPDATE app_metadata SET value = ? WHERE key = ?", [
      bundledRelease.id,
      ACTIVE_RELEASE_KEY,
    ]);
    notifications = 0;

    await expect(installer.stageAndActivate(staged)).resolves.toEqual({
      status: "activated",
      releaseId: "remote-staged",
    });

    expect(notifications).toBe(1);
    await expect(
      driver.first<{ title: string }>(
        "SELECT title FROM modules WHERE release_id = ? AND id = ?",
        ["remote-staged", staged.modules[0].id],
      ),
    ).resolves.toEqual({ title: "staged sentinel" });
  });
});

/**
 * `installBundledRelease` runs on every cold start, so what it does when a *downloaded* release is
 * already active is the difference between "the learner keeps their curriculum" and "relaunching
 * silently reverts them to the shipped one".
 */
describe("bundled seed on relaunch", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteCourseRepository;
  let installer: ReleaseInstaller;
  let notifications: number;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(":memory:");
    await migrateDatabase(driver);
    repository = new SqliteCourseRepository(driver);
    notifications = 0;
    repository.subscribe(() => {
      notifications += 1;
    });
    installer = new ReleaseInstaller(driver, repository);
  });

  afterEach(async () => {
    await driver.close();
  });

  test("leaves an active downloaded release alone when the bundled release is reinstalled", async () => {
    await installBundledRelease(driver, bundledCourseWithChoiceTutorials);
    await installer.stageAndActivate(derivedRelease("remote-1"));
    notifications = 0;

    // The production wrapper, and the same install through an observer-carrying installer so the
    // "no notification" assertion below cannot pass merely because nothing was subscribed.
    await installBundledRelease(driver, bundledCourseWithChoiceTutorials);
    await expect(
      installer.stageAndActivate(bundledCourseWithChoiceTutorials, {
        activation: "only-when-none-active",
        verifyChecksum: false,
      }),
    ).resolves.toEqual({ status: "unchanged", releaseId: bundledRelease.id });

    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe("remote-1");
    await expect(readMetadata(driver, PREVIOUS_ACTIVE_RELEASE_KEY)).resolves.toBe(
      bundledRelease.id,
    );
    await expect(repository.getActiveRelease()).resolves.toMatchObject({ id: "remote-1" });
    expect(notifications).toBe(0);
  });

  test("survives repeated relaunches without ever reclaiming the pointer", async () => {
    await installBundledRelease(driver, bundledCourseWithChoiceTutorials);
    await installer.stageAndActivate(derivedRelease("remote-1"));

    for (let relaunch = 0; relaunch < 3; relaunch += 1) {
      await installBundledRelease(driver, bundledCourseWithChoiceTutorials);
    }

    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe("remote-1");
    await expect(readMetadata(driver, PREVIOUS_ACTIVE_RELEASE_KEY)).resolves.toBe(
      bundledRelease.id,
    );
  });

  test("activates the bundled release on genuine first launch", async () => {
    await installBundledRelease(driver, bundledCourseWithChoiceTutorials);

    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe(bundledRelease.id);
    await expect(readMetadata(driver, PREVIOUS_ACTIVE_RELEASE_KEY)).resolves.toBeNull();
    await expect(repository.getActiveRelease()).resolves.toMatchObject({ id: bundledRelease.id });
  });

  test("repairs a database holding the bundled rows with no active pointer", async () => {
    await installBundledRelease(driver, bundledCourseWithChoiceTutorials);
    await driver.run("DELETE FROM app_metadata WHERE key = ?", [ACTIVE_RELEASE_KEY]);
    notifications = 0;

    await expect(
      installer.stageAndActivate(bundledCourseWithChoiceTutorials, {
        activation: "only-when-none-active",
        verifyChecksum: false,
      }),
    ).resolves.toEqual({ status: "activated", releaseId: bundledRelease.id });

    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe(bundledRelease.id);
    // Repairing a missing pointer *is* an active-release change, so subscribers must hear about it.
    expect(notifications).toBe(1);
    await expect(repository.getActiveRelease()).resolves.toMatchObject({ id: bundledRelease.id });
  });

  test("repairs an active pointer naming a release that is not installed", async () => {
    await installBundledRelease(driver, bundledCourseWithChoiceTutorials);
    await driver.run("UPDATE app_metadata SET value = ? WHERE key = ?", [
      "remote-vanished",
      ACTIVE_RELEASE_KEY,
    ]);

    await installBundledRelease(driver, bundledCourseWithChoiceTutorials);

    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe(bundledRelease.id);
    await expect(repository.getActiveRelease()).resolves.toMatchObject({ id: bundledRelease.id });
  });
});

describe("superseded release cleanup", () => {
  let driver: NodeSqliteDriver;
  let installer: ReleaseInstaller;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(":memory:");
    await migrateDatabase(driver);
    installer = new ReleaseInstaller(driver);
    await installer.stageAndActivate(bundledCourseWithChoiceTutorials);
  });

  afterEach(async () => {
    await driver.close();
  });

  test("keeps the bundled, active, and most recently active prior releases", async () => {
    await installer.stageAndActivate(derivedRelease("remote-1"));
    await installer.stageAndActivate(derivedRelease("remote-2"));
    await installer.stageAndActivate(derivedRelease("remote-3"));

    await expect(installer.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([
      "remote-1",
    ]);

    await expect(
      driver.all<{ id: string }>("SELECT id FROM content_releases ORDER BY id"),
    ).resolves.toEqual([{ id: bundledRelease.id }, { id: "remote-2" }, { id: "remote-3" }]);
    await expect(countRows(driver, "remote-1")).resolves.toBe(0);
    await expect(countRows(driver, "remote-3")).resolves.toBeGreaterThan(0);
  });

  test("refuses to run when the bundled release ID names nothing installed", async () => {
    await installer.stageAndActivate(derivedRelease("remote-1"));
    await installer.stageAndActivate(derivedRelease("remote-2"));
    await installer.stageAndActivate(derivedRelease("remote-3"));

    // A stale or mistyped bundled id would otherwise delete the real bundled release, silently.
    await expect(installer.deleteSupersededReleases("bundled-2026-01-01")).rejects.toThrow(
      /is not an installed release/,
    );
    await expect(
      driver.all<{ id: string }>("SELECT id FROM content_releases ORDER BY id"),
    ).resolves.toEqual([
      { id: bundledRelease.id },
      { id: "remote-1" },
      { id: "remote-2" },
      { id: "remote-3" },
    ]);
    await expect(countRows(driver, bundledRelease.id)).resolves.toBeGreaterThan(0);
  });

  test("keeps the right retention set at every step of download, download, relaunch", async () => {
    // Step 1 — first launch: only the bundled release exists and nothing is superseded.
    await expect(installer.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([]);
    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe(bundledRelease.id);
    await expect(readMetadata(driver, PREVIOUS_ACTIVE_RELEASE_KEY)).resolves.toBeNull();

    // Step 2 — download A: bundled becomes the rollback target.
    await installer.stageAndActivate(derivedRelease("remote-a"));
    await expect(readMetadata(driver, PREVIOUS_ACTIVE_RELEASE_KEY)).resolves.toBe(
      bundledRelease.id,
    );
    await expect(installer.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([]);

    // Step 3 — download B: A becomes the rollback target; bundled is now superseded but retained.
    await installer.stageAndActivate(derivedRelease("remote-b"));
    await expect(readMetadata(driver, PREVIOUS_ACTIVE_RELEASE_KEY)).resolves.toBe("remote-a");
    await expect(installer.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([]);

    // Step 4 — relaunch: the bundled seed must not disturb either pointer, so the retention set is
    // unchanged and cleanup still deletes nothing.
    await installBundledRelease(driver, bundledCourseWithChoiceTutorials);
    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe("remote-b");
    await expect(readMetadata(driver, PREVIOUS_ACTIVE_RELEASE_KEY)).resolves.toBe("remote-a");
    await expect(installer.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([]);
    await expect(
      driver.all<{ id: string }>("SELECT id FROM content_releases ORDER BY id"),
    ).resolves.toEqual([
      { id: bundledRelease.id },
      { id: "remote-a" },
      { id: "remote-b" },
    ]);

    // Step 5 — download C: A is finally collectable, and only A.
    await installer.stageAndActivate(derivedRelease("remote-c"));
    await expect(installer.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([
      "remote-a",
    ]);
  });

  test("removes child rows without relying on ON DELETE CASCADE", async () => {
    await installer.stageAndActivate(derivedRelease("remote-1"));
    await installer.stageAndActivate(derivedRelease("remote-2"));
    await installer.stageAndActivate(derivedRelease("remote-3"));
    // `migrateDatabase` turns foreign keys on; a database opened without that pragma (or a driver
    // that resets it) must still be fully cleaned rather than left with orphaned lesson rows.
    await driver.exec("PRAGMA foreign_keys = OFF");

    await expect(installer.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([
      "remote-1",
    ]);
    await expect(countRows(driver, "remote-1")).resolves.toBe(0);
  });

  test("never deletes the bundled release, even when it is not active", async () => {
    await installer.stageAndActivate(derivedRelease("remote-1"));
    await installer.stageAndActivate(derivedRelease("remote-2"));

    await expect(installer.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([]);
    await expect(countRows(driver, bundledRelease.id)).resolves.toBeGreaterThan(0);
  });

  test("never deletes the bundled release when it is also the active release", async () => {
    await expect(installer.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([]);
    await expect(countRows(driver, bundledRelease.id)).resolves.toBeGreaterThan(0);
  });

  test("does not notify subscribers, because the active release does not change", async () => {
    const repository = new SqliteCourseRepository(driver);
    let notifications = 0;
    repository.subscribe(() => {
      notifications += 1;
    });
    const notifyingInstaller = new ReleaseInstaller(driver, repository);
    await notifyingInstaller.stageAndActivate(derivedRelease("remote-1"));
    await notifyingInstaller.stageAndActivate(derivedRelease("remote-2"));
    await notifyingInstaller.stageAndActivate(derivedRelease("remote-3"));
    notifications = 0;

    await expect(notifyingInstaller.deleteSupersededReleases(bundledRelease.id)).resolves.toEqual([
      "remote-1",
    ]);
    expect(notifications).toBe(0);
    await expect(new SqliteCourseRepository(driver).getActiveRelease()).resolves.toMatchObject({
      id: "remote-3",
    });
  });
});
