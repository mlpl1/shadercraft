import { parseCourseRelease } from "../course/schema";
import type { CourseRelease } from "../course/types";
import type { DatabaseDriver } from "./driver";

export async function installBundledRelease(
  driver: DatabaseDriver,
  bundledRelease: unknown,
): Promise<void> {
  const release = parseCourseRelease(bundledRelease);

  await driver.transaction(async () => {
    const installed = await driver.first<{ checksum: string }>(
      "SELECT checksum FROM content_releases WHERE id = ?",
      [release.id],
    );

    if (installed) {
      if (installed.checksum !== release.checksum) {
        throw new Error(`Release ${release.id} is already installed with a different checksum`);
      }
      return;
    }

    await insertRelease(driver, release);
    await driver.run(
      `INSERT INTO app_metadata (key, value)
       VALUES ('active_release_id', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [release.id],
    );
  });
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
          [
            release.id,
            section.id,
            lesson.id,
            section.position,
            section.title,
            section.body,
          ],
        );
      }
    }
  }
}
