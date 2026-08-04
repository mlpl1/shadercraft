import type { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import { createProgressRepositoryTestContext } from "../../progress/__tests__/progress-repository-test-context";
import type { SqliteProgressRepository } from "../../progress/sqlite-progress-repository";
import { createProfileService, type ProfileService } from "../profile-service";

/** Two published lessons the guest completes, plus one it explicitly uncompletes. */
const LESSON_A = "coordinate-systems-uv-space";
const LESSON_B = "colors-fragment-output";
const LESSON_C = "uniforms-time";

type OutboxRow = {
  mutation_id: string;
  entity_id: string;
  payload_json: string;
  base_revision: number;
  merged_at: string | null;
};

describe("local profile service", () => {
  let driver: NodeSqliteDriver;
  let repository: SqliteProgressRepository;
  let createRepository: () => SqliteProgressRepository;
  let profiles: ProfileService;

  beforeEach(async () => {
    ({ driver, repository, createRepository } = await createProgressRepositoryTestContext());
    profiles = createProfileService(repository);
  });

  afterEach(async () => {
    await driver.close();
  });

  /** Explicit completion state on disk, keyed by lesson. An absent key means "never changed". */
  async function readCompletionState(profileId: string): Promise<Record<string, boolean>> {
    const rows = await driver.all<{ lesson_id: string; completed: number }>(
      `SELECT lesson_id, completed FROM lesson_progress WHERE profile_id = ? ORDER BY lesson_id`,
      [profileId],
    );
    return Object.fromEntries(rows.map((row) => [row.lesson_id, row.completed === 1]));
  }

  async function readOutbox(profileId: string): Promise<OutboxRow[]> {
    return driver.all<OutboxRow>(
      `SELECT mutation_id, entity_id, payload_json, base_revision, merged_at
       FROM sync_outbox WHERE profile_id = ?`,
      [profileId],
    );
  }

  async function completeGuestLessons(): Promise<void> {
    await repository.setLessonCompleted(LESSON_A, true);
    await repository.setLessonCompleted(LESSON_B, true);
    await repository.setLessonCompleted(LESSON_C, true);
    await repository.setLessonCompleted(LESSON_C, false);
  }

  test("carries guest progress into the first account and keeps later profiles isolated", async () => {
    // 1. The guest completes A and B, and explicitly uncompletes C.
    const guest = await profiles.activateAnonymous();
    await completeGuestLessons();

    // 2. User 1 signs in: A/B/C become authenticated progress and authenticated mutations.
    const userOne = await profiles.activateAuthenticated("supabase-user-1");
    expect(userOne.kind).toBe("authenticated");
    expect(userOne.supabaseUserId).toBe("supabase-user-1");
    await expect(repository.getActiveProfileId()).resolves.toBe(userOne.id);

    // The explicit incompletion survives as a `completed = false` row, not as an absence, and
    // lessons the guest never touched stay absent so the server can still decide them.
    expect(await readCompletionState(userOne.id)).toEqual({
      [LESSON_A]: true,
      [LESSON_B]: true,
      [LESSON_C]: false,
    });
    await expect(repository.getCompletedLessonIds()).resolves.toEqual([LESSON_A, LESSON_B]);

    // 3. The guest's own mutations are marked merged so they can never upload or be re-imported.
    const guestOutbox = await readOutbox(guest.id);
    expect(guestOutbox).toHaveLength(4);
    expect(guestOutbox.filter((row) => row.merged_at === null)).toEqual([]);

    // The authenticated mutations are fresh rows: new IDs, one per lesson, base revision 0.
    const authenticatedMutations = await repository.getPendingMutations();
    expect(new Map(authenticatedMutations.map((row) => [row.lessonId, row.completed]))).toEqual(
      new Map([
        [LESSON_A, true],
        [LESSON_B, true],
        [LESSON_C, false],
      ]),
    );
    const guestMutationIds = new Set(guestOutbox.map((row) => row.mutation_id));
    expect(authenticatedMutations.filter((row) => guestMutationIds.has(row.mutationId))).toEqual([]);
    expect(authenticatedMutations.map((row) => row.baseRevision)).toEqual([0, 0, 0]);

    // 4. Signing out lands on a different anonymous profile with none of User 1's progress.
    const signedOut = await profiles.signOut();
    expect(signedOut.kind).toBe("anonymous");
    expect(signedOut.id).not.toBe(guest.id);
    expect(signedOut.id).not.toBe(userOne.id);
    await expect(repository.getCompletedLessonIds()).resolves.toEqual([]);
    await expect(repository.getPendingMutations()).resolves.toEqual([]);

    // 5. A second account inherits neither User 1's progress nor the already merged guest's.
    const userTwo = await profiles.activateAuthenticated("supabase-user-2");
    expect(userTwo.id).not.toBe(userOne.id);
    expect(await readCompletionState(userTwo.id)).toEqual({});
    await expect(repository.getCompletedLessonIds()).resolves.toEqual([]);
    await expect(repository.getPendingMutations()).resolves.toEqual([]);

    // 6. User 1 signs back in and finds the cached A/B/C state, mutations still queued.
    const userOneAgain = await profiles.activateAuthenticated("supabase-user-1");
    expect(userOneAgain.id).toBe(userOne.id);
    expect(await readCompletionState(userOne.id)).toEqual({
      [LESSON_A]: true,
      [LESSON_B]: true,
      [LESSON_C]: false,
    });
    await expect(repository.getCompletedLessonIds()).resolves.toEqual([LESSON_A, LESSON_B]);
    await expect(repository.isLessonCompleted(LESSON_C)).resolves.toBe(false);
    await expect(repository.getPendingMutations()).resolves.toHaveLength(3);
  });

  test("keeps the same anonymous profile and its progress while no account is involved", async () => {
    const first = await profiles.activateAnonymous();
    await repository.setLessonCompleted(LESSON_A, true);

    const second = await profiles.activateAnonymous();

    expect(second.id).toBe(first.id);
    await expect(repository.getCompletedLessonIds()).resolves.toEqual([LESSON_A]);
  });

  test("does not carry one account's progress into another when switching directly", async () => {
    await profiles.activateAnonymous();
    await profiles.activateAuthenticated("supabase-user-1");
    await repository.setLessonCompleted(LESSON_A, true);

    const userTwo = await profiles.activateAuthenticated("supabase-user-2");

    expect(await readCompletionState(userTwo.id)).toEqual({});
    await expect(repository.getCompletedLessonIds()).resolves.toEqual([]);
  });

  test("signs out onto an empty profile without discarding the account's cached rows", async () => {
    const guest = await profiles.activateAnonymous();
    await completeGuestLessons();
    const userOne = await profiles.activateAuthenticated("supabase-user-1");

    await profiles.signOut();

    // Progress and outbox rows are not reconstructible, so neither profile may be emptied.
    expect(Object.keys(await readCompletionState(userOne.id))).toHaveLength(3);
    expect(await readOutbox(guest.id)).toHaveLength(4);
    expect(Object.keys(await readCompletionState(guest.id))).toHaveLength(3);
  });

  test("reuses a profile left empty by an earlier sign-out instead of accumulating profiles", async () => {
    await profiles.activateAnonymous();
    await profiles.activateAuthenticated("supabase-user-1");
    const firstSignOut = await profiles.signOut();

    await profiles.activateAuthenticated("supabase-user-1");
    const secondSignOut = await profiles.signOut();

    expect(secondSignOut.id).toBe(firstSignOut.id);
  });

  test("resumes the account that was active before a restart", async () => {
    await profiles.activateAnonymous();
    await completeGuestLessons();
    const userOne = await profiles.activateAuthenticated("supabase-user-1");

    const restarted = createRepository();

    await expect(restarted.getActiveProfileId()).resolves.toBe(userOne.id);
    await expect(restarted.getCompletedLessonIds()).resolves.toEqual([LESSON_A, LESSON_B]);
  });

  test("refuses to demote a signed-in device to a guest via activateAnonymous", async () => {
    await profiles.activateAnonymous();
    const userOne = await profiles.activateAuthenticated("supabase-user-1");

    await expect(profiles.activateAnonymous()).rejects.toThrow();

    // The device stays on its authenticated profile; signOut() is the only way off it.
    await expect(repository.getActiveProfileId()).resolves.toBe(userOne.id);
    await expect(repository.getActiveProfile()).resolves.toEqual(userOne);
  });

  test("resumes the anonymous profile that was active before a restart", async () => {
    const guest = await profiles.activateAnonymous();
    await repository.setLessonCompleted(LESSON_A, true);
    await profiles.activateAuthenticated("supabase-user-1");
    const signedOut = await profiles.signOut();
    expect(signedOut.id).not.toBe(guest.id);

    const restarted = createRepository();

    await expect(restarted.getActiveProfileId()).resolves.toBe(signedOut.id);
  });
});
