import { ProgressRemoteError } from "../progress-remote";
import type { SyncResult } from "../progress-sync-engine";
import {
  SyncScheduler,
  type SyncConnectivityMonitor,
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

/**
 * A stand-in for the device's connectivity, driven explicitly. `set` both changes what `isOnline()`
 * answers *and* notifies subscribers, the way a real network transition does — a fake that only did one
 * of the two would let a scheduler that ignores the notification still look correct.
 */
function createFakeConnectivity(initiallyOnline = true) {
  let online = initiallyOnline;
  const listeners = new Set<(online: boolean) => void>();

  const monitor: SyncConnectivityMonitor = {
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    monitor,
    set(next: boolean): void {
      online = next;
      for (const listener of [...listeners]) listener(next);
    },
    listenerCount: () => listeners.size,
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
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });

    scheduler.setSession(SESSION);

    expect(calls).toEqual(["profile-1"]);
    expect(scheduler.getState().status).toBe("syncing");
  });

  test("never schedules or attempts anything while anonymous", () => {
    const { engine, calls } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, { timer: clock });

    scheduler.setSession(null);
    scheduler.notifyAppForeground();
    scheduler.retry();
    scheduler.notifyLocalMutation();

    expect(calls).toEqual([]);
    expect(scheduled).toEqual([]);
    expect(scheduler.getState()).toEqual({ status: "signed-out", errorKind: null });
  });

  test("becomes up to date after a successful pass", async () => {
    const { engine, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });

    scheduler.setSession(SESSION);
    resolveNext(makeResult(3));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "up-to-date", errorKind: null });
  });

  test("attempts again when the app returns to the foreground", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });

    scheduler.setSession(SESSION);
    resolveNext(makeResult());
    await flush();

    scheduler.notifyAppForeground();

    expect(calls).toEqual(["profile-1", "profile-1"]);
  });

  test("a manual retry attempts immediately and cancels a pending backoff wait", async () => {
    const { engine, calls, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, { timer: clock });

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
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });

    scheduler.setSession(SESSION);
    resolveNext(makeResult());
    await flush();

    scheduler.notifyLocalMutation();

    expect(calls).toEqual(["profile-1", "profile-1"]);
  });

  test("a local mutation does not pile onto a pending backoff wait", async () => {
    const { engine, calls, rejectNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "network down"));
    await flush();

    scheduler.notifyLocalMutation();

    // Still just the one call: the pending backoff wait, not the mutation, owns the next attempt.
    expect(calls).toEqual(["profile-1"]);
  });

  test("a local mutation does not start a second sync while one is already in flight", () => {
    const { engine, calls } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });

    scheduler.setSession(SESSION);
    expect(scheduler.getState().status).toBe("syncing");

    scheduler.notifyLocalMutation();

    expect(calls).toEqual(["profile-1"]);
  });

  test("backs off 2s, 4s, 8s, 16s, 32s, then a 60s ceiling on consecutive transport failures", async () => {
    const { engine, rejectNext } = createFakeEngine();
    const { clock, scheduled, fireLatest } = createFakeClock();
    const scheduler = new SyncScheduler(engine, { timer: clock });

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
    const scheduler = new SyncScheduler(engine, { timer: clock });

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
    expect(scheduler.getState().status).toBe("up-to-date");

    scheduler.notifyAppForeground();
    rejectNext(new ProgressRemoteError("transport", "third failure"));
    await flush();
    expect(scheduled[2].delayMs).toBe(2000);
  });

  test("escalates to attention only after a second consecutive failure", async () => {
    const { engine, rejectNext } = createFakeEngine();
    const { clock, fireLatest } = createFakeClock();
    const scheduler = new SyncScheduler(engine, { timer: clock });

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "first failure"));
    await flush();
    expect(scheduler.getState().status).toBe("retrying");

    fireLatest();
    rejectNext(new ProgressRemoteError("transport", "second failure"));
    await flush();
    expect(scheduler.getState().status).toBe("attention");
  });

  test("pauses without scheduling a retry on an auth failure", async () => {
    const { engine, calls, resolveNext, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, { timer: clock });

    scheduler.setSession(SESSION);
    resolveNext(makeResult(2));
    await flush();

    scheduler.notifyAppForeground();
    rejectNext(new ProgressRemoteError("auth", "session expired"));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "attention", errorKind: "auth" });
    expect(scheduled).toHaveLength(0);

    // The soft local-mutation trigger must not hammer a session already known to be bad.
    scheduler.notifyLocalMutation();
    expect(calls).toEqual(["profile-1", "profile-1"]);
  });

  test("signing out mid-backoff cancels the pending retry and clears state", async () => {
    const { engine, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, { timer: clock });

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "network down"));
    await flush();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].cancelled).toBe(false);

    scheduler.setSession(null);

    expect(scheduled[0].cancelled).toBe(true);
    expect(scheduler.getState()).toEqual({ status: "signed-out", errorKind: null });
  });

  test("signing out while a pass is in flight discards its eventual result", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });

    scheduler.setSession(SESSION);
    expect(scheduler.getState().status).toBe("syncing");

    scheduler.setSession(null);
    expect(scheduler.getState()).toEqual({ status: "signed-out", errorKind: null });

    // The in-flight pass for the now-abandoned profile finishes late; it must not resurrect
    // "syncing" from the signed-out state.
    resolveNext(makeResult(7));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "signed-out", errorKind: null });
    expect(calls).toEqual(["profile-1"]);
  });

  test("ignores a stale result from a profile that has since been switched away from", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });
    const states = collectStates(scheduler);

    scheduler.setSession(SESSION_A);
    scheduler.setSession(SESSION_B);

    expect(calls).toEqual(["profile-a", "profile-b"]);

    // profile-a's pass finishes after the switch; it must not overwrite profile-b's own state.
    resolveNext(makeResult(9));
    await flush();

    expect(scheduler.getState().status).toBe("syncing");
    // Had profile-a's result been honoured, profile-b would have been published as caught up.
    expect(states.every((state) => state.status === "syncing")).toBe(true);

    resolveNext(makeResult(1));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "up-to-date", errorKind: null });
  });

  test("dispose cancels a pending retry and ignores every further trigger", async () => {
    const { engine, calls, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, { timer: clock });

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
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });

    scheduler.setSession(SESSION_A);
    resolveNext(makeResult());
    await flush();
    scheduler.setSession(SESSION_B);

    // The pair is what the remote checks each request against, so a scheduler that dropped or reused
    // the account id would silently reopen the cross-account write it exists to prevent.
    expect(identities).toEqual([SESSION_A, SESSION_B]);
  });

  test("asks for attention, not up to date, when a pass leaves a mutation the server keeps refusing", async () => {
    const { engine, resolveNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const scheduler = new SyncScheduler(engine, { timer: clock });

    scheduler.setSession(SESSION);
    resolveNext(makeResult(1, 1));
    await flush();

    expect(scheduler.getState()).toEqual({ status: "attention", errorKind: "rejected" });
    // The pass itself succeeded, so there is nothing to back off from — retrying the same request on a
    // timer is exactly what a permanent refusal does not need.
    expect(scheduled).toEqual([]);
  });

  test("queues an explicit retry that arrives while a pass is in flight, rather than dropping it", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const scheduler = new SyncScheduler(engine, { timer: createFakeClock().clock });

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
    expect(scheduler.getState().status).toBe("up-to-date");
  });

  test("reports offline instead of attempting while the device has no network", () => {
    const { engine, calls } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const connectivity = createFakeConnectivity(false);
    const scheduler = new SyncScheduler(engine, { timer: clock, connectivity: connectivity.monitor });

    scheduler.setSession(SESSION);
    scheduler.notifyLocalMutation();
    scheduler.notifyAppForeground();

    // Every request would fail on the first byte, and burning backoff steps on that leaves the ladder
    // long by the time the network is actually back — the delay this whole state exists to remove.
    expect(calls).toEqual([]);
    expect(scheduled).toEqual([]);
    expect(scheduler.getState()).toEqual({ status: "offline", errorKind: null });
  });

  test("syncs the moment the network returns, rather than waiting out the backoff", async () => {
    const { engine, calls, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const connectivity = createFakeConnectivity(true);
    const scheduler = new SyncScheduler(engine, { timer: clock, connectivity: connectivity.monitor });

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "network down"));
    await flush();
    expect(scheduler.getState().status).toBe("retrying");
    expect(scheduled).toHaveLength(1);

    connectivity.set(false);

    expect(scheduler.getState()).toEqual({ status: "offline", errorKind: null });
    expect(scheduled[0].cancelled).toBe(true);

    connectivity.set(true);

    expect(calls).toEqual(["profile-1", "profile-1"]);
    expect(scheduler.getState().status).toBe("syncing");
    // No timer was ever fired to get here: the one that existed was cancelled, and no other was made.
    expect(scheduled).toHaveLength(1);
  });

  test("does not restart the failure ladder just because the network came back", async () => {
    const { engine, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const connectivity = createFakeConnectivity(true);
    const scheduler = new SyncScheduler(engine, { timer: clock, connectivity: connectivity.monitor });

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("transport", "first failure"));
    await flush();
    expect(scheduled[0].delayMs).toBe(2000);

    connectivity.set(false);
    connectivity.set(true);
    rejectNext(new ProgressRemoteError("transport", "second failure"));
    await flush();

    // Only a *successful* pass clears the streak. A device flapping between networks would otherwise
    // sit on the first rung forever and never say anything is wrong.
    expect(scheduler.getState().status).toBe("attention");
    expect(scheduled[1].delayMs).toBe(4000);
  });

  test("reports offline, not a scheduled retry, when a pass fails with the network already gone", async () => {
    const { engine, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const connectivity = createFakeConnectivity(true);
    const scheduler = new SyncScheduler(engine, { timer: clock, connectivity: connectivity.monitor });

    scheduler.setSession(SESSION);
    // Airplane mode mid-pass: the request in flight is already doomed.
    connectivity.set(false);
    rejectNext(new ProgressRemoteError("transport", "network unreachable"));
    await flush();

    // "Offline" is the true account of that failure, and a timer would only fire into the same wall.
    expect(scheduler.getState()).toEqual({ status: "offline", errorKind: null });
    expect(scheduled).toEqual([]);
  });

  test("leaves an expired session needing attention while the network flaps", async () => {
    const { engine, calls, rejectNext } = createFakeEngine();
    const { clock, scheduled } = createFakeClock();
    const connectivity = createFakeConnectivity(true);
    const scheduler = new SyncScheduler(engine, { timer: clock, connectivity: connectivity.monitor });

    scheduler.setSession(SESSION);
    rejectNext(new ProgressRemoteError("auth", "session expired"));
    await flush();
    expect(scheduler.getState()).toEqual({ status: "attention", errorKind: "auth" });

    connectivity.set(false);
    // A network that came and went says nothing about a session the server has already refused, and
    // reporting "offline" would replace the one thing the learner actually has to act on.
    expect(scheduler.getState()).toEqual({ status: "attention", errorKind: "auth" });

    connectivity.set(true);

    expect(calls).toEqual(["profile-1"]);
    expect(scheduler.getState()).toEqual({ status: "attention", errorKind: "auth" });
    expect(scheduled).toEqual([]);
  });

  test("keeps reporting signed-out, not offline, when the network changes while anonymous", () => {
    const { engine, calls } = createFakeEngine();
    const { clock } = createFakeClock();
    const connectivity = createFakeConnectivity(true);
    const scheduler = new SyncScheduler(engine, { timer: clock, connectivity: connectivity.monitor });

    scheduler.setSession(null);
    connectivity.set(false);
    connectivity.set(true);

    // There is nothing to sync and no account to sync it for; "offline" would put a network complaint
    // in front of a learner who never asked for an account.
    expect(calls).toEqual([]);
    expect(scheduler.getState()).toEqual({ status: "signed-out", errorKind: null });
  });

  test("stops listening to connectivity once disposed", async () => {
    const { engine, calls, resolveNext } = createFakeEngine();
    const { clock } = createFakeClock();
    const connectivity = createFakeConnectivity(true);
    const scheduler = new SyncScheduler(engine, { timer: clock, connectivity: connectivity.monitor });

    scheduler.setSession(SESSION);
    resolveNext(makeResult());
    await flush();
    expect(connectivity.listenerCount()).toBe(1);

    scheduler.dispose();

    expect(connectivity.listenerCount()).toBe(0);
    connectivity.set(false);
    connectivity.set(true);
    expect(calls).toEqual(["profile-1"]);
  });
});
