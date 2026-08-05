import type {
  ReleaseInstallOutcome,
  StageAndActivateOptions,
} from "../course/release-installer";
import { verifyReleaseChecksum } from "../course/release-installer";
import type { CourseRelease } from "../course/types";
import type { CourseReleaseManifest, CourseRemote } from "./course-remote";

/**
 * The one content schema version this build can read. Enforced by `parseCourseRelease`
 * (`schemaVersion: z.literal(1)`), so a release on any other version cannot be turned into a
 * `CourseRelease` at all — which is why the manifest's `schemaVersion` is checked here, before the
 * payload is ever downloaded.
 */
export const SUPPORTED_CONTENT_SCHEMA_VERSION = 1;

/**
 * Why a check did not end in a usable release. Deliberately coarse — no server text, no stack, no
 * release contents — because the only consumer is `CourseSyncScheduler`, which needs to decide
 * whether to retry and what non-blocking state to publish, not to explain a database to a learner.
 *
 * - `network` — the active manifest could not be read (a dropped connection, or a manifest this
 *   client cannot parse). Nothing about the remote curriculum is known, so nothing was attempted.
 * - `protocol` — the two sides disagree about the world: a manifest reusing an installed release id
 *   with a different checksum (releases are immutable), or a payload whose identity does not match
 *   the manifest that advertised it.
 * - `validation` — a payload was fetched but is not something this build may install: it failed
 *   schema/content validation (an unknown preview key, an out-of-range highlight), it could not be
 *   fetched at all, or its content does not hash to the advertised checksum.
 * - `database` — the local database could not be read, or the install transaction failed and rolled
 *   back. The previously active release is untouched.
 */
export type CourseSyncFailureCategory = "network" | "protocol" | "validation" | "database";

export type CourseSyncResult =
  | { kind: "current" }
  | { kind: "updated"; releaseId: string }
  | { kind: "requires-app-update"; minimumAppVersion: string }
  | { kind: "failed"; category: CourseSyncFailureCategory };

/**
 * The installer surface this engine needs, narrowed from `ReleaseInstaller` to two methods so a
 * caller (and `DataContext`) never has to pass the whole class, and a test double never has to
 * impersonate one.
 */
export type CourseReleaseInstallerLike = {
  stageAndActivate(
    payload: unknown,
    options?: StageAndActivateOptions,
  ): Promise<ReleaseInstallOutcome>;
  deleteSupersededReleases(bundledReleaseId: string): Promise<string[]>;
};

/**
 * The one thing the engine reads locally: which release the device is serving right now. Narrowed
 * from `CourseRepository` for the same reason as above; `SqliteCourseRepository` satisfies it.
 */
export type ActiveReleaseReader = {
  getActiveRelease(): Promise<CourseRelease>;
};

export type CourseSyncEngineOptions = {
  /**
   * The running app's version, as `Constants.expoConfig?.version` reports it, or `null` when the
   * build does not state one. Injected rather than read here so the engine stays free of native
   * modules — the same separation `SyncScheduler` keeps from `expo-network`.
   */
  appVersion: string | null;
  supportedSchemaVersion?: number;
  /**
   * How to defer inactive-release cleanup. Called only after an activation has committed, never from
   * inside it. The default hands the work to the microtask queue and swallows its rejection: cleanup
   * reclaims disk, and failing to reclaim disk must not turn a successful update into a failed one.
   */
  scheduleCleanup?: (run: () => Promise<unknown>) => void;
};

const STRICT_SEMANTIC_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Compares two strict three-component versions numerically, returning -1/0/1, or `null` when either
 * side is not exactly `\d+.\d+.\d+`.
 *
 * Numerically, not lexically: string comparison sorts `"10.0.0"` *before* `"9.0.0"`, which would
 * make a modern app refuse a release it satisfies comfortably. `null` rather than a throw or a
 * guessed ordering, because "this is not a version I can compare" is a distinct answer the caller has
 * to handle deliberately (see {@link CourseSyncEngine.checkForUpdate}).
 */
export function compareAppVersions(left: string, right: string): number | null {
  const leftParts = STRICT_SEMANTIC_VERSION.exec(left);
  const rightParts = STRICT_SEMANTIC_VERSION.exec(right);
  if (!leftParts || !rightParts) return null;

  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(leftParts[index]) - Number(rightParts[index]);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

/** A failure the engine raises itself, carrying the category it should be reported as. */
class CourseSyncFailure extends Error {
  constructor(
    readonly category: CourseSyncFailureCategory,
    message: string,
  ) {
    super(message);
    this.name = "CourseSyncFailure";
  }
}

const DEFAULT_SCHEDULE_CLEANUP = (run: () => Promise<unknown>): void => {
  void Promise.resolve()
    .then(run)
    .catch(() => {
      // Disk reclamation is best-effort; the next successful activation schedules it again.
    });
};

/**
 * Decides whether a published curriculum release applies to *this* device, and installs it when it
 * does.
 *
 * The engine is the only thing in the app that may hand a payload to `ReleaseInstaller`, and it is
 * where every compatibility rule lives, because the installer deliberately has none: it will happily
 * write any structurally valid release, including one that needs an app this device is not running.
 * The order below is therefore load-bearing, and every step is cheap-before-expensive and
 * refuse-before-write:
 *
 * 1. Read the remote manifest. No manifest means no remote release; that is `current`, not an error.
 * 2. Read the active local release, so "already installed" can be answered without a download.
 * 3. Refuse a manifest that reuses the installed id with a different checksum — releases are
 *    immutable, so that is the two sides disagreeing, not an update.
 * 4. Gate on the content schema version and on `minimumAppVersion` *from the manifest*, before any
 *    payload is fetched. An incompatible release costs no bandwidth and never reaches the installer.
 * 5. Download, and cross-check the payload's identity against the manifest that advertised it.
 * 6. Verify the checksum on device.
 * 7. Only then install, inside the installer's single transaction.
 *
 * Every failure resolves to a `failed` result rather than rejecting: the scheduler above needs a
 * classification, and the previously active release stays exactly as usable offline as it was in all
 * of them. Concurrent callers share the in-flight check, matching `ProgressSyncEngine.sync`.
 */
export class CourseSyncEngine {
  private readonly appVersion: string | null;
  private readonly supportedSchemaVersion: number;
  private readonly scheduleCleanup: (run: () => Promise<unknown>) => void;
  private inFlight: Promise<CourseSyncResult> | null = null;

  constructor(
    private readonly remote: CourseRemote,
    private readonly installer: CourseReleaseInstallerLike,
    private readonly course: ActiveReleaseReader,
    /**
     * The release this build ships with, which cleanup must never delete. Passed in rather than read
     * from the database because only the app bundle knows which installed release *is* the bundled
     * one — and `deleteSupersededReleases` rejects a stale id rather than trusting it.
     */
    private readonly bundledReleaseId: string,
    options: CourseSyncEngineOptions,
  ) {
    this.appVersion = options.appVersion;
    this.supportedSchemaVersion = options.supportedSchemaVersion ?? SUPPORTED_CONTENT_SCHEMA_VERSION;
    this.scheduleCleanup = options.scheduleCleanup ?? DEFAULT_SCHEDULE_CLEANUP;
  }

  checkForUpdate(): Promise<CourseSyncResult> {
    this.inFlight ??= this.runCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runCheck(): Promise<CourseSyncResult> {
    try {
      return await this.check();
    } catch (error) {
      if (error instanceof CourseSyncFailure) {
        return { kind: "failed", category: error.category };
      }
      // Nothing else should reach here: every awaited call below is wrapped. Reported as `protocol`
      // rather than rethrown, because a caller that cannot be told what went wrong still must not
      // lose its schedule to an exception.
      return { kind: "failed", category: "protocol" };
    }
  }

  private async check(): Promise<CourseSyncResult> {
    const manifest = await this.classify("network", () => this.remote.getActiveManifest());
    if (manifest === null) {
      return { kind: "current" };
    }

    const local = await this.classify("database", () => this.course.getActiveRelease());

    if (manifest.id === local.id) {
      if (manifest.checksum !== local.checksum) {
        throw new CourseSyncFailure(
          "protocol",
          `Release ${manifest.id} is installed with checksum ${local.checksum} but the manifest ` +
            `advertises ${manifest.checksum}; published releases are immutable.`,
        );
      }
      return { kind: "current" };
    }

    const compatibility = this.assessCompatibility(manifest);
    if (compatibility !== null) {
      return compatibility;
    }

    const release = await this.classify("validation", () => this.remote.getRelease(manifest.id));
    this.requireManifestAgreement(manifest, release);

    // Verified here rather than left to the installer, so a content/checksum disagreement is reported
    // as `validation` instead of being indistinguishable from a SQL failure — and so nothing that can
    // reject reaches `stageAndActivate` at all. The installer is then told not to hash the same bytes
    // a second time (which would double a multi-megabyte SHA-256 on device for no new information);
    // `manifestChecksum` is still passed so the call states the payload's provenance and stays correct
    // if that default ever changes.
    await this.classify("validation", () => verifyReleaseChecksum(release, manifest.checksum));

    const outcome = await this.classify("database", () =>
      this.installer.stageAndActivate(release, {
        manifestChecksum: manifest.checksum,
        verifyChecksum: false,
        // A remote release is downloaded precisely to become the curriculum, unlike the bundled seed
        // which runs on every cold start and must never reclaim the pointer.
        activation: "always",
      }),
    );

    if (outcome.status !== "activated") {
      return { kind: "current" };
    }

    // Scheduled, never awaited and never inside the activation: reclaiming disk is not part of making
    // a release usable, and a cleanup failure must not undo an update the learner already has.
    this.scheduleCleanup(() => this.installer.deleteSupersededReleases(this.bundledReleaseId));

    return { kind: "updated", releaseId: outcome.releaseId };
  }

  /**
   * Whether this build may install the release the manifest describes, decided from the manifest
   * alone. Returns `null` when it may, or the result to report when it may not.
   *
   * A content schema this build does not implement and a `minimumAppVersion` above the running app
   * are the same situation to a learner — only a newer app can read this release — so both answer
   * `requires-app-update`, carrying the version to install.
   *
   * An app version that is missing or not a strict `x.y.z` is treated exactly like one that is too
   * old. This build cannot *demonstrate* that it satisfies the minimum, and the cost of guessing
   * wrong is installing curriculum the app may not be able to render; the cost of refusing is that a
   * misconfigured build keeps running its previous release offline, which is the failure mode this
   * whole feature is designed to fall back to.
   */
  private assessCompatibility(manifest: CourseReleaseManifest): CourseSyncResult | null {
    if (manifest.schemaVersion !== this.supportedSchemaVersion) {
      if (manifest.schemaVersion > this.supportedSchemaVersion) {
        return { kind: "requires-app-update", minimumAppVersion: manifest.minimumAppVersion };
      }
      // A release older than the only schema this app has ever read cannot be produced by the
      // publishing tooling, so the two sides disagree about what a release is.
      throw new CourseSyncFailure(
        "protocol",
        `Release ${manifest.id} declares content schema ${manifest.schemaVersion}, which predates ` +
          `the supported version ${this.supportedSchemaVersion}.`,
      );
    }

    const ordering =
      this.appVersion === null
        ? null
        : compareAppVersions(this.appVersion, manifest.minimumAppVersion);

    if (ordering === null || ordering < 0) {
      return { kind: "requires-app-update", minimumAppVersion: manifest.minimumAppVersion };
    }

    return null;
  }

  /**
   * Confirms the downloaded payload is the release the manifest advertised — same id, same checksum,
   * same compatibility metadata.
   *
   * The checksum check here is about *identity*, not integrity: it catches the two RPCs disagreeing
   * before a single byte is hashed, and it is what makes the later `verifyReleaseChecksum` failure
   * mean "the content was corrupted" rather than "we downloaded something else entirely".
   */
  private requireManifestAgreement(manifest: CourseReleaseManifest, release: CourseRelease): void {
    const mismatch =
      release.id !== manifest.id
        ? `id ${release.id}`
        : release.checksum !== manifest.checksum
          ? `checksum ${release.checksum}`
          : release.schemaVersion !== manifest.schemaVersion
            ? `content schema ${release.schemaVersion}`
            : release.minimumAppVersion !== manifest.minimumAppVersion
              ? `minimum app version ${release.minimumAppVersion}`
              : null;

    if (mismatch !== null) {
      throw new CourseSyncFailure(
        "protocol",
        `The payload delivered for release ${manifest.id} declares ${mismatch}, which the manifest ` +
          `does not.`,
      );
    }
  }

  private async classify<T>(
    category: CourseSyncFailureCategory,
    work: () => Promise<T>,
  ): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof CourseSyncFailure) throw error;
      throw new CourseSyncFailure(
        category,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
