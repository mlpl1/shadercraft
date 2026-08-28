import type { DatabaseDriver } from "../database/driver";
import { parseCourseRelease } from "./schema";
import type { CourseRepository } from "./course-repository";
import type {
  CourseLesson,
  CourseModule,
  CourseRelease,
  ModuleStatus,
  Tutorial,
  TutorialChoice,
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
  takeaway: string;
  try_this: string | null;
};

type TutorialRow = {
  id: string;
  module_id: string;
  position: number;
  title: string;
  summary: string;
};

type TutorialStepRow = {
  id: string;
  tutorial_id: string;
  position: number;
  title: string;
  brief: string;
  source_template: string;
  answer_choices_json: string;
  correct_choice_id: string;
  helpers: string | null;
  hint: string | null;
};

type StageRow = {
  id: string;
  lesson_id: string;
  position: number;
  title: string;
  body: string;
  source: string;
  helpers: string | null;
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

    const [moduleRows, lessonRows, stageRows, tutorialRows, tutorialStepRows] = await Promise.all([
      this.driver.all<ModuleRow>(
        `SELECT id, position, status, title, description, planned_lesson_count,
                planned_topics_json
         FROM modules
         WHERE release_id = ?
         ORDER BY position`,
        [release.id],
      ),
      this.driver.all<LessonRow>(
        `SELECT id, module_id, position, title, short_title, intro, takeaway, try_this
         FROM lessons
         WHERE release_id = ?
         ORDER BY module_id, position`,
        [release.id],
      ),
      this.driver.all<StageRow>(
        `SELECT id, lesson_id, position, title, body, source, helpers
         FROM lesson_stages
         WHERE release_id = ?
         ORDER BY lesson_id, position`,
        [release.id],
      ),
      this.driver.all<TutorialRow>(
        `SELECT id, module_id, position, title, summary
         FROM tutorials
         WHERE release_id = ?
         ORDER BY module_id, position`,
        [release.id],
      ),
      this.driver.all<TutorialStepRow>(
        `SELECT id, tutorial_id, position, title, brief, source_template, answer_choices_json,
                correct_choice_id, helpers, hint
         FROM tutorial_steps
         WHERE release_id = ?
         ORDER BY tutorial_id, position`,
        [release.id],
      ),
    ]);

    const stagesByLesson = groupBy(stageRows, ({ lesson_id }) => lesson_id);
    const lessonsByModule = groupBy(lessonRows, ({ module_id }) => module_id);
    const stepsByTutorial = groupBy(tutorialStepRows, ({ tutorial_id }) => tutorial_id);
    const tutorialsByModule = groupBy(tutorialRows, ({ module_id }) => module_id);

    const modules: CourseModule[] = moduleRows.map((module) => ({
      id: module.id,
      position: module.position,
      status: module.status,
      title: module.title,
      description: module.description,
      plannedLessonCount: module.planned_lesson_count,
      plannedTopics: parseJson<string[]>(module.planned_topics_json),
      lessons: (lessonsByModule.get(module.id) ?? []).map((lesson) =>
        toLesson(lesson, stagesByLesson),
      ),
      // Absent rather than empty for a module with no exercises: `parseCourseRelease` rejects an
      // empty list precisely so "none" has one representation, and this read feeds straight into it.
      ...toTutorials(tutorialsByModule.get(module.id), stepsByTutorial),
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

/**
 * Returns a spreadable fragment rather than a value, so a module with no tutorials omits the key
 * entirely instead of carrying an empty array — which `parseCourseRelease` rejects on purpose.
 */
function toTutorials(
  rows: readonly TutorialRow[] | undefined,
  stepsByTutorial: ReadonlyMap<string, TutorialStepRow[]>,
): { tutorials?: Tutorial[] } {
  if (!rows || rows.length === 0) return {};

  return {
    tutorials: rows.map((tutorial) => ({
      id: tutorial.id,
      moduleId: tutorial.module_id,
      position: tutorial.position,
      title: tutorial.title,
      summary: tutorial.summary,
      steps: (stepsByTutorial.get(tutorial.id) ?? []).map((step) => ({
        id: step.id,
        position: step.position,
        title: step.title,
        brief: step.brief,
        sourceTemplate: step.source_template,
        answerChoices: JSON.parse(step.answer_choices_json) as TutorialChoice[],
        correctChoiceId: step.correct_choice_id,
        // Nullable columns; the domain type uses an absent field for the same thing.
        ...(step.helpers === null ? {} : { helpers: step.helpers }),
        ...(step.hint === null ? {} : { hint: step.hint }),
      })),
    })),
  };
}

function toLesson(
  lesson: LessonRow,
  stagesByLesson: ReadonlyMap<string, StageRow[]>,
): CourseLesson {
  return {
    id: lesson.id,
    moduleId: lesson.module_id,
    position: lesson.position,
    title: lesson.title,
    shortTitle: lesson.short_title,
    intro: lesson.intro,
    takeaway: lesson.takeaway,
    // An unauthored tryThis is absent rather than null, matching the authored release shape.
    ...(lesson.try_this === null ? {} : { tryThis: lesson.try_this }),
    stages: (stagesByLesson.get(lesson.id) ?? []).map((stage) => ({
      id: stage.id,
      position: stage.position,
      title: stage.title,
      body: stage.body,
      source: stage.source,
      // Column is nullable; the domain type uses an absent field for the same thing.
      ...(stage.helpers === null ? {} : { helpers: stage.helpers }),
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
