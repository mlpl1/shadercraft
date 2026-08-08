import type { DatabaseDriver } from "../database/driver";

/** A learner's in-progress attempt at one step, and whether they have marked it done. */
export type TutorialStepState = {
  /** What the learner last had in the editor, or `undefined` if they have not touched this step. */
  draft?: string;
  completed: boolean;
};

/**
 * Per-learner tutorial state: work in progress, and which steps are marked done.
 *
 * Deliberately separate from `SketchRepository` even though both store learner GLSL. A sketch is a
 * document the learner named, lists, and deletes; a draft is anonymous, belongs to exactly one step,
 * and is meaningless away from it. Sharing a table would have meant tutorial drafts appearing in the
 * Editor tab's sketch list.
 *
 * Completion is local-only. `lesson_progress` syncs through the outbox, but the outbox and the
 * remote schema only know about lessons; teaching them about steps is a change of its own, and
 * nothing about the tutorial UI depends on it having happened.
 */
export interface TutorialProgressRepository {
  /** Every step of one tutorial the learner has state for, keyed by step id. */
  getStates(profileId: string, stepIds: readonly string[]): Promise<Map<string, TutorialStepState>>;
  saveDraft(profileId: string, stepId: string, source: string): Promise<void>;
  /** Drops the draft so the step reopens on its starter source. */
  clearDraft(profileId: string, stepId: string): Promise<void>;
  setCompleted(profileId: string, stepId: string, completed: boolean): Promise<void>;
  /** Step ids the learner has marked done, across every tutorial. */
  getCompletedStepIds(profileId: string): Promise<Set<string>>;
}

type DraftRow = { step_id: string; source: string };
type ProgressRow = { step_id: string; completed: number };

export class SqliteTutorialProgressRepository implements TutorialProgressRepository {
  constructor(private readonly driver: DatabaseDriver) {}

  async getStates(
    profileId: string,
    stepIds: readonly string[],
  ): Promise<Map<string, TutorialStepState>> {
    const states = new Map<string, TutorialStepState>();
    if (stepIds.length === 0) return states;

    // Built rather than passed as one array parameter: the driver binds scalars, and a tutorial has
    // few enough steps that a placeholder per id costs nothing.
    const placeholders = stepIds.map(() => "?").join(", ");
    const params = [profileId, ...stepIds];

    const [drafts, progress] = await Promise.all([
      this.driver.all<DraftRow>(
        `SELECT step_id, source FROM tutorial_step_drafts
         WHERE profile_id = ? AND step_id IN (${placeholders})`,
        params,
      ),
      this.driver.all<ProgressRow>(
        `SELECT step_id, completed FROM tutorial_step_progress
         WHERE profile_id = ? AND step_id IN (${placeholders})`,
        params,
      ),
    ]);

    const upsert = (stepId: string, patch: Partial<TutorialStepState>) => {
      states.set(stepId, { completed: false, ...states.get(stepId), ...patch });
    };

    for (const row of drafts) upsert(row.step_id, { draft: row.source });
    for (const row of progress) upsert(row.step_id, { completed: row.completed === 1 });

    return states;
  }

  async saveDraft(profileId: string, stepId: string, source: string): Promise<void> {
    await this.driver.run(
      `INSERT INTO tutorial_step_drafts (profile_id, step_id, source, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (profile_id, step_id)
       DO UPDATE SET source = excluded.source, updated_at = excluded.updated_at`,
      [profileId, stepId, source, new Date().toISOString()],
    );
  }

  async clearDraft(profileId: string, stepId: string): Promise<void> {
    await this.driver.run(
      "DELETE FROM tutorial_step_drafts WHERE profile_id = ? AND step_id = ?",
      [profileId, stepId],
    );
  }

  async setCompleted(profileId: string, stepId: string, completed: boolean): Promise<void> {
    await this.driver.run(
      `INSERT INTO tutorial_step_progress (profile_id, step_id, completed, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (profile_id, step_id)
       DO UPDATE SET completed = excluded.completed, updated_at = excluded.updated_at`,
      [profileId, stepId, completed ? 1 : 0, new Date().toISOString()],
    );
  }

  async getCompletedStepIds(profileId: string): Promise<Set<string>> {
    const rows = await this.driver.all<{ step_id: string }>(
      "SELECT step_id FROM tutorial_step_progress WHERE profile_id = ? AND completed = 1",
      [profileId],
    );
    return new Set(rows.map((row) => row.step_id));
  }
}
