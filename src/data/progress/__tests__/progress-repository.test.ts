import type { DatabaseDriver, SqlValue } from "../../database/driver";
import type { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import type { SqliteProgressRepository } from "../sqlite-progress-repository";
import { createProgressRepositoryTestContext } from "./progress-repository-test-context";

describe("SQLite progress repository", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteProgressRepository;
  let createRepository: (override?: DatabaseDriver) => SqliteProgressRepository;

  beforeEach(async () => {
    ({ driver, repository, createRepository } = await createProgressRepositoryTestContext());
  });

  afterEach(async () => {
    await driver.close();
  });

  test("creates the first anonymous profile when none exists and reuses it afterward", async () => {
    const profileId = await repository.getActiveProfileId();

    expect(profileId).toBe("test-id-1");
    await expect(repository.getActiveProfileId()).resolves.toBe(profileId);
  });

  test("resolves a single profile for two concurrent calls on a cold cache", async () => {
    const [firstProfileId, secondProfileId] = await Promise.all([
      repository.getActiveProfileId(),
      repository.getActiveProfileId(),
    ]);

    expect(firstProfileId).toBe(secondProfileId);

    const profileRows = await driver.all<{ id: string }>("SELECT id FROM learner_profiles");
    expect(profileRows).toHaveLength(1);
  });

  test("completes and uncompletes a lesson, recording one mutation per explicit change", async () => {
    await repository.setLessonCompleted("color-mixing", true);
    expect(await repository.isLessonCompleted("color-mixing")).toBe(true);
    expect(await repository.getPendingMutations()).toHaveLength(1);

    await repository.setLessonCompleted("color-mixing", false);
    expect(await repository.isLessonCompleted("color-mixing")).toBe(false);
    expect(await repository.getPendingMutations()).toHaveLength(2);
  });

  test("does not record another mutation for a repeated identical explicit state", async () => {
    await repository.setLessonCompleted("color-mixing", true);
    await repository.setLessonCompleted("color-mixing", true);

    expect(await repository.isLessonCompleted("color-mixing")).toBe(true);
    expect(await repository.getPendingMutations()).toHaveLength(1);
  });

  test("reports a lesson without a progress row as not completed", async () => {
    expect(await repository.isLessonCompleted("color-mixing")).toBe(false);
  });

  test("returns completed lesson IDs in curriculum order regardless of completion order", async () => {
    await repository.setLessonCompleted("colors-fragment-output", true);
    await repository.setLessonCompleted("coordinate-systems-uv-space", true);

    await expect(repository.getCompletedLessonIds()).resolves.toEqual([
      "coordinate-systems-uv-space",
      "colors-fragment-output",
    ]);
  });

  test("keeps a row for an unpublished lesson ID but excludes it from completed totals", async () => {
    await repository.setLessonCompleted("retired-legacy-lesson", true);

    await expect(repository.getCompletedLessonIds()).resolves.toEqual([]);
    await expect(repository.isLessonCompleted("retired-legacy-lesson")).resolves.toBe(true);
  });

  test("notifies subscribers only when the explicit state actually changes", async () => {
    const listener = jest.fn();
    const unsubscribe = repository.subscribe(listener);

    await repository.setLessonCompleted("color-mixing", true);
    expect(listener).toHaveBeenCalledTimes(1);

    await repository.setLessonCompleted("color-mixing", true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await repository.setLessonCompleted("color-mixing", false);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("SQLite progress repository learner profiles", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteProgressRepository;
  let createRepository: (override?: DatabaseDriver) => SqliteProgressRepository;

  beforeEach(async () => {
    ({ driver, repository, createRepository } = await createProgressRepositoryTestContext());
  });

  afterEach(async () => {
    await driver.close();
  });

  type OutboxRow = {
    mutation_id: string;
    entity_id: string;
    payload_json: string;
    base_revision: number;
    merged_at: string | null;
  };

  async function readOutbox(profileId: string): Promise<OutboxRow[]> {
    return driver.all<OutboxRow>(
      `SELECT mutation_id, entity_id, payload_json, base_revision, merged_at
       FROM sync_outbox WHERE profile_id = ?`,
      [profileId],
    );
  }

  async function readCompletionState(profileId: string): Promise<Record<string, boolean>> {
    const rows = await driver.all<{ lesson_id: string; completed: number }>(
      `SELECT lesson_id, completed FROM lesson_progress WHERE profile_id = ? ORDER BY lesson_id`,
      [profileId],
    );
    return Object.fromEntries(rows.map((row) => [row.lesson_id, row.completed === 1]));
  }

  test("reopens the same authenticated profile for a returning Supabase user", async () => {
    await expect(repository.getProfileBySupabaseUserId("supabase-user-1")).resolves.toBeNull();

    const created = await repository.createAuthenticatedProfile("supabase-user-1");
    expect(created.kind).toBe("authenticated");
    expect(created.supabaseUserId).toBe("supabase-user-1");

    await expect(repository.createAuthenticatedProfile("supabase-user-1")).resolves.toEqual(created);
    await expect(repository.getProfileBySupabaseUserId("supabase-user-1")).resolves.toEqual(created);
    await expect(
      driver.all("SELECT id FROM learner_profiles WHERE kind = 'authenticated'"),
    ).resolves.toHaveLength(1);
  });

  test("reads progress from whichever profile is active and notifies on the switch", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    const authenticated = await repository.createAuthenticatedProfile("supabase-user-1");

    const listener = jest.fn();
    repository.subscribe(listener);
    await repository.setActiveProfile(authenticated.id);

    expect(listener).toHaveBeenCalledTimes(1);
    await expect(repository.getActiveProfileId()).resolves.toBe(authenticated.id);
    await expect(repository.isLessonCompleted("color-mixing")).resolves.toBe(false);

    await repository.setActiveProfile(anonymousId);
    await expect(repository.isLessonCompleted("color-mixing")).resolves.toBe(true);
  });

  test("refuses to activate a profile that does not exist", async () => {
    await expect(repository.setActiveProfile("no-such-profile")).rejects.toThrow(
      /no-such-profile/,
    );
  });

  test("bases merged mutations on the target profile's server revision", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    const target = await repository.createAuthenticatedProfile("supabase-user-1");
    // The account already knows this lesson as incomplete at server revision 7.
    await driver.run(
      `INSERT INTO lesson_progress
        (profile_id, lesson_id, completed, server_revision, locally_modified_at, server_updated_at)
       VALUES (?, 'color-mixing', 0, 7, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
      [target.id],
    );

    await repository.mergeAnonymousProfile(anonymousId, target.id);

    const mutations = await readOutbox(target.id);
    expect(mutations).toHaveLength(1);
    expect(mutations[0].entity_id).toBe("color-mixing");
    expect(mutations[0].base_revision).toBe(7);
    expect(JSON.parse(mutations[0].payload_json)).toEqual({
      lessonId: "color-mixing",
      completed: true,
    });
    // The server revision is the server's to move, so the merge must not invent a new one.
    await expect(
      driver.first<{ server_revision: number }>(
        `SELECT server_revision FROM lesson_progress WHERE profile_id = ? AND lesson_id = ?`,
        [target.id, "color-mixing"],
      ),
    ).resolves.toEqual({ server_revision: 7 });
  });

  test("queues no mutation for a lesson the target profile already agrees on", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    const target = await repository.createAuthenticatedProfile("supabase-user-1");
    await driver.run(
      `INSERT INTO lesson_progress
        (profile_id, lesson_id, completed, server_revision, locally_modified_at, server_updated_at)
       VALUES (?, 'color-mixing', 1, 4, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
      [target.id],
    );

    await repository.mergeAnonymousProfile(anonymousId, target.id);

    await expect(readOutbox(target.id)).resolves.toEqual([]);
    expect(await readCompletionState(target.id)).toEqual({ "color-mixing": true });
  });

  test("is idempotent when the same merge is repeated", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    await repository.setLessonCompleted("luma-and-contrast", true);
    await repository.setLessonCompleted("luma-and-contrast", false);
    const target = await repository.createAuthenticatedProfile("supabase-user-1");

    await repository.mergeAnonymousProfile(anonymousId, target.id);
    const afterFirst = await readOutbox(target.id);

    // The repeat call must take the already-merged early return and touch the database not at
    // all — not even with a no-op write — because that is the only way to tell "already merged"
    // apart from "merged again but every write happened to be a no-op", which the collapsed
    // upserts below would otherwise make indistinguishable.
    const runSpy = jest.spyOn(driver, "run");
    await repository.mergeAnonymousProfile(anonymousId, target.id);
    expect(runSpy).not.toHaveBeenCalled();
    runSpy.mockRestore();

    expect(await readOutbox(target.id)).toEqual(afterFirst);
    expect(afterFirst).toHaveLength(2);
    expect(await readCompletionState(target.id)).toEqual({
      "color-mixing": true,
      "luma-and-contrast": false,
    });
  });

  test("refuses to merge a guest profile into a second account", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    const first = await repository.createAuthenticatedProfile("supabase-user-1");
    const second = await repository.createAuthenticatedProfile("supabase-user-2");

    await repository.mergeAnonymousProfile(anonymousId, first.id);

    await expect(repository.mergeAnonymousProfile(anonymousId, second.id)).rejects.toThrow(
      /already merged/i,
    );
    expect(await readCompletionState(second.id)).toEqual({});
  });

  test("refuses to merge into a profile that has itself already been merged away", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    const target = await repository.createAuthenticatedProfile("supabase-user-1");
    await repository.mergeAnonymousProfile(anonymousId, target.id);
    // `anonymousId` is now a dead end: its progress lives at `target.id`, and no active profile
    // can ever resolve back to it.

    const secondGuest = await repository.activateEmptyAnonymousProfile();
    expect(secondGuest.id).not.toBe(anonymousId);
    await repository.setLessonCompleted("luma-and-contrast", true);

    await expect(
      repository.mergeAnonymousProfile(secondGuest.id, anonymousId),
    ).rejects.toThrow(/merged/i);

    // Nothing was written to the intermediate, now-invisible profile, and the second guest's
    // progress and mutations are still exactly where they were before the refused merge.
    expect(await readCompletionState(anonymousId)).toEqual({ "color-mixing": true });
    await expect(readOutbox(secondGuest.id)).resolves.toHaveLength(1);
    await expect(
      driver.first<{ merged_into_profile_id: string | null }>(
        `SELECT merged_into_profile_id FROM learner_profiles WHERE id = ?`,
        [secondGuest.id],
      ),
    ).resolves.toEqual({ merged_into_profile_id: null });
  });

  test("rolls the whole merge back when a statement fails partway", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    const target = await repository.createAuthenticatedProfile("supabase-user-1");

    // Fail at the point where the source mutations are marked merged: by then the target rows and
    // mutations have already been written, so a surviving partial merge would be visible.
    const failing = createRepository(
      wrapDriverFailingOn(driver, (sql) => sql.includes("UPDATE sync_outbox")),
    );
    await expect(failing.mergeAnonymousProfile(anonymousId, target.id)).rejects.toThrow(
      "simulated crash",
    );

    expect(await readCompletionState(target.id)).toEqual({});
    await expect(readOutbox(target.id)).resolves.toEqual([]);
    expect((await readOutbox(anonymousId)).filter((row) => row.merged_at !== null)).toEqual([]);
    await expect(
      driver.first<{ merged_into_profile_id: string | null }>(
        `SELECT merged_into_profile_id FROM learner_profiles WHERE id = ?`,
        [anonymousId],
      ),
    ).resolves.toEqual({ merged_into_profile_id: null });

    // Retrying after the failure completes the merge exactly once.
    await repository.mergeAnonymousProfile(anonymousId, target.id);
    await expect(readOutbox(target.id)).resolves.toHaveLength(1);
  });

  test("recovers the merge target when a crash left the active profile pointing at a merged one", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    const target = await repository.createAuthenticatedProfile("supabase-user-1");
    // Merge commits, then the process dies before the target is activated.
    await repository.mergeAnonymousProfile(anonymousId, target.id);

    const restarted = createRepository();

    await expect(restarted.getActiveProfileId()).resolves.toBe(target.id);
    await expect(restarted.isLessonCompleted("color-mixing")).resolves.toBe(true);
  });

  test("never reuses a profile that still holds unclaimed guest progress", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    const target = await repository.createAuthenticatedProfile("supabase-user-1");
    await repository.setActiveProfile(target.id);

    const reactivated = await repository.activateEmptyAnonymousProfile();

    expect(reactivated.id).not.toBe(anonymousId);
    expect(reactivated.kind).toBe("anonymous");
    await expect(repository.isLessonCompleted("color-mixing")).resolves.toBe(false);
    // The unmerged guest rows stay on disk; they are not reconstructible.
    expect(await readCompletionState(anonymousId)).toEqual({ "color-mixing": true });
  });

  test("an activation wins a race against a concurrent cold-cache profile read", async () => {
    // A screen reading progress right as a sign-in activates the account: exercises
    // `settleProfileResolution` (the activation waits out the read rather than racing its
    // transaction) and the `cachedProfile ?? profile` reconciliation the read's own resolution
    // falls back to (an activation that lands first must not be clobbered by a stale read).
    const target = await repository.createAuthenticatedProfile("supabase-user-1");
    const fresh = createRepository();

    const [read] = await Promise.all([fresh.getActiveProfile(), fresh.setActiveProfile(target.id)]);

    // The read may have observed either profile depending on exactly how the race landed, but the
    // activation must always be the one left standing afterward.
    expect(read.id === target.id || read.kind === "anonymous").toBe(true);
    await expect(fresh.getActiveProfileId()).resolves.toBe(target.id);
    await expect(fresh.getActiveProfile()).resolves.toEqual(target);
  });
});

/**
 * Wraps a driver so one chosen statement rejects, standing in for a crash mid-transaction. Reads,
 * `exec`, and `transaction` still go to the real connection so `BEGIN`/`ROLLBACK` behave normally.
 */
function wrapDriverFailingOn(
  driver: DatabaseDriver,
  shouldFail: (sql: string) => boolean,
): DatabaseDriver {
  return {
    exec: (sql) => driver.exec(sql),
    run: (sql: string, params?: readonly SqlValue[]) =>
      shouldFail(sql) ? Promise.reject(new Error("simulated crash")) : driver.run(sql, params),
    first: (sql: string, params?: readonly SqlValue[]) => driver.first(sql, params),
    all: (sql: string, params?: readonly SqlValue[]) => driver.all(sql, params),
    transaction: (work) => driver.transaction(work),
    close: () => driver.close(),
  };
}
