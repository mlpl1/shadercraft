import { ProgressRemoteError } from "../progress-remote";
import type { SyncResult } from "../progress-sync-engine";
import {
  SyncScheduler,
  type SyncEngineLike,
  type SyncSchedulerState,
  type SyncSchedulerTimer,
  type SyncSession,
} from "../sync-scheduler";

/** The profile/account pair every test below syncs, unless it needs a second one. */
const SESSION: SyncSession = { profileId: "profile-1", supabaseUserId: "user-1" };
const SESSION_A: SyncSession = { profileId: "profile-a", supabaseUserId: "user-a" };
const SESSION_B: SyncSession = { profileId: "profile-b", supabaseUserId: "user-b" };

function makeResult(pending = 0, blocked = 0): SyncResult {
  return { pushed: 0, pulled: 0, pending, blocked, lastCursor: 0 };
}

type ScheduledTimer = { delayMs: number; run: () => void; cancelled: boolean };

/**
 * A deterministic stand-in for real time: `after` never actually waits. It records the delay and
 * callback it was asked to schedule so a test can fire it explicitly (`fireLatest`) or inspect the
 * requested delay, and can confirm cancellation happened rather than assuming it.
 */
function createFakeClock() {
  const scheduled: ScheduledTimer[] = [];

  const clock: SyncSchedulerTimer = {
    after(delayMs, callback) {
      const entry: ScheduledTimer = { delayMs, run: callback, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };

  return {
    clock,
    scheduled,
    /** Fires the most recently scheduled, not-cancelled timer, as if its delay had elapsed. */
    fireLatest(): void {
      const entry = [...scheduled].reverse().find((candidate) => !candidate.cancelled);
      if (!entry) throw new Error("No pending timer to fire");
      entry.run();
    },
  };
}

/** A controllable stand-in for `ProgressSyncEngine.sync`: each call queues its own resolution. */
function createFakeEngine() {
  const calls: string[] = [];
  /** Every `(profileId, supabaseUserId)` pair the scheduler asked for, in order. */
  const identities: SyncSession[] = [];
  const pending: { resolve: (result: SyncResult) => void; reject: (error: unknown) => void }[] = [];

  const engine: SyncEngineLike = {
    sync(profileId: string, supabaseUserId: string) {
      calls.push(profileId);
      identities.push({ profileId, supabaseUserId });
      return new Promise<SyncResult>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
  };

  return {
    engine,
    calls,
    identities,
    resolveNext(result: SyncResult = makeResult()): void {
      const next = pending.shift();
      if (!next) throw new Error("No pending sync() call to resolve");
      next.resolve(result);
    },
    rejectNext(error: unknown): void {
      const next = pending.shift();
      if (!next) throw new Error("No pending sync() call to reject");
      next.reject(error);
    },
  };
}

/** Lets a resolved/rejected promise's `.then`/`.catch` handlers run before assertions. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function collectStates(scheduler: SyncScheduler): SyncSchedulerState[] {
  const states: SyncSchedulerState[] = [];
  scheduler.subscribe((state) => states.push(state));
  return states;
}

describe("SyncScheduler", () => {
  test("attempts a sync as soon as an authenticated session begins", () => {
    const { engine, calls } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);

    scheduler.setSession(SESSION);

    expect(calls).toEqual(["profile-1"]);
    expect(scheduler.getState().status).toBe("syncing");
  });

  test("never schedules or attempts anything while anonymous", () => {
    const { engine, calls } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, clock);

    scheduler.setSession(null);
    scheduler.notifyAppForeground();
    scheduler.retry();
    scheduler.notifyLocalMutation();

    expect(calls).toEqual([]);
    expect(scheduled).toEqual([]);
    expect(scheduler.getState()).toEqual({ status: "offline", pending: 0, errorKind: null });
  });

  test("becomes idle with the returned pending count after a successful pass", async () => {
    const { engine, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);

    scheduler.setSession(SESSION);
    resolveNext(makeResult(3));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "idle", pending: 3, errorKind: null });
  });

  test("attempts again when the app returns to the foreground", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);

    scheduler.setSession(SESSION);
    resolveNext(makeResult());
    await flush();

    scheduler.notifyAppForeground();

    expect(calls).toEqual(["profile-1", "profile-1"]);
  });

  test("a manual retry attempts immediately and cancels a pending backoff wait", async () => {
    const { engine, calls, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, clock);

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "network down"));
    await flush();

    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].cancelled).toBe(false);

    scheduler.retry();

    expect(scheduled[0].cancelled).toBe(true);
    expect(calls).toEqual(["profile-1", "profile-1"]);
  });

  test("a local mutation attempts a sync while idle", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);

    scheduler.setSession(SESSION);
    resolveNext(makeResult());
    await flush();

    scheduler.notifyLocalMutation();

    expect(calls).toEqual(["profile-1", "profile-1"]);
  });

  test("a local mutation does not pile onto a pending backoff wait", async () => {
    const { engine, calls, rejectNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "network down"));
    await flush();

    scheduler.notifyLocalMutation();

    // Still just the one call: the pending backoff wait, not the mutation, owns the next attempt.
    expect(calls).toEqual(["profile-1"]);
  });

  test("a local mutation does not start a second sync while one is already in flight", () => {
    const { engine, calls } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);

    scheduler.setSession(SESSION);
    expect(scheduler.getState().status).toBe("syncing");

    scheduler.notifyLocalMutation();

    expect(calls).toEqual(["profile-1"]);
  });

  test("backs off 2s, 4s, 8s, 16s, 32s, then a 60s ceiling on consecutive transport failures", async () => {
    const { engine, rejectNext } = createFakeEngine();
    const { clock, scheduled, fireLatest } = createFakeClock();
    const scheduler = new SyncScheduler(engine, clock);

    scheduler.setSession(SESSION);
    const delays: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      rejectNext(new ProgressRemoteError("transport", `failure ${attempt}`));
      await flush();
      delays.push(scheduled[scheduled.length - 1].delayMs);
      if (attempt < 6) fireLatest();
    }

    expect(delays).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });

  test("resets the backoff to 2s after a successful pass", async () => {
    const { engine, rejectNext, resolveNext } = createFakeEngine();
    const { clock, scheduled, fireLatest } = createFakeClock();
    const scheduler = new SyncScheduler(engine, clock);

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "first failure"));
    await flush();
    expect(scheduled[0].delayMs).toBe(2000);

    fireLatest();
    rejectNext(new ProgressRemoteError("transport", "second failure"));
    await flush();
    expect(scheduled[1].delayMs).toBe(4000);

    fireLatest();
    resolveNext(makeResult());
    await flush();
    expect(scheduler.getState().status).toBe("idle");

    scheduler.notifyAppForeground();
    rejectNext(new ProgressRemoteError("transport", "third failure"));
    await flush();
    expect(scheduled[2].delayMs).toBe(2000);
  });

  test("escalates to attention only after a second consecutive failure", async () => {
    const { engine, rejectNext } = createFakeEngine();
    const { clock, fireLatest } = createFakeClock();
    const scheduler = new SyncScheduler(engine, clock);

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "first failure"));
    await flush();
    expect(scheduler.getState().status).toBe("offline");

    fireLatest();
    rejectNext(new ProgressRemoteError("transport", "second failure"));
    await flush();
    expect(scheduler.getState().status).toBe("attention");
  });

  test("pauses without scheduling a retry on an auth failure, but keeps the last pending count", async () => {
    const { engine, calls, resolveNext, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, clock);

    scheduler.setSession(SESSION);
    resolveNext(makeResult(2));
    await flush();

    scheduler.notifyAppForeground();
    rejectNext(new ProgressRemoteError("auth", "session expired"));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "attention", pending: 2, errorKind: "auth" });
    expect(scheduled).toHaveLength(0);

    // The soft local-mutation trigger must not hammer a session already known to be bad.
    scheduler.notifyLocalMutation();
    expect(calls).toEqual(["profile-1", "profile-1"]);
  });

  test("signing out mid-backoff cancels the pending retry and clears state", async () => {
    const { engine, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, clock);

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "network down"));
    await flush();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].cancelled).toBe(false);

    scheduler.setSession(null);

    expect(scheduled[0].cancelled).toBe(true);
    expect(scheduler.getState()).toEqual({ status: "offline", pending: 0, errorKind: null });
  });

  test("signing out while a pass is in flight discards its eventual result", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);

    scheduler.setSession(SESSION);
    expect(scheduler.getState().status).toBe("syncing");

    scheduler.setSession(null);
    expect(scheduler.getState()).toEqual({ status: "offline", pending: 0, errorKind: null });

    // The in-flight pass for the now-abandoned profile finishes late; it must not resurrect
    // "syncing" or leak its pending count into the signed-out state.
    resolveNext(makeResult(7));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "offline", pending: 0, errorKind: null });
    expect(calls).toEqual(["profile-1"]);
  });

  test("ignores a stale result from a profile that has since been switched away from", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);
    const states = collectStates(scheduler);

    scheduler.setSession(SESSION_A);
    scheduler.setSession(SESSION_B);

    expect(calls).toEqual(["profile-a", "profile-b"]);

    // profile-a's pass finishes after the switch; it must not overwrite profile-b's own state.
    resolveNext(makeResult(9));
    await flush();

    expect(scheduler.getState().status).toBe("syncing");
    expect(states.some((state) => state.pending === 9)).toBe(false);

    resolveNext(makeResult(1));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "idle", pending: 1, errorKind: null });
  });

  test("dispose cancels a pending retry and ignores every further trigger", async () => {
    const { engine, calls, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, clock);

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "network down"));
    await flush();
    expect(scheduled[0].cancelled).toBe(false);

    scheduler.dispose();
    expect(scheduled[0].cancelled).toBe(true);

    scheduler.setSession(SESSION);
    scheduler.retry();
    scheduler.notifyAppForeground();
    scheduler.notifyLocalMutation();

    expect(calls).toEqual(["profile-1"]);
  });

  test("hands the engine the Supabase account the profile belongs to, not just the profile", async () => {
    const { engine, identities, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);

    scheduler.setSession(SESSION_A);
    resolveNext(makeResult());
    await flush();
    scheduler.setSession(SESSION_B);

    // The pair is what the remote checks each request against, so a scheduler that dropped or reused
    // the account id would silently reopen the cross-account write it exists to prevent.
    expect(identities).toEqual([SESSION_A, SESSION_B]);
  });

  test("asks for attention, not idle, when a pass leaves a mutation the server keeps refusing", async () => {
    const { engine, resolveNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, clock);

    scheduler.setSession(SESSION);
    resolveNext(makeResult(1, 1));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "attention", pending: 1, errorKind: "rejected" });
    // The pass itself succeeded, so there is nothing to back off from — retrying the same request on a
    // timer is exactly what a permanent refusal does not need.
    expect(scheduled).toEqual([]);
  });

  test("queues an explicit retry that arrives while a pass is in flight, rather than dropping it", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, createFakeClock().clock);

    scheduler.setSession(SESSION);
    expect(calls).toEqual(["profile-1"]);

    // `ProgressSyncEngine.sync` would hand this caller the pass already running, which may well have
    // read the outbox before whatever the learner is retrying for.
    scheduler.retry();
    expect(calls).toEqual(["profile-1"]);

    resolveNext(makeResult(1));
    await flush();

    expect(calls).toEqual(["profile-1", "profile-1"]);
    expect(scheduler.getState().status).toBe("syncing");

    // And exactly one follow-up: it must not turn into a pass per pass forever.
    resolveNext(makeResult());
    await flush();
    expect(calls).toEqual(["profile-1", "profile-1"]);
    expect(scheduler.getState().status).toBe("idle");
  });
});
