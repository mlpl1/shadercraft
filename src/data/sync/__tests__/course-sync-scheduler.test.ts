import type { CourseSyncResult } from "../course-sync-engine";
import {
  CourseSyncScheduler,
  FOREGROUND_RECHECK_INTERVAL_MS,
  type CourseSyncEngineLike,
  type CourseSyncSchedulerState,
} from "../course-sync-scheduler";
import {
  BACKOFF_DELAYS_MS,
  type SyncConnectivityMonitor,
  type SyncSchedulerTimer,
} from "../sync-scheduler";

type ScheduledTimer = {
  delayMs: number;
  run: () => void;
  cancelled: boolean;
  /** Set once the test has fired it, so it stops counting as a wait the scheduler is still on. */
  fired: boolean;
};

/**
 * The same deterministic stand-in for real time as `sync-scheduler.test.ts`: `after` never waits, it
 * records what it was asked to schedule so a test can fire it explicitly or inspect the delay, and
 * cancellation is observable rather than assumed.
 */
function createFakeClock() {
  const scheduled: ScheduledTimer[] = [];

  const clock: SyncSchedulerTimer = {
    after(delayMs, callback) {
      const entry: ScheduledTimer = { delayMs, run: callback, cancelled: false, fired: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };

  const pending = () => scheduled.filter((entry) => !entry.cancelled && !entry.fired);

  return {
    clock,
    scheduled,
    pending,
    fireLatest(): void {
      const entry = [...pending()].pop();
      if (!entry) throw new Error("No pending timer to fire");
      entry.fired = true;
      entry.run();
    },
  };
}

/** Connectivity driven explicitly: `set` changes the answer *and* notifies, like a real transition. */
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

/** A controllable stand-in for `CourseSyncEngine.checkForUpdate`: each call queues its own settlement. */
function createFakeEngine() {
  const pending: {
    resolve: (result: CourseSyncResult) => void;
    reject: (error: unknown) => void;
  }[] = [];
  let calls = 0;

  const engine: CourseSyncEngineLike = {
    checkForUpdate() {
      calls += 1;
      return new Promise<CourseSyncResult>((resolve, reject) => {
        pending.push({ resolve, reject });
      });
    },
  };

  return {
    engine,
    callCount: () => calls,
    /** Settles the oldest unsettled check, then flushes the microtask queue. */
    async settle(result: CourseSyncResult): Promise<void> {
      const next = pending.shift();
      if (!next) throw new Error("No check in flight to settle");
      next.resolve(result);
      await Promise.resolve();
      await Promise.resolve();
    },
    async fail(error: unknown = new Error("check exploded")): Promise<void> {
      const next = pending.shift();
      if (!next) throw new Error("No check in flight to fail");
      next.reject(error);
      await Promise.resolve();
      await Promise.resolve();
    },
    inFlight: () => pending.length,
  };
}

function createHarness(options: { online?: boolean } = {}) {
  const clock = createFakeClock();
  const connectivity = createFakeConnectivity(options.online ?? true);
  const engine = createFakeEngine();
  let now = 1_000_000;
  const states: CourseSyncSchedulerState[] = [];

  const scheduler = new CourseSyncScheduler(engine.engine, {
    timer: clock.clock,
    connectivity: connectivity.monitor,
    now: () => now,
  });
  scheduler.subscribe((state) => states.push(state));

  return {
    clock,
    connectivity,
    engine,
    scheduler,
    states,
    statuses: () => states.map((state) => state.status),
    advance(ms: number): void {
      now += ms;
    },
  };
}

const UP_TO_DATE: CourseSyncResult = { kind: "current" };

describe("course sync scheduler", () => {
  test("starts idle and checks nothing before it is started", () => {
    const harness = createHarness();

    expect(harness.scheduler.getState()).toEqual<CourseSyncSchedulerState>({
      status: "idle",
      updatedReleaseId: null,
      requiredAppVersion: null,
      failureCategory: null,
    });
    expect(harness.engine.callCount()).toBe(0);
    expect(harness.clock.pending()).toEqual([]);
  });

  test("checks once on a ready startup and reports being up to date", async () => {
    const harness = createHarness();

    harness.scheduler.start();

    expect(harness.engine.callCount()).toBe(1);
    expect(harness.scheduler.getState().status).toBe("checking");

    await harness.engine.settle(UP_TO_DATE);

    expect(harness.scheduler.getState().status).toBe("up-to-date");
    expect(harness.statuses()).toEqual(["checking", "up-to-date"]);
  });

  test("ignores a second start", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle(UP_TO_DATE);
    harness.scheduler.start();

    expect(harness.engine.callCount()).toBe(1);
  });

  test("reports the release id an activation installed", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle({ kind: "updated", releaseId: "remote-42" });

    expect(harness.scheduler.getState()).toEqual<CourseSyncSchedulerState>({
      status: "up-to-date",
      updatedReleaseId: "remote-42",
      requiredAppVersion: null,
      failureCategory: null,
    });
  });

  test("does not re-check on a foreground return before the recheck interval elapses", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle(UP_TO_DATE);

    harness.advance(FOREGROUND_RECHECK_INTERVAL_MS - 1);
    harness.scheduler.notifyAppForeground();

    expect(harness.engine.callCount()).toBe(1);
    expect(harness.scheduler.getState().status).toBe("up-to-date");
  });

  test("re-checks on a foreground return once the recheck interval has elapsed", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle(UP_TO_DATE);

    harness.advance(FOREGROUND_RECHECK_INTERVAL_MS);
    harness.scheduler.notifyAppForeground();

    expect(harness.engine.callCount()).toBe(2);
  });

  test("checks six hours after the previous check, not after the previous start", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    harness.advance(FOREGROUND_RECHECK_INTERVAL_MS);
    // The first check is still in flight, so the interval is measured from when it settles.
    await harness.engine.settle(UP_TO_DATE);

    harness.scheduler.notifyAppForeground();
    expect(harness.engine.callCount()).toBe(1);

    harness.advance(FOREGROUND_RECHECK_INTERVAL_MS);
    harness.scheduler.notifyAppForeground();
    expect(harness.engine.callCount()).toBe(2);
  });

  test("ignores a foreground return before the app has ever been started", () => {
    const harness = createHarness();

    harness.scheduler.notifyAppForeground();

    expect(harness.engine.callCount()).toBe(0);
    expect(harness.scheduler.getState().status).toBe("idle");
  });

  test("checks immediately on a manual retry, ignoring the recheck interval", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle(UP_TO_DATE);

    harness.scheduler.retry();

    expect(harness.engine.callCount()).toBe(2);
  });

  test("a manual retry bypasses a pending backoff wait", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle({ kind: "failed", category: "network" });
    expect(harness.clock.pending()).toHaveLength(1);

    harness.scheduler.retry();

    expect(harness.engine.callCount()).toBe(2);
    expect(harness.clock.pending()).toEqual([]);
    expect(harness.clock.scheduled[0].cancelled).toBe(true);
  });

  test("never runs two checks at once", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    harness.advance(FOREGROUND_RECHECK_INTERVAL_MS);
    harness.scheduler.notifyAppForeground();
    harness.scheduler.retry();
    harness.scheduler.start();

    expect(harness.engine.callCount()).toBe(1);
    expect(harness.engine.inFlight()).toBe(1);

    await harness.engine.settle(UP_TO_DATE);
    expect(harness.engine.callCount()).toBe(1);
  });

  test("retries a failed check on the shared bounded backoff ladder", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle({ kind: "failed", category: "network" });

    expect(harness.scheduler.getState()).toEqual<CourseSyncSchedulerState>({
      status: "retrying",
      updatedReleaseId: null,
      requiredAppVersion: null,
      failureCategory: "network",
    });
    expect(harness.clock.pending()).toHaveLength(1);
    expect(harness.clock.pending()[0].delayMs).toBe(BACKOFF_DELAYS_MS[0]);

    harness.clock.fireLatest();
    expect(harness.engine.callCount()).toBe(2);
    await harness.engine.settle({ kind: "failed", category: "protocol" });

    // Second consecutive failure escalates to the non-blocking `attention` state and the next rung.
    expect(harness.scheduler.getState().status).toBe("attention");
    expect(harness.scheduler.getState().failureCategory).toBe("protocol");
    expect(harness.clock.pending()[0].delayMs).toBe(BACKOFF_DELAYS_MS[1]);
  });

  test("caps the backoff at the ladder's last rung", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    for (let attempt = 0; attempt < BACKOFF_DELAYS_MS.length + 3; attempt += 1) {
      await harness.engine.settle({ kind: "failed", category: "network" });
      expect(harness.clock.pending()[0].delayMs).toBe(
        BACKOFF_DELAYS_MS[Math.min(attempt, BACKOFF_DELAYS_MS.length - 1)],
      );
      harness.clock.fireLatest();
    }
  });

  test("an activation resets the backoff ladder just as an unchanged check does", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle({ kind: "failed", category: "network" });
    harness.clock.fireLatest();
    await harness.engine.settle({ kind: "failed", category: "network" });
    expect(harness.clock.pending()[0].delayMs).toBe(BACKOFF_DELAYS_MS[1]);

    harness.clock.fireLatest();
    await harness.engine.settle({ kind: "updated", releaseId: "remote-9" });
    expect(harness.scheduler.getState().status).toBe("up-to-date");

    harness.scheduler.retry();
    await harness.engine.settle({ kind: "failed", category: "network" });
    expect(harness.clock.pending()[0].delayMs).toBe(BACKOFF_DELAYS_MS[0]);
  });

  test("keeps reporting the release it installed across later unchanged checks", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle({ kind: "updated", releaseId: "remote-9" });

    harness.scheduler.retry();
    await harness.engine.settle(UP_TO_DATE);

    // "Nothing new was published" must not read as "no release was ever installed".
    expect(harness.scheduler.getState().updatedReleaseId).toBe("remote-9");
  });

  test("a successful check resets the backoff ladder and clears the failure", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle({ kind: "failed", category: "network" });
    harness.clock.fireLatest();
    await harness.engine.settle({ kind: "failed", category: "network" });
    expect(harness.clock.pending()[0].delayMs).toBe(BACKOFF_DELAYS_MS[1]);

    harness.clock.fireLatest();
    await harness.engine.settle(UP_TO_DATE);
    expect(harness.scheduler.getState()).toEqual<CourseSyncSchedulerState>({
      status: "up-to-date",
      updatedReleaseId: null,
      requiredAppVersion: null,
      failureCategory: null,
    });

    harness.scheduler.retry();
    await harness.engine.settle({ kind: "failed", category: "network" });
    expect(harness.clock.pending()[0].delayMs).toBe(BACKOFF_DELAYS_MS[0]);
  });

  test("treats an engine rejection as a failed check rather than crashing the schedule", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.fail(new Error("unexpected"));

    expect(harness.scheduler.getState().status).toBe("retrying");
    expect(harness.scheduler.getState().failureCategory).toBe("protocol");
    expect(harness.clock.pending()).toHaveLength(1);
  });

  test("stops retrying when the release needs a newer app, and says which one", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle({ kind: "requires-app-update", minimumAppVersion: "2.1.0" });

    expect(harness.scheduler.getState()).toEqual<CourseSyncSchedulerState>({
      status: "requires-app-update",
      updatedReleaseId: null,
      requiredAppVersion: "2.1.0",
      failureCategory: null,
    });
    // No amount of retrying installs a release this build cannot run.
    expect(harness.clock.pending()).toEqual([]);
  });

  test("attempts nothing while the device reports itself offline", () => {
    const harness = createHarness({ online: false });

    harness.scheduler.start();

    expect(harness.engine.callCount()).toBe(0);
    expect(harness.scheduler.getState().status).toBe("offline");
    expect(harness.clock.pending()).toEqual([]);
  });

  test("checks the moment the network returns, without waiting on any timer", async () => {
    const harness = createHarness({ online: false });

    harness.scheduler.start();
    harness.connectivity.set(true);

    expect(harness.engine.callCount()).toBe(1);
    await harness.engine.settle(UP_TO_DATE);
    expect(harness.scheduler.getState().status).toBe("up-to-date");
  });

  test("a lost network cancels the backoff wait and explains itself", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle({ kind: "failed", category: "network" });

    harness.connectivity.set(false);

    expect(harness.clock.pending()).toEqual([]);
    expect(harness.clock.scheduled[0].cancelled).toBe(true);
    expect(harness.scheduler.getState().status).toBe("offline");
    expect(harness.scheduler.getState().failureCategory).toBeNull();
  });

  test("does not react to connectivity before it has been started", () => {
    const harness = createHarness({ online: false });

    harness.connectivity.set(true);

    expect(harness.engine.callCount()).toBe(0);
    expect(harness.scheduler.getState().status).toBe("idle");
  });

  test("disposal cancels the pending retry, unsubscribes, and ignores a late result", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    await harness.engine.settle({ kind: "failed", category: "network" });
    const stateCount = harness.states.length;

    harness.scheduler.dispose();

    expect(harness.clock.pending()).toEqual([]);
    expect(harness.connectivity.listenerCount()).toBe(0);

    harness.scheduler.retry();
    harness.scheduler.notifyAppForeground();
    harness.scheduler.start();
    expect(harness.engine.callCount()).toBe(1);
    expect(harness.states).toHaveLength(stateCount);
  });

  test("ignores the result of a check that was still in flight at disposal", async () => {
    const harness = createHarness();

    harness.scheduler.start();
    harness.scheduler.dispose();
    await harness.engine.settle(UP_TO_DATE);

    expect(harness.scheduler.getState().status).toBe("checking");
    expect(harness.clock.pending()).toEqual([]);
  });
});
