/**
 * jest-expo stubs `expo-crypto`'s native module, so `digestStringAsync` resolves to `""` and every
 * checksum comparison would fail for reasons unrelated to the code under test. Hashing with
 * `node:crypto` here is exactly what the device does with the same algorithm — the same mock, for the
 * same reason, as `src/data/course/__tests__/release-installer.test.ts`.
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

import bundledCourse from "../../../../assets/course/bundled-course.json";

import { calculateNodeReleaseChecksum } from "../../../../scripts/content/node-checksum";
import type { ReleaseLike } from "../../course/canonicalize";
import { getProgressPercent } from "../../course/domain";
import {
  ACTIVE_RELEASE_KEY,
  PREVIOUS_ACTIVE_RELEASE_KEY,
  ReleaseInstaller,
  type StageAndActivateOptions,
} from "../../course/release-installer";
import { parseCourseRelease } from "../../course/schema";
import { SqliteCourseRepository } from "../../course/sqlite-course-repository";
import type { CourseRelease } from "../../course/types";
import type { SqlValue } from "../../database/driver";
import { migrateDatabase } from "../../database/migrations";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import {
  CourseSyncEngine,
  SUPPORTED_CONTENT_SCHEMA_VERSION,
  compareAppVersions,
  type CourseReleaseInstallerLike,
  type CourseSyncResult,
} from "../course-sync-engine";
import { SupabaseCourseRemote, type SupabaseCourseClientLike } from "../supabase-course-remote";

const bundledRelease = parseCourseRelease(bundledCourse);

/** The app version every test runs as, unless it is specifically about version comparison. */
const APP_VERSION = "1.0.0";

type ReleaseShape = Record<string, unknown> & { checksum?: string };

/**
 * A release derived from the bundled one under a new id, carrying the checksum the Node publishing
 * tooling would compute for it — the same helper (and rationale) as the release-installer suite:
 * `mutate` may produce structurally invalid content on purpose, so it is typed loosely.
 */
function derivedRelease(
  id: string,
  mutate: (release: CourseRelease) => ReleaseShape = (release) => release as ReleaseShape,
): ReleaseShape {
  const { checksum: _ignored, ...rest } = mutate({ ...bundledRelease, id });
  return { ...rest, checksum: calculateNodeReleaseChecksum(rest as unknown as ReleaseLike) };
}

type ManifestRow = {
  id: unknown;
  schema_version: unknown;
  minimum_app_version: unknown;
  checksum: unknown;
  published_at: unknown;
};

function manifestFor(release: ReleaseShape, overrides: Partial<ManifestRow> = {}): ManifestRow {
  return {
    id: release.id,
    schema_version: release.schemaVersion,
    minimum_app_version: release.minimumAppVersion,
    checksum: release.checksum,
    published_at: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * A fake PostgREST surface driving the *real* `SupabaseCourseRemote`, rather than a fake
 * `CourseRemote`. The remote is what validates a downloaded payload (`parseCourseRelease`), so faking
 * it away would make "unknown preview capability" and "malformed manifest" tests assert nothing about
 * the path the device actually takes.
 */
function createFakeCourseClient() {
  const state = {
    manifest: null as ManifestRow | null,
    manifestError: null as string | null,
    releases: new Map<string, unknown>(),
    releaseError: null as string | null,
  };
  const calls = { manifest: 0, release: [] as string[] };

  const client = {
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "get_active_course_manifest") {
        calls.manifest += 1;
        if (state.manifestError !== null) {
          return Promise.resolve({
            data: null,
            error: { message: state.manifestError, code: "08006" },
            status: 500,
          });
        }
        return Promise.resolve({
          data: state.manifest === null ? [] : [state.manifest],
          error: null,
          status: 200,
        });
      }

      if (fn === "get_course_release") {
        const releaseId = args.p_release_id as string;
        calls.release.push(releaseId);
        if (state.releaseError !== null) {
          return Promise.resolve({
            data: null,
            error: { message: state.releaseError, code: "08006" },
            status: 500,
          });
        }
        return Promise.resolve({
          data: state.releases.get(releaseId) ?? null,
          error: null,
          status: 200,
        });
      }

      throw new Error(`unexpected rpc ${fn}`);
    },
  } as unknown as SupabaseCourseClientLike;

  return { client, state, calls };
}

/** Records every installer call so a test can assert what the engine did (and did not) hand over. */
function recordingInstaller(installer: ReleaseInstaller) {
  const stageCalls: { payload: unknown; options: StageAndActivateOptions | undefined }[] = [];
  const cleanupCalls: string[] = [];

  const recorded: CourseReleaseInstallerLike = {
    stageAndActivate(payload, options) {
      stageCalls.push({ payload, options });
      return installer.stageAndActivate(payload, options);
    },
    deleteSupersededReleases(bundledReleaseId) {
      cleanupCalls.push(bundledReleaseId);
      return installer.deleteSupersededReleases(bundledReleaseId);
    },
  };

  return { installer: recorded, stageCalls, cleanupCalls };
}

/**
 * Fails lesson inserts on demand, so the bundled release can be seeded normally and the *next*
 * install can be made to fail mid-transaction.
 */
class FailingLessonInsertDriver extends NodeSqliteDriver {
  failLessonInserts = false;

  override async run(sql: string, params: readonly SqlValue[] = []) {
    if (this.failLessonInserts && sql.includes("INSERT INTO lessons")) {
      throw new Error("injected lesson insert failure");
    }
    return super.run(sql, params);
  }
}

async function readMetadata(driver: NodeSqliteDriver, key: string): Promise<string | null> {
  const row = await driver.first<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

describe("semantic app version comparison", () => {
  test("orders components numerically, not lexically", () => {
    // The whole point: string comparison would put "10.0.0" *before* "9.0.0".
    expect(compareAppVersions("10.0.0", "9.0.0")).toBe(1);
    expect(compareAppVersions("9.0.0", "10.0.0")).toBe(-1);
    expect(compareAppVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareAppVersions("1.0.10", "1.0.9")).toBe(1);
    expect(compareAppVersions("1.2.3", "1.2.3")).toBe(0);
  });

  test("rejects anything that is not a strict three-component version", () => {
    expect(compareAppVersions("1.0", "1.0.0")).toBeNull();
    expect(compareAppVersions("1.0.0", "1.0")).toBeNull();
    expect(compareAppVersions("1.0.0-beta.1", "1.0.0")).toBeNull();
    expect(compareAppVersions("", "1.0.0")).toBeNull();
    expect(compareAppVersions("v1.0.0", "1.0.0")).toBeNull();
  });
});

describe("course sync engine", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteCourseRepository;
  let real: ReleaseInstaller;
  let recorded: ReturnType<typeof recordingInstaller>;
  let remoteFake: ReturnType<typeof createFakeCourseClient>;
  let notifications: number;
  let cleanupTasks: (() => Promise<unknown>)[];

  function buildEngine(appVersion: string | null = APP_VERSION): CourseSyncEngine {
    return new CourseSyncEngine(
      new SupabaseCourseRemote(remoteFake.client),
      recorded.installer,
      repository,
      bundledRelease.id,
      {
        appVersion,
        scheduleCleanup: (run) => {
          cleanupTasks.push(run);
        },
      },
    );
  }

  beforeEach(async () => {
    driver = new NodeSqliteDriver(":memory:");
    await migrateDatabase(driver);
    repository = new SqliteCourseRepository(driver);
    real = new ReleaseInstaller(driver, repository);
    await real.stageAndActivate(bundledCourse, { verifyChecksum: false });
    recorded = recordingInstaller(real);
    remoteFake = createFakeCourseClient();
    cleanupTasks = [];
    notifications = 0;
    repository.subscribe(() => {
      notifications += 1;
    });
  });

  afterEach(async () => {
    await driver.close();
  });

  /** Asserts the on-device curriculum is still exactly the bundled release this suite started from. */
  async function expectBundledStillActive(): Promise<void> {
    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe(bundledRelease.id);
    await expect(repository.getActiveRelease()).resolves.toEqual(bundledRelease);
    expect(notifications).toBe(0);
  }

  test("reports current when the remote has no active release", async () => {
    remoteFake.state.manifest = null;

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "current",
    });

    expect(remoteFake.calls.release).toEqual([]);
    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("reports current when the manifest matches the installed release id and checksum", async () => {
    remoteFake.state.manifest = manifestFor(bundledRelease as unknown as ReleaseShape);

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "current",
    });

    // Nothing is downloaded when the manifest already describes what is installed.
    expect(remoteFake.calls.release).toEqual([]);
    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("refuses a manifest that reuses the installed id with a different checksum", async () => {
    // Published releases are immutable, so this means the two disagree about what that release *is*.
    remoteFake.state.manifest = manifestFor(bundledRelease as unknown as ReleaseShape, {
      checksum: "a".repeat(64),
    });

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "protocol",
    });

    expect(remoteFake.calls.release).toEqual([]);
    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("requires an app update when the manifest needs a higher content schema", async () => {
    const next = derivedRelease("remote-schema-2");
    remoteFake.state.manifest = manifestFor(next, {
      schema_version: SUPPORTED_CONTENT_SCHEMA_VERSION + 1,
      minimum_app_version: "2.0.0",
    });
    remoteFake.state.releases.set("remote-schema-2", next);

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "requires-app-update",
      minimumAppVersion: "2.0.0",
    });

    expect(remoteFake.calls.release).toEqual([]);
    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("requires an app update when the manifest needs a higher semantic app version", async () => {
    const next = derivedRelease("remote-needs-2", (release) => ({
      ...release,
      minimumAppVersion: "2.0.0",
    }));
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-needs-2", next);

    await expect(buildEngine("1.9.9").checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "requires-app-update",
      minimumAppVersion: "2.0.0",
    });

    // Never downloaded and never handed to the installer: the incompatibility is known from the
    // manifest alone.
    expect(remoteFake.calls.release).toEqual([]);
    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("activates a release whose minimum version is only numerically lower", async () => {
    // A lexical comparison would read "10.0.0" as older than "9.0.0" and refuse this.
    const next = derivedRelease("remote-needs-9", (release) => ({
      ...release,
      minimumAppVersion: "9.0.0",
    }));
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-needs-9", next);

    await expect(buildEngine("10.0.0").checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "updated",
      releaseId: "remote-needs-9",
    });
  });

  test("activates a release whose minimum version equals the running app version", async () => {
    const next = derivedRelease("remote-equal-version");
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-equal-version", next);

    await expect(buildEngine("1.0.0").checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "updated",
      releaseId: "remote-equal-version",
    });
  });

  test.each([null, "", "1.0", "1.0.0-beta.1"])(
    "refuses to install when the app version is unusable (%p)",
    async (appVersion) => {
      const next = derivedRelease("remote-unknown-app-version");
      remoteFake.state.manifest = manifestFor(next);
      remoteFake.state.releases.set("remote-unknown-app-version", next);

      await expect(
        buildEngine(appVersion).checkForUpdate(),
      ).resolves.toEqual<CourseSyncResult>({
        kind: "requires-app-update",
        minimumAppVersion: bundledRelease.minimumAppVersion,
      });

      expect(remoteFake.calls.release).toEqual([]);
      expect(recorded.stageCalls).toEqual([]);
      await expectBundledStillActive();
    },
  );

  test("refuses a downloaded payload whose id differs from the manifest", async () => {
    const delivered = derivedRelease("remote-delivered");
    // The manifest carries the delivered payload's *checksum* under a different id, so the id is the
    // only thing that disagrees and the checksum cross-check cannot be what catches this.
    remoteFake.state.manifest = manifestFor(delivered, { id: "remote-advertised" });
    remoteFake.state.releases.set("remote-advertised", delivered);

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "protocol",
    });

    expect(remoteFake.calls.release).toEqual(["remote-advertised"]);
    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("refuses a downloaded payload whose checksum differs from the manifest", async () => {
    const next = derivedRelease("remote-checksum-drift");
    remoteFake.state.manifest = manifestFor(next, { checksum: "b".repeat(64) });
    remoteFake.state.releases.set("remote-checksum-drift", next);

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "protocol",
    });

    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("refuses a downloaded payload whose content no longer hashes to its checksum", async () => {
    const next = derivedRelease("remote-tampered") as unknown as CourseRelease;
    const tampered = {
      ...next,
      modules: next.modules.map((module, index) =>
        index === 0 ? { ...module, title: "Tampered in transit" } : module,
      ),
    };
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-tampered", tampered);

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "validation",
    });

    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("refuses a downloaded payload using a shader capability this build does not implement", async () => {
    const next = derivedRelease("remote-unknown-uniform", (release) => ({
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
                        stageIndex !== 0
                          ? stage
                          : { ...stage, source: "fragColor = vec4(iMouse.xy, 0.0, 1.0);" },
                      ),
                    },
              ),
            },
      ),
    }));
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-unknown-uniform", next);

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "validation",
    });

    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("activates a compatible release and refreshes every curriculum reader", async () => {
    const next = derivedRelease("remote-compatible");
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-compatible", next);

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "updated",
      releaseId: "remote-compatible",
    });

    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe("remote-compatible");
    await expect(readMetadata(driver, PREVIOUS_ACTIVE_RELEASE_KEY)).resolves.toBe(
      bundledRelease.id,
    );
    await expect(repository.getActiveRelease()).resolves.toMatchObject({
      id: "remote-compatible",
      checksum: next.checksum,
    });
    // The single notification is what refreshes Course, Home and an open lesson.
    expect(notifications).toBe(1);
  });

  test("activates a downloaded release with the always policy and a manifest checksum", async () => {
    const next = derivedRelease("remote-policy");
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-policy", next);

    await buildEngine().checkForUpdate();

    expect(recorded.stageCalls).toHaveLength(1);
    expect(recorded.stageCalls[0].options).toMatchObject({
      activation: "always",
      manifestChecksum: next.checksum,
    });
  });

  test("recalculates the progress percentage when the published lesson set changes", async () => {
    // This test needs a release with a known published-lesson count, so it builds one rather than
    // inheriting however large the real curriculum currently is. Module one's first lesson is
    // cloned four times (re-suffixing every id, including each clone's stage ids, so the
    // release-wide uniqueness checks still pass) and every other module is dropped. Deriving from
    // the live curriculum is what broke this test the moment a second module was published.
    const baseLesson = bundledRelease.modules[0].lessons[0];
    const clones = [1, 2, 3, 4].map((position) => ({
      ...baseLesson,
      id: `${baseLesson.id}-clone-${position}`,
      position,
      stages: baseLesson.stages.map((stage) => ({
        ...stage,
        id: `${stage.id}-clone-${position}`,
      })),
    }));

    const withFourLessons = derivedRelease("remote-four-lessons", (release) => ({
      ...release,
      modules: [{ ...release.modules[0], lessons: clones }],
    }));
    remoteFake.state.manifest = manifestFor(withFourLessons);
    remoteFake.state.releases.set("remote-four-lessons", withFourLessons);
    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "updated",
      releaseId: "remote-four-lessons",
    });

    const completedLessonIds = clones
      .filter((lesson) => lesson.position <= 3)
      .map((lesson) => lesson.id);

    // 3 of 4 published lessons.
    expect(
      getProgressPercent({ modules: await repository.getModules() }, completedLessonIds),
    ).toBe(75);

    // The next release drops lessons 3 and 4, so one completed lesson no longer exists and the
    // denominator shrinks from 4 to 2.
    const withTwoLessons = derivedRelease("remote-fewer-lessons", (release) => ({
      ...release,
      modules: [
        { ...release.modules[0], lessons: clones.filter((lesson) => lesson.position <= 2) },
      ],
    }));
    remoteFake.state.manifest = manifestFor(withTwoLessons);
    remoteFake.state.releases.set("remote-fewer-lessons", withTwoLessons);

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "updated",
      releaseId: "remote-fewer-lessons",
    });

    // 2 of 2, recomputed from the newly active release rather than remembered from the old one.
    expect(
      getProgressPercent({ modules: await repository.getModules() }, completedLessonIds),
    ).toBe(100);
  });

  test("schedules superseded-release cleanup only after a successful activation", async () => {
    const next = derivedRelease("remote-cleanup");
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-cleanup", next);
    // A third, older downloaded release that is neither bundled, active, nor the rollback target.
    await real.stageAndActivate(derivedRelease("remote-stale"), { verifyChecksum: false });
    await real.stageAndActivate(bundledCourse, { verifyChecksum: false });
    notifications = 0;

    await buildEngine().checkForUpdate();

    // Scheduled, not run inline: nothing was deleted while the activation was being made.
    expect(recorded.cleanupCalls).toEqual([]);
    expect(cleanupTasks).toHaveLength(1);
    await expect(
      driver.first("SELECT id FROM content_releases WHERE id = ?", ["remote-stale"]),
    ).resolves.not.toBeNull();

    await cleanupTasks[0]();

    expect(recorded.cleanupCalls).toEqual([bundledRelease.id]);
    await expect(
      driver.first("SELECT id FROM content_releases WHERE id = ?", ["remote-stale"]),
    ).resolves.toBeNull();
    // The bundled release, the newly active one, and the rollback target all survive.
    await expect(
      driver.all<{ id: string }>("SELECT id FROM content_releases ORDER BY id"),
    ).resolves.toEqual([
      { id: bundledRelease.id },
      { id: "remote-cleanup" },
    ]);
  });

  test("schedules no cleanup when nothing was activated", async () => {
    remoteFake.state.manifest = manifestFor(bundledRelease as unknown as ReleaseShape);

    await buildEngine().checkForUpdate();

    expect(cleanupTasks).toEqual([]);
  });

  test("still reports the update when cleanup fails", async () => {
    const next = derivedRelease("remote-cleanup-fails");
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-cleanup-fails", next);
    const failing: CourseReleaseInstallerLike = {
      stageAndActivate: (payload, options) => real.stageAndActivate(payload, options),
      deleteSupersededReleases: () => Promise.reject(new Error("cleanup exploded")),
    };
    const engine = new CourseSyncEngine(
      new SupabaseCourseRemote(remoteFake.client),
      failing,
      repository,
      bundledRelease.id,
      { appVersion: APP_VERSION, scheduleCleanup: (run) => cleanupTasks.push(run) },
    );

    await expect(engine.checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "updated",
      releaseId: "remote-cleanup-fails",
    });
    // The update is already reported and already active; the cleanup rejection is the scheduler's to
    // absorb (see `DEFAULT_SCHEDULE_CLEANUP`) and can never reach back into this result.
    await expect(cleanupTasks[0]()).rejects.toThrow("cleanup exploded");
    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe("remote-cleanup-fails");
    await expect(repository.getActiveRelease()).resolves.toMatchObject({
      id: "remote-cleanup-fails",
    });
  });

  test("the default cleanup scheduler defers the work and swallows its failure", async () => {
    const next = derivedRelease("remote-default-cleanup");
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-default-cleanup", next);
    let cleanupStarted = false;
    const failing: CourseReleaseInstallerLike = {
      stageAndActivate: (payload, options) => real.stageAndActivate(payload, options),
      deleteSupersededReleases: () => {
        cleanupStarted = true;
        return Promise.reject(new Error("cleanup exploded"));
      },
    };
    // No `scheduleCleanup`: this is the production default.
    const engine = new CourseSyncEngine(
      new SupabaseCourseRemote(remoteFake.client),
      failing,
      repository,
      bundledRelease.id,
      { appVersion: APP_VERSION },
    );

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await expect(engine.checkForUpdate()).resolves.toEqual<CourseSyncResult>({
        kind: "updated",
        releaseId: "remote-default-cleanup",
      });
      // Ran, off the caller's path, and its rejection was absorbed rather than left unhandled — an
      // unhandled rejection here crashes a release build of Hermes.
      await new Promise((resolve) => setImmediate(resolve));
      expect(cleanupStarted).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  test("reports current, and schedules no cleanup, when the installer changed nothing", async () => {
    const next = derivedRelease("remote-no-op");
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-no-op", next);
    const noOp: CourseReleaseInstallerLike = {
      stageAndActivate: async () => ({ status: "unchanged", releaseId: "remote-no-op" }),
      deleteSupersededReleases: async () => [],
    };
    const engine = new CourseSyncEngine(
      new SupabaseCourseRemote(remoteFake.client),
      noOp,
      repository,
      bundledRelease.id,
      { appVersion: APP_VERSION, scheduleCleanup: (run) => cleanupTasks.push(run) },
    );

    await expect(engine.checkForUpdate()).resolves.toEqual<CourseSyncResult>({ kind: "current" });
    expect(cleanupTasks).toEqual([]);
  });

  test("classifies a manifest transport failure as network and preserves the release", async () => {
    remoteFake.state.manifestError = "fetch failed";

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "network",
    });

    expect(remoteFake.calls.release).toEqual([]);
    await expectBundledStillActive();
  });

  test("classifies a malformed manifest as network and preserves the release", async () => {
    // A manifest this client cannot read is as much a "come back later" as a dropped connection: no
    // release id is known, so there is nothing to download, validate or install.
    remoteFake.state.manifest = manifestFor(bundledRelease as unknown as ReleaseShape, {
      checksum: "not-a-checksum",
    });

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "network",
    });

    await expectBundledStillActive();
  });

  test("classifies a payload transport failure as validation and preserves the release", async () => {
    const next = derivedRelease("remote-download-fails");
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releaseError = "connection reset";

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "validation",
    });

    expect(recorded.stageCalls).toEqual([]);
    await expectBundledStillActive();
  });

  test("classifies a missing payload as validation and preserves the release", async () => {
    remoteFake.state.manifest = manifestFor(derivedRelease("remote-vanished"));

    await expect(buildEngine().checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "validation",
    });

    await expectBundledStillActive();
  });

  test("classifies a local database read failure as database without touching the remote", async () => {
    const engine = new CourseSyncEngine(
      new SupabaseCourseRemote(remoteFake.client),
      recorded.installer,
      {
        getActiveRelease: () => Promise.reject(new Error("database disk image is malformed")),
      },
      bundledRelease.id,
      { appVersion: APP_VERSION, scheduleCleanup: (run) => cleanupTasks.push(run) },
    );
    remoteFake.state.manifest = manifestFor(derivedRelease("remote-unreachable-local"));

    await expect(engine.checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "database",
    });

    expect(remoteFake.calls.release).toEqual([]);
    expect(recorded.stageCalls).toEqual([]);
  });

  test("hands a concurrent caller the check already running", async () => {
    remoteFake.state.manifest = null;
    const engine = buildEngine();

    const [first, second] = await Promise.all([engine.checkForUpdate(), engine.checkForUpdate()]);

    expect(first).toEqual({ kind: "current" });
    expect(second).toEqual({ kind: "current" });
    expect(remoteFake.calls.manifest).toBe(1);

    // A later check is a fresh one, not the memoized result.
    await engine.checkForUpdate();
    expect(remoteFake.calls.manifest).toBe(2);
  });
});

describe("course sync engine install failures", () => {
  test("classifies a failed install as database and leaves the previous release usable", async () => {
    const driver = new FailingLessonInsertDriver(":memory:");
    await migrateDatabase(driver);
    const repository = new SqliteCourseRepository(driver);

    // The bundled release has to be installed before the lesson-insert override can bite, so it is
    // written through a plain driver first and the override is armed afterwards.
    driver.failLessonInserts = false;
    await new ReleaseInstaller(driver, repository).stageAndActivate(bundledCourse, {
      verifyChecksum: false,
    });
    driver.failLessonInserts = true;

    let notifications = 0;
    repository.subscribe(() => {
      notifications += 1;
    });

    const remoteFake = createFakeCourseClient();
    const next = derivedRelease("remote-install-fails");
    remoteFake.state.manifest = manifestFor(next);
    remoteFake.state.releases.set("remote-install-fails", next);

    const cleanupTasks: (() => Promise<unknown>)[] = [];
    const engine = new CourseSyncEngine(
      new SupabaseCourseRemote(remoteFake.client),
      new ReleaseInstaller(driver, repository),
      repository,
      bundledRelease.id,
      { appVersion: APP_VERSION, scheduleCleanup: (run) => cleanupTasks.push(run) },
    );

    await expect(engine.checkForUpdate()).resolves.toEqual<CourseSyncResult>({
      kind: "failed",
      category: "database",
    });

    await expect(readMetadata(driver, ACTIVE_RELEASE_KEY)).resolves.toBe(bundledRelease.id);
    await expect(repository.getActiveRelease()).resolves.toEqual(bundledRelease);
    await expect(
      driver.first("SELECT id FROM content_releases WHERE id = ?", ["remote-install-fails"]),
    ).resolves.toBeNull();
    expect(notifications).toBe(0);
    expect(cleanupTasks).toEqual([]);

    await driver.close();
  });
});
