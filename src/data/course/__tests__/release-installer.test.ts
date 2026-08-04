import { createHash } from "node:crypto";

import bundledCourse from "../../../../assets/course/bundled-course.json";

import { calculateNodeReleaseChecksum } from "../../../../scripts/content/node-checksum";
import type { SqlValue } from "../../database/driver";
import type { ReleaseLike } from "../canonicalize";
import { migrateDatabase } from "../../database/migrations";
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

const bundledRelease = parseCourseRelease(bundledCourse);

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
     + (SELECT COUNT(*) FROM lesson_presets WHERE release_id = ?)
     + (SELECT COUNT(*) FROM lesson_sections WHERE release_id = ?) AS total`,
    [releaseId, releaseId, releaseId, releaseId, releaseId],
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
    await installer.stageAndActivate(bundledCourse);
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

    await expect(installer.stageAndActivate(bundledCourse)).resolves.toEqual({
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

  test("rejects invalid highlighted lines before any SQL write", async () => {
    const counting = new CountingTransactionDriver(":memory:");
    await migrateDatabase(counting);
    counting.transactionCount = 0;
    const invalid = derivedRelease("remote-bad-highlight", (release) => ({
      ...release,
      modules: release.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson, lessonIndex) =>
          lessonIndex === 0
            ? {
                ...lesson,
                presets: lesson.presets.map((preset, presetIndex) =>
                  presetIndex === 0
                    ? { ...preset, highlightedLines: [preset.codeLines.length + 5] }
                    : preset,
                ),
              }
            : lesson,
        ),
      })),
    }));

    try {
      await expect(
        new ReleaseInstaller(counting).stageAndActivate(invalid),
      ).rejects.toThrow(/Highlighted line must be between/i);
      expect(counting.transactionCount).toBe(0);
      await expect(countRows(counting, "remote-bad-highlight")).resolves.toBe(0);
    } finally {
      await counting.close();
    }
  });

  test("rejects an unknown preview key before any SQL write", async () => {
    const counting = new CountingTransactionDriver(":memory:");
    await migrateDatabase(counting);
    counting.transactionCount = 0;
    const invalid = derivedRelease("remote-bad-preview", (release) => ({
      ...release,
      modules: release.modules.map((module) => ({
        ...module,
        lessons: module.lessons.map((lesson, lessonIndex) =>
          lessonIndex === 0
            ? {
                ...lesson,
                presets: lesson.presets.map((preset, presetIndex) =>
                  presetIndex === 0 ? { ...preset, previewKey: "not-a-preview" } : preset,
                ),
              }
            : lesson,
        ),
      })),
    }));

    try {
      await expect(
        new ReleaseInstaller(counting).stageAndActivate(invalid),
      ).rejects.toThrow(/Invalid preview key: not-a-preview/);
      expect(counting.transactionCount).toBe(0);
      await expect(countRows(counting, "remote-bad-preview")).resolves.toBe(0);
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
    await new ReleaseInstaller(recording).stageAndActivate(bundledCourse, {
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

describe("superseded release cleanup", () => {
  let driver: NodeSqliteDriver;
  let installer: ReleaseInstaller;

  beforeEach(async () => {
    driver = new NodeSqliteDriver(":memory:");
    await migrateDatabase(driver);
    installer = new ReleaseInstaller(driver);
    await installer.stageAndActivate(bundledCourse);
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
