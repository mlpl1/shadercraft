import bundledCourse from "../../../../assets/course/bundled-course.json";

import { SqliteCourseRepository } from "../../course/sqlite-course-repository";
import type { DatabaseDriver, SqlValue } from "../../database/driver";
import { migrateDatabase } from "../../database/migrations";
import { installBundledRelease } from "../../database/seed";
import { NodeSqliteDriver } from "../../database/testing/node-sqlite-driver";
import type { ProgressMutation } from "../../progress/progress-repository";
import { SqliteProgressRepository } from "../../progress/sqlite-progress-repository";
import {
  ProgressRemoteError,
  type ProgressRemote,
  type RemoteMutationResult,
  type RemoteProgressChange,
} from "../progress-remote";
import { MAX_MUTATION_ATTEMPTS, ProgressSyncEngine } from "../progress-sync-engine";

const LESSON_A = "coordinate-systems-uv-space";
const LESSON_B = "colors-fragment-output";
const LESSON_C = "color-mixing";
const LESSON_D = "uniforms-time";

/** The account every device below belongs to unless a test says otherwise. */
const USER_ONE = "supabase-user-one";
/** A second account, so "this account's work must never land in another's" is representable at all. */
const USER_TWO = "supabase-user-two";

type ServerRow = { completed: boolean; revision: number; changeId: number };

/**
 * An in-memory stand-in for `apply_progress_mutation` and the `lesson_progress` table it writes.
 *
 * Deliberately models the *contract* verified by `supabase/tests/database/progress_sync.test.sql`
 * rather than the engine's expectations: rows and mutation records are per user, revisions are per
 * row, a stale base revision is answered with the server's current state, a replayed mutation id is
 * answered with its recorded outcome, and a mutation id recorded under a *different* user is refused
 * outright. `change_id` comes from one sequence shared by every user — which is precisely why one
 * account's cursor values are poison to another's profile. Only the current row per lesson is
 * readable, exactly like the real pull query.
 */
class FakeProgressServer {
  private readonly rows = new Map<string, Map<string, ServerRow>>();
  private readonly accepted = new Map<string, { userId: string; row: ServerRow }>();
  private nextChangeId = 1;

  /** Writes a row as if another device had done it, taking the next revision and change id. */
  write(lessonId: string, completed: boolean, userId: string = USER_ONE): ServerRow {
    const userRows = this.rowsOf(userId);
    const row = {
      completed,
      revision: (userRows.get(lessonId)?.revision ?? 0) + 1,
      changeId: this.nextChangeId,
    };
    this.nextChangeId += 1;
    userRows.set(lessonId, row);
    return row;
  }

  stateOf(lessonId: string, userId: string = USER_ONE): ServerRow | undefined {
    return this.rowsOf(userId).get(lessonId);
  }

  /** Every lesson one account holds a row for, so a test can assert an account was left untouched. */
  lessonsOf(userId: string): string[] {
    return [...this.rowsOf(userId).keys()].sort();
  }

  apply(userId: string, mutation: ProgressMutation): RemoteMutationResult {
    const recorded = this.accepted.get(mutation.mutationId);
    if (recorded) {
      if (recorded.userId !== userId) {
        // The real function raises 42501 here; the adapter classifies that as permanent.
        throw new ProgressRemoteError("rejected", "mutation_id belongs to another user");
      }
      return { kind: "applied", ...recorded.row };
    }

    const current = this.rowsOf(userId).get(mutation.lessonId);
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== mutation.baseRevision) {
      return {
        kind: "conflict",
        completed: current?.completed ?? false,
        revision: currentRevision,
        changeId: current?.changeId ?? 0,
      };
    }

    const row = this.write(mutation.lessonId, mutation.completed, userId);
    this.accepted.set(mutation.mutationId, { userId, row });
    return { kind: "applied", ...row };
  }

  changesAfter(userId: string, changeId: number, limit: number): RemoteProgressChange[] {
    return [...this.rowsOf(userId).entries()]
      .map(([lessonId, row]) => ({ lessonId, ...row }))
      .filter((change) => change.changeId > changeId)
      .sort((left, right) => left.changeId - right.changeId)
      .slice(0, limit);
  }

  private rowsOf(userId: string): Map<string, ServerRow> {
    let userRows = this.rows.get(userId);
    if (!userRows) {
      userRows = new Map();
      this.rows.set(userId, userRows);
    }
    return userRows;
  }
}

type RemoteCall =
  | { kind: "apply"; mutationId: string; lessonId: string; completed: boolean; baseRevision: number }
  | { kind: "pull"; changeId: number; limit: number };

/**
 * Wraps {@link FakeProgressServer} with a call log and scripted failures/interleavings.
 *
 * Stands in for `SupabaseProgressRemote` over the app's *singleton* Supabase client, so it models the
 * two properties that make an account switch dangerous: a request authenticates as whichever session
 * is current at request time ({@link sessionUserId}, which a test can change mid-pass), and every
 * request first checks that session against the account the caller says the request belongs to,
 * failing `auth` on a mismatch. What reaches the server is deliberately keyed off `sessionUserId`, not
 * off the account the caller passed, so deleting the check reproduces the real bug rather than hiding
 * it.
 */
class FakeProgressRemote implements ProgressRemote {
  readonly calls: RemoteCall[] = [];
  /** Attempt counters, kept apart from `calls` so clearing the log cannot reschedule a failure. */
  private applyAttempts = 0;
  private pullAttempts = 0;
  private readonly applyFailures: (ProgressRemoteError | undefined)[] = [];
  private readonly pullFailures: (ProgressRemoteError | undefined)[] = [];

  /**
   * Runs just before each `applyMutation` request goes out, to simulate something happening between
   * this device's requests — another device writing the same lesson, or the learner signing into a
   * different account.
   */
  beforeApply: ((mutation: ProgressMutation) => void) | null = null;
  /** Runs just before each `pullAfter` request goes out, for the same reasons. */
  beforePull: (() => Promise<void>) | null = null;
  /** Returned instead of the server's own answer, to simulate a misbehaving server. */
  pullOverride: RemoteProgressChange[] | null = null;

  constructor(
    readonly server: FakeProgressServer,
    /** The account the client's current JWT belongs to. Reassign to simulate an account switch. */
    public sessionUserId: string = USER_ONE,
  ) {}

  failApplyOnAttempt(attempt: number, error: ProgressRemoteError): void {
    this.applyFailures[attempt - 1] = error;
  }

  failPullOnAttempt(attempt: number, error: ProgressRemoteError): void {
    this.pullFailures[attempt - 1] = error;
  }

  get applyCalls(): Extract<RemoteCall, { kind: "apply" }>[] {
    return this.calls.filter(
      (call): call is Extract<RemoteCall, { kind: "apply" }> => call.kind === "apply",
    );
  }

  get pullCalls(): Extract<RemoteCall, { kind: "pull" }>[] {
    return this.calls.filter(
      (call): call is Extract<RemoteCall, { kind: "pull" }> => call.kind === "pull",
    );
  }

  async applyMutation(
    mutation: ProgressMutation,
    supabaseUserId: string,
  ): Promise<RemoteMutationResult> {
    this.calls.push({
      kind: "apply",
      mutationId: mutation.mutationId,
      lessonId: mutation.lessonId,
      completed: mutation.completed,
      baseRevision: mutation.baseRevision,
    });

    this.applyAttempts += 1;
    const failure = this.applyFailures[this.applyAttempts - 1];
    if (failure) {
      throw failure;
    }

    this.beforeApply?.(mutation);
    this.assertSessionUser(supabaseUserId);
    return this.server.apply(this.sessionUserId, mutation);
  }

  async pullAfter(
    changeId: number,
    limit: number,
    supabaseUserId: string,
  ): Promise<RemoteProgressChange[]> {
    this.calls.push({ kind: "pull", changeId, limit });

    this.pullAttempts += 1;
    const failure = this.pullFailures[this.pullAttempts - 1];
    if (failure) {
      throw failure;
    }

    if (this.beforePull) {
      await this.beforePull();
    }
    this.assertSessionUser(supabaseUserId);
    return this.pullOverride ?? this.server.changesAfter(this.sessionUserId, changeId, limit);
  }

  /** See {@link FakeProgressRemote} and `SupabaseProgressRemote.assertSessionUser`. */
  private assertSessionUser(supabaseUserId: string): void {
    if (this.sessionUserId !== supabaseUserId) {
      throw new ProgressRemoteError(
        "auth",
        "The active Supabase session belongs to a different account than the learner profile this request belongs to.",
      );
    }
  }
}

type ProgressRow = {
  lesson_id: string;
  completed: number;
  server_revision: number;
  server_updated_at: string | null;
};

type OutboxRow = {
  mutation_id: string;
  entity_id: string;
  base_revision: number;
  attempts: number;
  last_error: string | null;
};

type Device = {
  driver: NodeSqliteDriver;
  repository: SqliteProgressRepository;
  engine: ProgressSyncEngine;
  remote: FakeProgressRemote;
  profileId: string;
  /** The Supabase account this device's profile belongs to, handed to every `sync()` call. */
  userId: string;
  /** How many write statements have gone through the repository's driver so far. */
  writeCount(): number;
  /** Builds another repository over the same database, optionally through a fault-injecting driver. */
  createRepository(override?: DatabaseDriver): SqliteProgressRepository;
  readProgress(): Promise<ProgressRow[]>;
  readOutbox(): Promise<OutboxRow[]>;
  readCursor(): Promise<string | null>;
};

/** Counts write statements so a "converges without extra writes" assertion cannot be vacuous. */
function createCountingDriver(inner: DatabaseDriver): {
  driver: DatabaseDriver;
  writeCount(): number;
} {
  let writes = 0;
  const driver: DatabaseDriver = {
    async exec(sql: string) {
      await inner.exec(sql);
    },
    async run(sql: string, params?: readonly SqlValue[]) {
      writes += 1;
      return inner.run(sql, params);
    },
    first<T>(sql: string, params?: readonly SqlValue[]) {
      return inner.first<T>(sql, params);
    },
    all<T>(sql: string, params?: readonly SqlValue[]) {
      return inner.all<T>(sql, params);
    },
    transaction<T>(work: () => Promise<T>) {
      return inner.transaction(work);
    },
    async close() {
      await inner.close();
    },
  };
  return { driver, writeCount: () => writes };
}

/** A driver that fails any statement containing `failOn`, to test transaction rollback. */
function createFailingDriver(inner: DatabaseDriver, failOn: string): DatabaseDriver {
  return {
    ...createCountingDriver(inner).driver,
    async run(sql: string, params?: readonly SqlValue[]) {
      if (sql.includes(failOn)) {
        throw new Error(`injected failure for: ${failOn}`);
      }
      return inner.run(sql, params);
    },
  };
}

/**
 * One simulated installation: its own SQLite database and sync engine, talking to a shared
 * {@link FakeProgressServer}. Timestamps increase per call so outbox creation order is unambiguous.
 */
async function createDevice(
  server: FakeProgressServer,
  idPrefix = "a",
  userId: string = USER_ONE,
): Promise<Device> {
  const sqlite = new NodeSqliteDriver(":memory:");
  await migrateDatabase(sqlite);
  await installBundledRelease(sqlite, bundledCourse);
  const courseRepository = new SqliteCourseRepository(sqlite);

  const counting = createCountingDriver(sqlite);
  let nextId = 0;
  let clock = 0;
  const createRepository = (override: DatabaseDriver = counting.driver) =>
    new SqliteProgressRepository(override, courseRepository, {
      generateId: () => `${idPrefix}-${++nextId}`,
      now: () => new Date(Date.UTC(2026, 7, 4, 0, 0, clock++)).toISOString(),
    });

  const repository = createRepository();
  const remote = new FakeProgressRemote(server, userId);
  const engine = new ProgressSyncEngine(remote, repository);
  const profileId = await repository.getActiveProfileId();

  return {
    driver: sqlite,
    repository,
    engine,
    remote,
    profileId,
    userId,
    writeCount: counting.writeCount,
    createRepository,
    readProgress: () =>
      sqlite.all<ProgressRow>(
        `SELECT lesson_id, completed, server_revision, server_updated_at FROM lesson_progress
         WHERE profile_id = ? ORDER BY lesson_id`,
        [profileId],
      ),
    readOutbox: () =>
      sqlite.all<OutboxRow>(
        `SELECT mutation_id, entity_id, base_revision, attempts, last_error FROM sync_outbox
         WHERE profile_id = ? ORDER BY rowid`,
        [profileId],
      ),
    readCursor: async () =>
      (
        await sqlite.first<{ pull_cursor: string | null }>(
          `SELECT pull_cursor FROM sync_state WHERE profile_id = ? AND resource = 'lesson_progress'`,
          [profileId],
        )
      )?.pull_cursor ?? null,
  };
}

describe("ProgressSyncEngine push", () => {
  let server: FakeProgressServer;
  let device: Device;

  beforeEach(async () => {
    server = new FakeProgressServer();
    device = await createDevice(server);
  });

  afterEach(async () => {
    await device.driver.close();
  });

  test("uploads every queued mutation in creation order before the first pull", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    await device.repository.setLessonCompleted(LESSON_B, true);
    server.write(LESSON_C, true);

    await device.engine.sync(device.profileId, device.userId);

    expect(
      device.remote.calls.map((call) => (call.kind === "apply" ? call.lessonId : "PULL")),
    ).toEqual([LESSON_A, LESSON_B, "PULL"]);
  });

  test("removes an outbox row only once the server has applied it, stamping the revision", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);

    await device.engine.sync(device.profileId, device.userId);

    await expect(device.readOutbox()).resolves.toEqual([]);
    await expect(device.readProgress()).resolves.toEqual([
      {
        lesson_id: LESSON_A,
        completed: 1,
        server_revision: 1,
        server_updated_at: expect.any(String),
      },
    ]);
  });

  test("keeps the mutation and skips the pull when the upload hits a transport failure", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    device.remote.failApplyOnAttempt(1, new ProgressRemoteError("transport", "network unreachable"));

    await expect(device.engine.sync(device.profileId, device.userId)).rejects.toMatchObject({ kind: "transport" });

    await expect(device.readOutbox()).resolves.toEqual([
      {
        mutation_id: expect.any(String),
        entity_id: LESSON_A,
        base_revision: 0,
        attempts: 1,
        last_error: "network unreachable",
      },
    ]);
    // The learner's own completion must survive a failed upload untouched.
    await expect(device.repository.isLessonCompleted(LESSON_A)).resolves.toBe(true);
    expect(device.remote.pullCalls).toHaveLength(0);
  });

  test("pauses without touching the outbox when the session has expired", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    device.remote.failApplyOnAttempt(1, new ProgressRemoteError("auth", "JWT expired"));

    await expect(device.engine.sync(device.profileId, device.userId)).rejects.toMatchObject({ kind: "auth" });

    // An expired session is not the mutation's fault: nothing about the row may change, and above
    // all it must not be deleted.
    await expect(device.readOutbox()).resolves.toEqual([
      {
        mutation_id: expect.any(String),
        entity_id: LESSON_A,
        base_revision: 0,
        attempts: 0,
        last_error: null,
      },
    ]);
    expect(device.remote.pullCalls).toHaveLength(0);
  });

  test("keeps the unsent rest of the queue when the session expires mid-push", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    await device.repository.setLessonCompleted(LESSON_B, true);
    device.remote.failApplyOnAttempt(2, new ProgressRemoteError("auth", "JWT expired"));

    await expect(device.engine.sync(device.profileId, device.userId)).rejects.toMatchObject({ kind: "auth" });

    // The mutation the server did accept is settled; the one it never saw is untouched, not lost.
    await expect(device.readOutbox()).resolves.toEqual([
      {
        mutation_id: expect.any(String),
        entity_id: LESSON_B,
        base_revision: 0,
        attempts: 0,
        last_error: null,
      },
    ]);
    expect((await device.readProgress()).find((row) => row.lesson_id === LESSON_A)).toMatchObject({
      server_revision: 1,
    });
    expect(device.remote.pullCalls).toHaveLength(0);
  });

  test("rebases a conflict on an older queued action and still lets the newest one win", async () => {
    // Another device already moved this lesson twice.
    server.write(LESSON_A, false);
    server.write(LESSON_A, true);
    await device.repository.setLessonCompleted(LESSON_A, true);
    await device.repository.setLessonCompleted(LESSON_A, false);

    await device.engine.sync(device.profileId, device.userId);

    expect(device.remote.applyCalls.map((call) => [call.completed, call.baseRevision])).toEqual([
      [true, 0],
      [true, 2],
      [false, 3],
    ]);
    // The learner's most recent action is the last one the server accepted.
    expect(server.stateOf(LESSON_A)).toMatchObject({ completed: false, revision: 4 });
    await expect(device.readOutbox()).resolves.toEqual([]);
  });

  test("replays a lesson's queued actions in order so the newest one is accepted last", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    await device.repository.setLessonCompleted(LESSON_A, false);

    await device.engine.sync(device.profileId, device.userId);

    // The second action is rebased onto the revision the first one produced, so both are accepted
    // without a round trip through a conflict.
    expect(device.remote.applyCalls.map((call) => [call.completed, call.baseRevision])).toEqual([
      [true, 0],
      [false, 1],
    ]);
    expect(server.stateOf(LESSON_A)).toEqual({ completed: false, revision: 2, changeId: 2 });
    await expect(device.readOutbox()).resolves.toEqual([]);
  });

  test("rebases a conflict onto the returned revision and resends the same mutation id", async () => {
    server.write(LESSON_A, false);
    server.write(LESSON_A, true);
    await device.repository.setLessonCompleted(LESSON_A, false);

    const result = await device.engine.sync(device.profileId, device.userId);

    const [first, second] = device.remote.applyCalls;
    expect(device.remote.applyCalls).toHaveLength(2);
    expect(second.mutationId).toBe(first.mutationId);
    expect([first.baseRevision, second.baseRevision]).toEqual([0, 2]);
    expect(server.stateOf(LESSON_A)).toMatchObject({ completed: false, revision: 3 });
    expect(result.pushed).toBe(1);
    await expect(device.readOutbox()).resolves.toEqual([]);
  });

  test("stops after three consecutive conflicts in one run and keeps the mutation", async () => {
    server.write(LESSON_A, false);
    await device.repository.setLessonCompleted(LESSON_A, true);
    // Another device writes the same lesson just before each of our attempts, so every base we send
    // is already stale.
    device.remote.beforeApply = () => {
      server.write(LESSON_A, false);
    };

    const result = await device.engine.sync(device.profileId, device.userId);

    expect(device.remote.applyCalls).toHaveLength(3);
    expect(result).toMatchObject({ pushed: 0, pulled: 0, pending: 1 });
    const [row] = await device.readOutbox();
    expect(row.entity_id).toBe(LESSON_A);
    // The last revision the server reported is persisted, so the next run starts from it.
    expect(row.base_revision).toBe(server.stateOf(LESSON_A)?.revision);
    expect(row.attempts).toBe(1);
    expect(row.last_error).not.toBeNull();
    // Abandoning this mutation does not cancel the pull: nothing else queued needed the lesson's
    // authoritative state to still be local, so the pass pulls anyway.
    expect(device.remote.pullCalls).toHaveLength(1);
  });

  test("keeps pushing later mutations and still pulls when one lesson is permanently contended", async () => {
    server.write(LESSON_A, false);
    await device.repository.setLessonCompleted(LESSON_A, true);
    await device.repository.setLessonCompleted(LESSON_B, true);
    await device.repository.setLessonCompleted(LESSON_C, true);
    // Another device writes LESSON_A just before each of this device's attempts, exactly like the
    // "stops after three consecutive conflicts" test above — but this time two more mutations for
    // different lessons are queued behind it, and an independent remote change is waiting to be
    // pulled.
    device.remote.beforeApply = (mutation) => {
      if (mutation.lessonId === LESSON_A) {
        server.write(LESSON_A, false);
      }
    };
    server.write(LESSON_D, true);

    const result = await device.engine.sync(device.profileId, device.userId);

    // LESSON_A is retried three times and never accepted; B and C are neither delayed nor blocked by
    // it.
    expect(device.remote.applyCalls.map((call) => call.lessonId)).toEqual([
      LESSON_A,
      LESSON_A,
      LESSON_A,
      LESSON_B,
      LESSON_C,
    ]);
    expect(result.pushed).toBe(2);
    expect(result.pending).toBe(1);
    const [row] = await device.readOutbox();
    expect(row.entity_id).toBe(LESSON_A);
    // The pull still ran (once) and applied the unrelated remote change, despite the contended
    // lesson.
    expect(device.remote.pullCalls).toHaveLength(1);
    await expect(device.repository.isLessonCompleted(LESSON_D)).resolves.toBe(true);
    // The batch also carries back this device's own just-accepted B and C changes (changeIds 6 and
    // 7, after the three contended writes to A and D's own write): the cursor is the batch maximum,
    // not merely D's own changeId (2).
    expect(result.lastCursor).toBe(7);
    await expect(device.readCursor()).resolves.toBe("7");
  });

  test("does not resend an acknowledged mutation on the next run", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    await device.engine.sync(device.profileId, device.userId);
    const callsAfterFirstRun = device.remote.applyCalls.length;

    await device.engine.sync(device.profileId, device.userId);

    expect(callsAfterFirstRun).toBe(1);
    expect(device.remote.applyCalls).toHaveLength(1);
  });

  test("keeps pushing later mutations and still pulls when one is permanently rejected", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    await device.repository.setLessonCompleted(LESSON_B, true);
    // An independent change from another device is waiting, so "did the pull run" is answerable from
    // local state and not only from the call log.
    server.write(LESSON_D, true);
    device.remote.failApplyOnAttempt(
      1,
      new ProgressRemoteError("rejected", "permission denied for table lesson_progress"),
    );

    const result = await device.engine.sync(device.profileId, device.userId);

    // The refusal belongs to LESSON_A alone: LESSON_B is still sent, and the pull still happens.
    expect(device.remote.applyCalls.map((call) => call.lessonId)).toEqual([LESSON_A, LESSON_B]);
    expect(result).toMatchObject({ pushed: 1, pending: 1, blocked: 0 });
    await expect(device.readOutbox()).resolves.toEqual([
      {
        mutation_id: expect.any(String),
        entity_id: LESSON_A,
        base_revision: 0,
        attempts: 1,
        last_error: "permission denied for table lesson_progress",
      },
    ]);
    expect(device.remote.pullCalls).toHaveLength(1);
    // Without the pull, this device would never hear about another device's work again.
    await expect(device.repository.isLessonCompleted(LESSON_D)).resolves.toBe(true);
  });

  test("surfaces a mutation the server keeps refusing as blocked once its attempts pass the bound", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    for (let attempt = 1; attempt <= MAX_MUTATION_ATTEMPTS; attempt += 1) {
      device.remote.failApplyOnAttempt(
        attempt,
        new ProgressRemoteError("rejected", "permission denied for table lesson_progress"),
      );
    }

    const blockedPerPass: number[] = [];
    for (let pass = 0; pass < MAX_MUTATION_ATTEMPTS; pass += 1) {
      blockedPerPass.push((await device.engine.sync(device.profileId, device.userId)).blocked);
    }

    // Silent patience until the durable attempt count reaches the bound, then a signal the UI can turn
    // into a non-blocking "needs attention".
    expect(blockedPerPass).toEqual(
      Array.from({ length: MAX_MUTATION_ATTEMPTS }, (_unused, index) =>
        index === MAX_MUTATION_ATTEMPTS - 1 ? 1 : 0,
      ),
    );
    // Every pass still completed, pull included, and the learner's action is still queued — not
    // dropped, and not stopping anything else.
    expect(device.remote.pullCalls).toHaveLength(MAX_MUTATION_ATTEMPTS);
    await expect(device.readOutbox()).resolves.toMatchObject([
      { entity_id: LESSON_A, attempts: MAX_MUTATION_ATTEMPTS },
    ]);
    await expect(device.repository.isLessonCompleted(LESSON_A)).resolves.toBe(true);
  });
});

describe("ProgressSyncEngine account identity", () => {
  let server: FakeProgressServer;
  let device: Device;

  beforeEach(async () => {
    server = new FakeProgressServer();
    device = await createDevice(server);
  });

  afterEach(async () => {
    await device.driver.close();
  });

  test("stops pushing rather than writing one account's mutations into another account's rows", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    await device.repository.setLessonCompleted(LESSON_B, true);
    // The learner signs into a different account between this pass's two upload requests. The Supabase
    // client is a singleton, so from here on every request would carry the *new* account's JWT while
    // the pass keeps reading the old account's profile.
    device.remote.beforeApply = (mutation) => {
      if (mutation.lessonId === LESSON_B) {
        device.remote.sessionUserId = USER_TWO;
      }
    };

    await expect(device.engine.sync(device.profileId, device.userId)).rejects.toMatchObject({
      kind: "auth",
    });

    // The first mutation was accepted while the session still matched, so it is settled. The second
    // was refused before it left the device: the new account holds nothing that is not its own.
    expect(server.lessonsOf(USER_ONE)).toEqual([LESSON_A]);
    expect(server.lessonsOf(USER_TWO)).toEqual([]);
    // Reported as `auth`, so the outbox row is kept untouched — attempts still 0 — and the next pass
    // under the right session sends it.
    await expect(device.readOutbox()).resolves.toEqual([
      {
        mutation_id: expect.any(String),
        entity_id: LESSON_B,
        base_revision: 0,
        attempts: 0,
        last_error: null,
      },
    ]);
    expect(device.remote.pullCalls).toHaveLength(0);
  });

  test("stops pulling rather than writing another account's rows and cursor into this profile", async () => {
    // The other account has changes of its own, and they hold change ids from the sequence *both*
    // accounts share — which is what makes adopting them as this profile's cursor unrecoverable.
    server.write(LESSON_C, true, USER_TWO);
    server.write(LESSON_D, true, USER_TWO);
    await device.repository.setLessonCompleted(LESSON_A, true);
    // This time the switch lands after the push, as the pull request goes out.
    device.remote.beforePull = async () => {
      device.remote.sessionUserId = USER_TWO;
    };

    await expect(device.engine.sync(device.profileId, device.userId)).rejects.toMatchObject({
      kind: "auth",
    });

    expect(server.lessonsOf(USER_ONE)).toEqual([LESSON_A]);
    // The push went through under the right account; the pull applied nothing and moved no cursor.
    await expect(device.readProgress()).resolves.toEqual([
      {
        lesson_id: LESSON_A,
        completed: 1,
        server_revision: 1,
        server_updated_at: expect.any(String),
      },
    ]);
    await expect(device.readCursor()).resolves.toBeNull();
  });
});

describe("ProgressSyncEngine pull", () => {
  let server: FakeProgressServer;
  let device: Device;

  beforeEach(async () => {
    server = new FakeProgressServer();
    device = await createDevice(server);
  });

  afterEach(async () => {
    await device.driver.close();
  });

  test("applies pulled changes and advances the durable cursor", async () => {
    server.write(LESSON_A, true);
    const last = server.write(LESSON_B, false);

    const result = await device.engine.sync(device.profileId, device.userId);

    await expect(device.readProgress()).resolves.toEqual([
      { lesson_id: LESSON_B, completed: 0, server_revision: 1, server_updated_at: expect.any(String) },
      { lesson_id: LESSON_A, completed: 1, server_revision: 1, server_updated_at: expect.any(String) },
    ]);
    await expect(device.readCursor()).resolves.toBe(String(last.changeId));
    expect(result).toMatchObject({ pulled: 2, lastCursor: last.changeId });
  });

  test("rolls the whole batch back when the cursor write fails", async () => {
    server.write(LESSON_A, true);
    const failingRepository = device.createRepository(
      createFailingDriver(device.driver, "INSERT INTO sync_state"),
    );
    const engine = new ProgressSyncEngine(device.remote, failingRepository);

    await expect(engine.sync(device.profileId, device.userId)).rejects.toThrow(/injected failure/);

    // Progress rows and the cursor commit together or not at all.
    await expect(device.readProgress()).resolves.toEqual([]);
    await expect(device.readCursor()).resolves.toBeNull();
  });

  test("resumes from the last committed cursor after a mid-pagination failure", async () => {
    server.write(LESSON_A, true);
    server.write(LESSON_B, true);
    const third = server.write(LESSON_C, true);
    const engine = new ProgressSyncEngine(device.remote, device.repository, { pullBatchSize: 2 });
    device.remote.failPullOnAttempt(2, new ProgressRemoteError("transport", "connection reset"));

    await expect(engine.sync(device.profileId, device.userId)).rejects.toMatchObject({ kind: "transport" });
    await expect(device.readCursor()).resolves.toBe("2");

    device.remote.calls.length = 0;
    const result = await engine.sync(device.profileId, device.userId);

    expect(device.remote.pullCalls[0]).toEqual({ kind: "pull", changeId: 2, limit: 2 });
    expect(result.lastCursor).toBe(third.changeId);
    await expect(device.repository.isLessonCompleted(LESSON_C)).resolves.toBe(true);
  });

  test("leaves a lesson alone while it still has a pending local mutation", async () => {
    server.write(LESSON_A, true);
    // The learner taps the lesson while the pull request is in flight, after the push already ran.
    device.remote.beforePull = async () => {
      device.remote.beforePull = null;
      await device.repository.setLessonCompleted(LESSON_A, false);
    };

    const result = await device.engine.sync(device.profileId, device.userId);

    await expect(device.repository.isLessonCompleted(LESSON_A)).resolves.toBe(false);
    const [row] = await device.readProgress();
    expect(row.server_revision).toBe(0);
    expect(result.pending).toBe(1);
    // The change was received but skipped, not applied — it must not be reported as pulled.
    expect(result.pulled).toBe(0);
    // The change was still consumed, so the cursor moves on.
    await expect(device.readCursor()).resolves.toBe("1");
  });

  test("resolves a lesson skipped mid-pull once the following pass pushes its pending mutation", async () => {
    // Pins the coupling `applyRemoteChanges` relies on: skipping a lesson with a pending mutation
    // (`leaves a lesson alone...` above) is only safe because that mutation is later pushed and
    // becomes authoritative. If a future change dropped the outbox row without pushing it, this
    // would strand the server's change forever with nothing to reconcile it.
    server.write(LESSON_A, true);
    device.remote.beforePull = async () => {
      device.remote.beforePull = null;
      await device.repository.setLessonCompleted(LESSON_A, false);
    };

    const firstResult = await device.engine.sync(device.profileId, device.userId);
    expect(firstResult.pending).toBe(1);
    await expect(device.repository.isLessonCompleted(LESSON_A)).resolves.toBe(false);

    const secondResult = await device.engine.sync(device.profileId, device.userId);

    expect(secondResult.pending).toBe(0);
    await expect(device.readOutbox()).resolves.toEqual([]);
    // The device's own later action is what the server now holds too — the skipped change never
    // stuck around unreconciled.
    expect(server.stateOf(LESSON_A)).toMatchObject({ completed: false });
    await expect(device.repository.isLessonCompleted(LESSON_A)).resolves.toBe(false);
    const [row] = await device.readProgress();
    expect(row.server_revision).toBe(server.stateOf(LESSON_A)?.revision);
  });

  test("rewrites no progress row when the pull returns the change this device just pushed", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    let writesBeforePull = -1;
    device.remote.beforePull = async () => {
      writesBeforePull = device.writeCount();
    };

    await device.engine.sync(device.profileId, device.userId);

    // The pull sees its own accepted change come back. Applying it would produce identical column
    // values, so only the write count can tell the difference: the cursor upsert is the single
    // statement this batch is allowed to run.
    expect(device.writeCount() - writesBeforePull).toBe(1);
    await expect(device.readCursor()).resolves.toBe("1");
    await expect(device.readProgress()).resolves.toEqual([
      { lesson_id: LESSON_A, completed: 1, server_revision: 1, server_updated_at: expect.any(String) },
    ]);
  });

  test("refuses a batch that would not advance the cursor instead of pulling it forever", async () => {
    server.write(LESSON_A, true);
    await device.engine.sync(device.profileId, device.userId);
    // A batch whose last change is at or before the cursor is a request to pull the same rows again.
    // Asserted on a short batch so a regression fails fast; at a full batch the same answer would
    // loop, and because these awaits only ever queue microtasks it would starve the event loop
    // outright rather than time out.
    device.remote.pullOverride = [{ lessonId: LESSON_A, completed: true, revision: 1, changeId: 1 }];

    await expect(device.engine.sync(device.profileId, device.userId)).rejects.toMatchObject({ kind: "rejected" });
    await expect(device.readCursor()).resolves.toBe("1");
  });

  test("reports zero counts and no cursor movement for an idle profile", async () => {
    await expect(device.engine.sync(device.profileId, device.userId)).resolves.toEqual({
      pushed: 0,
      pulled: 0,
      pending: 0,
      blocked: 0,
      lastCursor: 0,
    });
    await expect(device.readCursor()).resolves.toBeNull();
  });
});

describe("ProgressSyncEngine convergence", () => {
  let server: FakeProgressServer;
  let device: Device;

  beforeEach(async () => {
    server = new FakeProgressServer();
    device = await createDevice(server);
  });

  afterEach(async () => {
    await device.driver.close();
  });

  test("two devices converge on the last server-accepted action", async () => {
    const second = await createDevice(server, "b");
    try {
      await device.repository.setLessonCompleted(LESSON_A, true);
      await device.engine.sync(device.profileId, device.userId);

      // The second device acted from a stale base (it had never seen the server row).
      await second.repository.setLessonCompleted(LESSON_A, true);
      await second.repository.setLessonCompleted(LESSON_A, false);
      await second.engine.sync(second.profileId, second.userId);

      await device.engine.sync(device.profileId, device.userId);

      expect(server.stateOf(LESSON_A)).toMatchObject({ completed: false });
      await expect(device.repository.isLessonCompleted(LESSON_A)).resolves.toBe(false);
      await expect(second.repository.isLessonCompleted(LESSON_A)).resolves.toBe(false);
      expect((await device.readProgress())[0].server_revision).toBe(
        (await second.readProgress())[0].server_revision,
      );
    } finally {
      await second.driver.close();
    }
  });

  test("a repeated sync of a settled profile writes nothing", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);
    server.write(LESSON_B, true);
    await device.engine.sync(device.profileId, device.userId);
    const writesAfterFirstRun = device.writeCount();

    const result = await device.engine.sync(device.profileId, device.userId);

    expect(device.writeCount()).toBe(writesAfterFirstRun);
    expect(result).toMatchObject({ pushed: 0, pulled: 0, pending: 0 });
  });

  test("concurrent callers share a single sync pass", async () => {
    await device.repository.setLessonCompleted(LESSON_A, true);

    const [first, secondResult] = await Promise.all([
      device.engine.sync(device.profileId, device.userId),
      device.engine.sync(device.profileId, device.userId),
    ]);

    expect(first).toBe(secondResult);
    expect(device.remote.applyCalls).toHaveLength(1);
    expect(device.remote.pullCalls).toHaveLength(1);
  });
});
