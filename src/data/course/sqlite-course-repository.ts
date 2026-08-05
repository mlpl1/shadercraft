import type { DatabaseDriver } from "../database/driver";
import { parseCourseRelease } from "./schema";
import type { CourseRepository } from "./course-repository";
import type {
  CourseLesson,
  CourseModule,
  CourseRelease,
  LessonPreset,
  ModuleStatus,
} from "./types";

type ReleaseRow = {
  id: string;
  schema_version: number;
  minimum_app_version: string;
  checksum: string;
};

type ModuleRow = {
  id: string;
  position: number;
  status: ModuleStatus;
  title: string;
  description: string;
  planned_lesson_count: number;
  planned_topics_json: string;
};

type LessonRow = {
  id: string;
  module_id: string;
  position: number;
  title: string;
  short_title: string;
  intro: string;
  concept_title: string;
  concept_lede: string;
  try_hint: string;
  takeaway: string;
  preview_caption: string;
  default_preset_id: string | null;
  intro_eyebrow: string | null;
};

type PresetRow = {
  id: string;
  lesson_id: string;
  position: number;
  label: string;
  preview_key: LessonPreset["previewKey"];
  preview_parameters_json: string;
  value: string;
  preview_value_label: string | null;
  filename: string;
  code_lines_json: string;
  highlighted_lines_json: string;
};

type SectionRow = {
  id: string;
  lesson_id: string;
  position: number;
  title: string;
  body: string;
};

export class SqliteCourseRepository implements CourseRepository {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly driver: DatabaseDriver) {}

  async getActiveRelease(): Promise<CourseRelease> {
    const release = await this.driver.first<ReleaseRow>(
      `SELECT releases.id, releases.schema_version, releases.minimum_app_version,
              releases.checksum
       FROM content_releases AS releases
       INNER JOIN app_metadata AS metadata
         ON metadata.key = 'active_release_id' AND metadata.value = releases.id`,
    );

    if (!release) {
      throw new Error("No active course release is installed");
    }

    const [moduleRows, lessonRows, presetRows, sectionRows] = await Promise.all([
      this.driver.all<ModuleRow>(
        `SELECT id, position, status, title, description, planned_lesson_count,
                planned_topics_json
         FROM modules
         WHERE release_id = ?
         ORDER BY position`,
        [release.id],
      ),
      this.driver.all<LessonRow>(
        `SELECT id, module_id, position, title, short_title, intro, concept_title,
                concept_lede, try_hint, takeaway, preview_caption, default_preset_id,
                intro_eyebrow
         FROM lessons
         WHERE release_id = ?
         ORDER BY module_id, position`,
        [release.id],
      ),
      this.driver.all<PresetRow>(
        `SELECT id, lesson_id, position, label, preview_key,
                preview_parameters_json, value, preview_value_label, filename, code_lines_json,
                highlighted_lines_json
         FROM lesson_presets
         WHERE release_id = ?
         ORDER BY lesson_id, position`,
        [release.id],
      ),
      this.driver.all<SectionRow>(
        `SELECT id, lesson_id, position, title, body
         FROM lesson_sections
         WHERE release_id = ?
         ORDER BY lesson_id, position`,
        [release.id],
      ),
    ]);

    const presetsByLesson = groupBy(presetRows, ({ lesson_id }) => lesson_id);
    const sectionsByLesson = groupBy(sectionRows, ({ lesson_id }) => lesson_id);
    const lessonsByModule = groupBy(lessonRows, ({ module_id }) => module_id);

    const modules: CourseModule[] = moduleRows.map((module) => ({
      id: module.id,
      position: module.position,
      status: module.status,
      title: module.title,
      description: module.description,
      plannedLessonCount: module.planned_lesson_count,
      plannedTopics: parseJson<string[]>(module.planned_topics_json),
      lessons: (lessonsByModule.get(module.id) ?? []).map((lesson) =>
        toLesson(lesson, presetsByLesson, sectionsByLesson),
      ),
    }));

    return parseCourseRelease({
      id: release.id,
      schemaVersion: release.schema_version,
      minimumAppVersion: release.minimum_app_version,
      checksum: release.checksum,
      modules,
    });
  }

  async getModules(): Promise<CourseModule[]> {
    return (await this.getActiveRelease()).modules;
  }

  async getLesson(lessonId: string): Promise<CourseLesson | null> {
    const modules = await this.getModules();
    return modules.flatMap(({ lessons }) => lessons).find(({ id }) => id === lessonId) ?? null;
  }

  async getPublishedLessonIds(): Promise<string[]> {
    const modules = await this.getModules();
    return modules
      .filter(({ status }) => status === "published")
      .flatMap(({ lessons }) => lessons.map(({ id }) => id));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Tells subscribers the active release changed, so screens re-read the curriculum.
   *
   * Called by {@link ../course/release-installer.ReleaseInstaller} after — and only after — an
   * activation commits: a repository cannot observe `app_metadata.active_release_id` changing
   * underneath it, and notifying from inside the installer's transaction would let a listener read
   * (or fail to read) a release that a later rollback erases.
   */
  onActiveReleaseChanged(): void {
    this.notifySubscribers();
  }

  protected notifySubscribers(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function toLesson(
  lesson: LessonRow,
  presetsByLesson: ReadonlyMap<string, PresetRow[]>,
  sectionsByLesson: ReadonlyMap<string, SectionRow[]>,
): CourseLesson {
  return {
    id: lesson.id,
    moduleId: lesson.module_id,
    position: lesson.position,
    title: lesson.title,
    shortTitle: lesson.short_title,
    intro: lesson.intro,
    conceptTitle: lesson.concept_title,
    conceptLede: lesson.concept_lede,
    tryHint: lesson.try_hint,
    takeaway: lesson.takeaway,
    previewCaption: lesson.preview_caption,
    // An unauthored default preset is absent rather than null, matching the authored release shape.
    ...(lesson.default_preset_id === null
      ? {}
      : { defaultPresetId: lesson.default_preset_id }),
    ...(lesson.intro_eyebrow === null ? {} : { introEyebrow: lesson.intro_eyebrow }),
    presets: (presetsByLesson.get(lesson.id) ?? []).map((preset) => ({
      id: preset.id,
      position: preset.position,
      label: preset.label,
      previewKey: preset.preview_key,
      previewParameters: parseJson<LessonPreset["previewParameters"]>(
        preset.preview_parameters_json,
      ),
      value: preset.value,
      ...(preset.preview_value_label === null
        ? {}
        : { previewValueLabel: preset.preview_value_label }),
      filename: preset.filename,
      codeLines: parseJson<string[]>(preset.code_lines_json),
      highlightedLines: parseJson<number[]>(preset.highlighted_lines_json),
    })),
    sections: (sectionsByLesson.get(lesson.id) ?? []).map((section) => ({
      id: section.id,
      position: section.position,
      title: section.title,
      body: section.body,
    })),
  };
}

function groupBy<Row>(rows: readonly Row[], getKey: (row: Row) => string): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = getKey(row);
    const group = grouped.get(key);
    if (group) {
      group.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }
  return grouped;
}

function parseJson<T>(json: string): T {
  return JSON.parse(json) as T;
}
