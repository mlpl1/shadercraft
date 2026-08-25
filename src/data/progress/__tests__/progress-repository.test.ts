import type { DatabaseDriver, SqlValue } from "../../database/driver";
import type { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import type { SqliteProgressRepository } from "../sqlite-progress-repository";
import { createProgressRepositoryTestContext } from "./progress-repository-test-context";

describe("SQLite progress repository", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteProgressRepository;

  beforeEach(async () => {
    ({ driver, repository } = await createProgressRepositoryTestContext());
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

  test("returns only published, completed lesson IDs, ordered by curriculum position", async () => {
    // The bundled release now authors five published lessons. Complete them out of curriculum
    // order, alongside an unpublished ID, to prove `getCompletedLessonIds` both filters to
    // published lessons and orders its result by curriculum position rather than completion order.
    await repository.setLessonCompleted("retired-legacy-lesson", true);
    await repository.setLessonCompleted("reading-shaders-from-elsewhere", true);
    await repository.setLessonCompleted("what-a-fragment-shader-is", true);
    await repository.setLessonCompleted("centre-and-aspect", true);

    await expect(repository.getCompletedLessonIds()).resolves.toEqual([
      "what-a-fragment-shader-is",
      "centre-and-aspect",
      "reading-shaders-from-elsewhere",
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

  test("still queues a mutation when the target profile's cached value already agrees", async () => {
    const anonymousId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    const target = await repository.createAuthenticatedProfile("supabase-user-1");
    // The account's *cached* value happens to agree. It is a snapshot of revision 4, though, and
    // another device may have moved the lesson since — in which case the next pull would apply that
    // newer revision and quietly undo the guest's explicit action, with nothing queued to answer it.
    await driver.run(
      `INSERT INTO lesson_progress
        (profile_id, lesson_id, completed, server_revision, locally_modified_at, server_updated_at)
       VALUES (?, 'color-mixing', 1, 4, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
      [target.id],
    );

    await repository.mergeAnonymousProfile(anonymousId, target.id);

    // The action enters the outbox and wins through the normal revision flow. Redundant if the server
    // does still agree — one idempotent round trip — and the only recoverable option if it does not.
    const mutations = await readOutbox(target.id);
    expect(mutations).toHaveLength(1);
    expect(mutations[0].entity_id).toBe("color-mixing");
    expect(mutations[0].base_revision).toBe(4);
    expect(JSON.parse(mutations[0].payload_json)).toEqual({
      lessonId: "color-mixing",
      completed: true,
    });
    // Nothing about the row itself changed, so it keeps its cached revision untouched.
    expect(await readCompletionState(target.id)).toEqual({ "color-mixing": true });
    await expect(
      driver.first<{ server_revision: number }>(
        `SELECT server_revision FROM lesson_progress WHERE profile_id = ? AND lesson_id = ?`,
        [target.id, "color-mixing"],
      ),
    ).resolves.toEqual({ server_revision: 4 });
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

describe("SQLite progress repository sync primitives", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteProgressRepository;

  beforeEach(async () => {
    ({ driver, repository } = await createProgressRepositoryTestContext());
  });

  afterEach(async () => {
    await driver.close();
  });

  async function readProgressRow(
    profileId: string,
    lessonId: string,
  ): Promise<{ completed: number; server_revision: number } | null> {
    return driver.first(
      `SELECT completed, server_revision FROM lesson_progress
       WHERE profile_id = ? AND lesson_id = ?`,
      [profileId, lessonId],
    );
  }

  test("uploads two same-instant mutations for one lesson in the order they were queued", async () => {
    // Production mints a random UUID per mutation and reads a wall clock that can tie or run
    // backwards, so `(created_at, mutation_id)` is not an ordering at all. Here the clock is frozen and
    // the IDs descend, which is exactly the case that reverses under that ordering: the *earlier* tap
    // would be accepted by the server last and become authoritative, pinning this device to a stale
    // value at a matching server revision it could never move off.
    let nextId = 9;
    const context = await createProgressRepositoryTestContext({
      generateId: () => `descending-${nextId--}`,
      now: () => "2026-08-03T00:00:00.000Z",
    });

    try {
      await context.repository.setLessonCompleted("color-mixing", true);
      await context.repository.setLessonCompleted("color-mixing", false);

      const profileId = await context.repository.getActiveProfileId();
      const mutations = await context.repository.getPendingMutations(profileId);

      expect(mutations.map((mutation) => mutation.completed)).toEqual([true, false]);
      // Guards the setup itself: if the IDs happened to ascend, the assertion above would hold no
      // matter what the query ordered by.
      expect(mutations[0].mutationId > mutations[1].mutationId).toBe(true);
      expect(mutations[0].createdAt).toBe(mutations[1].createdAt);
    } finally {
      await context.driver.close();
    }
  });

  test("starts a profile that has never pulled at cursor zero", async () => {
    const profileId = await repository.getActiveProfileId();

    await expect(repository.getPullCursor(profileId)).resolves.toBe(0);
  });

  test("refuses to read a corrupt pull cursor rather than pulling from the beginning", async () => {
    const profileId = await repository.getActiveProfileId();
    await driver.run(
      `INSERT INTO sync_state (profile_id, resource, pull_cursor, last_success_at)
       VALUES (?, 'lesson_progress', 'not-a-number', NULL)`,
      [profileId],
    );

    await expect(repository.getPullCursor(profileId)).rejects.toThrow(/corrupt/);
  });

  test("keeps one profile's pulled changes and cursor out of another's", async () => {
    const anonymousId = await repository.getActiveProfileId();
    const account = await repository.createAuthenticatedProfile("supabase-user-1");

    await repository.applyRemoteChanges(
      account.id,
      [{ lessonId: "color-mixing", completed: true, revision: 4, changeId: 9 }],
      9,
    );

    await expect(readProgressRow(account.id, "color-mixing")).resolves.toEqual({
      completed: 1,
      server_revision: 4,
    });
    await expect(readProgressRow(anonymousId, "color-mixing")).resolves.toBeNull();
    await expect(repository.getPullCursor(account.id)).resolves.toBe(9);
    await expect(repository.getPullCursor(anonymousId)).resolves.toBe(0);
  });

  test("never lowers a lesson's server revision when an older acknowledgement arrives", async () => {
    const profileId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);
    await repository.setLessonCompleted("color-mixing", false);
    const [older, newer] = await repository.getPendingMutations(profileId);

    await repository.acknowledgeMutation(profileId, newer.mutationId, {
      completed: false,
      revision: 5,
      changeId: 50,
    });
    await repository.acknowledgeMutation(profileId, older.mutationId, {
      completed: true,
      revision: 2,
      changeId: 20,
    });

    await expect(repository.getPendingMutations(profileId)).resolves.toEqual([]);
    // The acknowledged local state is the learner's, and revision 5 is the newest the server gave.
    await expect(readProgressRow(profileId, "color-mixing")).resolves.toEqual({
      completed: 0,
      server_revision: 5,
    });
  });

  test("no-ops acknowledging a mutation that was never queued instead of throwing", async () => {
    const profileId = await repository.getActiveProfileId();
    await repository.setLessonCompleted("color-mixing", true);

    await expect(
      repository.acknowledgeMutation(profileId, "never-queued", {
        completed: true,
        revision: 1,
        changeId: 1,
      }),
    ).resolves.toBeUndefined();

    await expect(repository.getPendingMutations(profileId)).resolves.toHaveLength(1);
    await expect(readProgressRow(profileId, "color-mixing")).resolves.toEqual({
      completed: 1,
      server_revision: 0,
    });
  });

  test("notifies subscribers only when a pulled change alters visible completion", async () => {
    const profileId = await repository.getActiveProfileId();
    const listener = jest.fn();
    repository.subscribe(listener);

    // A first server row saying "not completed" matches what the screen already shows.
    await repository.applyRemoteChanges(
      profileId,
      [{ lessonId: "color-mixing", completed: false, revision: 1, changeId: 1 }],
      1,
    );
    expect(listener).not.toHaveBeenCalled();

    await repository.applyRemoteChanges(
      profileId,
      [{ lessonId: "color-mixing", completed: true, revision: 2, changeId: 2 }],
      2,
    );
    expect(listener).toHaveBeenCalledTimes(1);
    await expect(repository.isLessonCompleted("color-mixing")).resolves.toBe(true);
  });

  test("reports no last successful sync for a profile that has never synced", async () => {
    const profileId = await repository.getActiveProfileId();

    await expect(repository.getLastSyncSuccessAt(profileId)).resolves.toBeNull();
  });

  test("reads back the moment a pass recorded as successful, and each profile reads its own", async () => {
    const anonymousId = await repository.getActiveProfileId();
    const account = await repository.createAuthenticatedProfile("supabase-user-1");

    await repository.recordSyncSuccess(account.id, 12);

    await expect(repository.getLastSyncSuccessAt(account.id)).resolves.toBe(
      "2026-08-03T00:00:00.000Z",
    );
    // The stamp belongs to the profile that synced, never to whoever asks.
    await expect(repository.getLastSyncSuccessAt(anonymousId)).resolves.toBeNull();
  });

  test("reads back the moment a pulled batch recorded as successful", async () => {
    const profileId = await repository.getActiveProfileId();

    await repository.applyRemoteChanges(
      profileId,
      [{ lessonId: "color-mixing", completed: true, revision: 1, changeId: 3 }],
      3,
    );

    await expect(repository.getLastSyncSuccessAt(profileId)).resolves.toBe(
      "2026-08-03T00:00:00.000Z",
    );
  });

  test("reports no last successful sync for a row that only holds a pull cursor", async () => {
    const profileId = await repository.getActiveProfileId();
    await driver.run(
      `INSERT INTO sync_state (profile_id, resource, pull_cursor, last_success_at)
       VALUES (?, 'lesson_progress', '4', NULL)`,
      [profileId],
    );

    await expect(repository.getLastSyncSuccessAt(profileId)).resolves.toBeNull();
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
