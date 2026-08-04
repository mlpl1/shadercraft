import * as Crypto from "expo-crypto";

import type { DatabaseDriver } from "../database/driver";
import { releaseChecksumInput } from "./canonicalize";
import { parseCourseRelease } from "./schema";
import type { CourseRelease } from "./types";

/** `app_metadata` key naming the release every read goes through. */
export const ACTIVE_RELEASE_KEY = "active_release_id";

/**
 * `app_metadata` key naming the release that was active immediately before the current one.
 *
 * Durable rather than in-memory on purpose: cleanup has to keep the previous release as a rollback
 * target across process restarts, and a freshly launched app has no memory of what it activated
 * yesterday. Stored in `app_metadata` (an existing generic key/value table) rather than as a new
 * `content_releases` column, so this task adds no migration to the schema every offline user's
 * database already has — see the task report for the full rationale.
 */
export const PREVIOUS_ACTIVE_RELEASE_KEY = "previous_active_release_id";

export type ReleaseInstallOutcome = {
  /** `unchanged` when the release was already installed *and* already active. */
  status: "activated" | "unchanged";
  releaseId: string;
};

export type StageAndActivateOptions = {
  /**
   * The checksum the remote manifest advertised for this release, when the payload came from a
   * manifest. Guards against a payload/manifest disagreement, not just self-consistency.
   */
  manifestChecksum?: string;
  /**
   * Whether to recompute the payload's checksum on device. Defaults to `true`; only the bundled
   * seed path opts out, because its checksum is already verified at build time by
   * `npm run content:check` and the asset ships inside the signed application bundle.
   */
  verifyChecksum?: boolean;
};

/**
 * The notification hook the installer needs from the course repository. Narrowed to one method so
 * the installer does not depend on the whole `CourseRepository` read surface.
 */
export type ActiveReleaseObserver = {
  onActiveReleaseChanged(): void;
};

/**
 * Recomputes a downloaded release's SHA-256 checksum on device and rejects unless it matches the
 * payload's own `checksum` and, when supplied, the manifest's.
 *
 * Hashes {@link releaseChecksumInput} — the exact bytes `scripts/content/node-checksum.ts` hashes
 * with `node:crypto` — so the publishing tooling and the device can never disagree about what a
 * release's checksum is.
 */
export async function verifyReleaseChecksum(
  release: CourseRelease,
  manifestChecksum?: string,
): Promise<void> {
  if (manifestChecksum !== undefined && manifestChecksum !== release.checksum) {
    throw new Error(
      `Release ${release.id} payload checksum ${release.checksum} does not match the manifest ` +
        `checksum ${manifestChecksum}`,
    );
  }

  const digest = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      releaseChecksumInput(release),
    )
  ).toLowerCase();

  if (digest !== release.checksum.toLowerCase()) {
    throw new Error(
      `Release ${release.id} content hashes to ${digest}, which does not match its declared ` +
        `checksum ${release.checksum}`,
    );
  }
}

/**
 * Installs course releases into SQLite and switches the active release atomically.
 *
 * The one installation path for both the bundled seed and downloaded remote releases, so both get
 * the same ordering guarantees. Two rules shape the whole class:
 *
 * 1. Everything that can reject — schema/content validation and checksum verification — happens
 *    *before* the transaction opens. That keeps failures from ever touching SQLite, and it is also
 *    a hard requirement of {@link ../database/transaction-queue.TransactionQueue}: nothing called
 *    from inside the transaction body may open a transaction of its own.
 * 2. `active_release_id` is written last, after every release-scoped row exists. A crash or error
 *    at any earlier point rolls the whole transaction back and leaves the previously active release
 *    exactly as usable offline as it was — the app never points at a half-written release.
 *
 * Subscribers are notified once, after the commit, and never on a failed or no-op install.
 * Reclaiming disk from superseded releases is deliberately a separate operation
 * ({@link deleteSupersededReleases}) so it can never run inside the activation transaction.
 */
export class ReleaseInstaller {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly observer?: ActiveReleaseObserver | null,
  ) {}

  async stageAndActivate(
    payload: unknown,
    { manifestChecksum, verifyChecksum = true }: StageAndActivateOptions = {},
  ): Promise<ReleaseInstallOutcome> {
    // Validate and verify outside the transaction: see the class doc's rule 1.
    const release = parseCourseRelease(payload);
    if (verifyChecksum) {
      await verifyReleaseChecksum(release, manifestChecksum);
    }

    const outcome = await this.driver.transaction<ReleaseInstallOutcome>(async () => {
      const installed = await this.driver.first<{ checksum: string }>(
        "SELECT checksum FROM content_releases WHERE id = ?",
        [release.id],
      );

      if (installed && installed.checksum !== release.checksum) {
        // Published releases are immutable, so the same id with different content means the two
        // disagree about what that release *is*. Refusing keeps the installed copy authoritative.
        throw new Error(
          `Release ${release.id} is already installed with a different checksum`,
        );
      }

      const activeReleaseId =
        (
          await this.driver.first<{ value: string }>(
            "SELECT value FROM app_metadata WHERE key = ?",
            [ACTIVE_RELEASE_KEY],
          )
        )?.value ?? null;

      if (installed && activeReleaseId === release.id) {
        return { status: "unchanged", releaseId: release.id };
      }

      if (!installed) {
        await insertRelease(this.driver, release);
      }

      if (activeReleaseId !== null) {
        await writeMetadata(this.driver, PREVIOUS_ACTIVE_RELEASE_KEY, activeReleaseId);
      }
      // Last write of the transaction: until this commits, every read still sees the old release.
      await writeMetadata(this.driver, ACTIVE_RELEASE_KEY, release.id);

      return { status: "activated", releaseId: release.id };
    });

    if (outcome.status === "activated") {
      this.observer?.onActiveReleaseChanged();
    }

    return outcome;
  }

  /**
   * Deletes downloaded releases that are no longer needed, returning the ids removed.
   *
   * Retains, unconditionally:
   * - the bundled release, so a device can always fall back to the curriculum it shipped with,
   *   even when it is also the active release;
   * - the active release;
   * - the most recently active prior release, as a rollback target.
   *
   * Never called from inside the activation transaction — reclaiming disk is not part of making a
   * release usable, and mixing the two would put unrelated deletes at risk of rolling back an
   * activation (and vice versa).
   */
  async deleteSupersededReleases(bundledReleaseId: string): Promise<string[]> {
    return this.driver.transaction(async () => {
      const retained = new Set(
        [
          bundledReleaseId,
          await readMetadata(this.driver, ACTIVE_RELEASE_KEY),
          await readMetadata(this.driver, PREVIOUS_ACTIVE_RELEASE_KEY),
        ].filter((id): id is string => id !== null),
      );

      const installed = await this.driver.all<{ id: string }>(
        "SELECT id FROM content_releases ORDER BY id",
      );
      const deletable = installed.map(({ id }) => id).filter((id) => !retained.has(id));

      for (const id of deletable) {
        // Deleted child-first and explicitly rather than trusting ON DELETE CASCADE, so the outcome
        // does not depend on `PRAGMA foreign_keys` being on for this connection.
        await this.driver.run("DELETE FROM lesson_sections WHERE release_id = ?", [id]);
        await this.driver.run("DELETE FROM lesson_presets WHERE release_id = ?", [id]);
        await this.driver.run("DELETE FROM lessons WHERE release_id = ?", [id]);
        await this.driver.run("DELETE FROM modules WHERE release_id = ?", [id]);
        await this.driver.run("DELETE FROM content_releases WHERE id = ?", [id]);
      }

      return deletable;
    });
  }
}

async function readMetadata(driver: DatabaseDriver, key: string): Promise<string | null> {
  const row = await driver.first<{ value: string }>(
    "SELECT value FROM app_metadata WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

async function writeMetadata(
  driver: DatabaseDriver,
  key: string,
  value: string,
): Promise<void> {
  await driver.run(
    `INSERT INTO app_metadata (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

async function insertRelease(driver: DatabaseDriver, release: CourseRelease): Promise<void> {
  await driver.run(
    `INSERT INTO content_releases
      (id, schema_version, minimum_app_version, checksum)
     VALUES (?, ?, ?, ?)`,
    [release.id, release.schemaVersion, release.minimumAppVersion, release.checksum],
  );

  for (const module of release.modules) {
    await driver.run(
      `INSERT INTO modules
        (release_id, id, position, status, title, description,
         planned_lesson_count, planned_topics_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        release.id,
        module.id,
        module.position,
        module.status,
        module.title,
        module.description,
        module.plannedLessonCount,
        JSON.stringify(module.plannedTopics),
      ],
    );

    for (const lesson of module.lessons) {
      await driver.run(
        `INSERT INTO lessons
          (release_id, id, module_id, position, title, short_title, intro,
           concept_title, concept_lede, try_hint, takeaway, preview_caption,
           default_preset_id, intro_eyebrow)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          release.id,
          lesson.id,
          module.id,
          lesson.position,
          lesson.title,
          lesson.shortTitle,
          lesson.intro,
          lesson.conceptTitle,
          lesson.conceptLede,
          lesson.tryHint,
          lesson.takeaway,
          lesson.previewCaption,
          lesson.defaultPresetId ?? null,
          lesson.introEyebrow ?? null,
        ],
      );

      for (const preset of lesson.presets) {
        await driver.run(
          `INSERT INTO lesson_presets
            (release_id, id, lesson_id, position, label, preview_key,
             preview_parameters_json, value, preview_value_label, filename, code_lines_json,
             highlighted_lines_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            release.id,
            preset.id,
            lesson.id,
            preset.position,
            preset.label,
            preset.previewKey,
            JSON.stringify(preset.previewParameters),
            preset.value,
            preset.previewValueLabel ?? null,
            preset.filename,
            JSON.stringify(preset.codeLines),
            JSON.stringify(preset.highlightedLines),
          ],
        );
      }

      for (const section of lesson.sections) {
        await driver.run(
          `INSERT INTO lesson_sections
            (release_id, id, lesson_id, position, title, body)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [release.id, section.id, lesson.id, section.position, section.title, section.body],
        );
      }
    }
  }
}
