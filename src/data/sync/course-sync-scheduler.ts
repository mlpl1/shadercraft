import type { CourseSyncFailureCategory, CourseSyncResult } from "./course-sync-engine";
import {
  BACKOFF_DELAYS_MS,
  type SyncConnectivityMonitor,
  type SyncSchedulerTimer,
} from "./sync-scheduler";

/**
 * What the UI may render about background curriculum checks. Deliberately a *separate* vocabulary
 * from {@link ../sync-scheduler.SyncStatus}: progress sync describes a learner's own work reaching
 * their account, curriculum sync describes whether the course content is the newest published one.
 * Conflating the two is what would let a failed content check read as "your progress is not saved".
 *
 * - `idle` — nothing has been checked yet, because the local database is not ready or the app has not
 *   started the schedule.
 * - `offline` — the device reports no usable network. Nothing was attempted and nothing is scheduled;
 *   the moment connectivity returns, a check runs.
 * - `checking` — a check is running.
 * - `up-to-date` — the last check succeeded: either the installed release is the published one, or a
 *   newer one was just activated (see `updatedReleaseId`).
 * - `retrying` — the last check failed once and an automatic retry is already waiting on the ladder.
 * - `attention` — failure has repeated. Still never blocking: the previous release is fully usable
 *   offline, so this is a signal to surface quietly, not an error page.
 * - `requires-app-update` — the published release needs a newer app than this one. No retry is
 *   scheduled, because no amount of waiting changes it.
 *
 * None of these states ever justify blocking or delaying local learning.
 */
export type CourseSyncStatus =
  | "idle"
  | "offline"
  | "checking"
  | "up-to-date"
  | "retrying"
  | "attention"
  | "requires-app-update";

export type CourseSyncSchedulerState = {
  status: CourseSyncStatus;
  /** The release id the most recent activation installed, or `null` if none ever has. */
  updatedReleaseId: string | null;
  /** The app version the published release demands, set only while `requires-app-update`. */
  requiredAppVersion: string | null;
  /** The safe classification of the most recent failure. Cleared to `null` on the next success. */
  failureCategory: CourseSyncFailureCategory | null;
};

/**
 * The one operation the scheduler drives, narrowed from `CourseSyncEngine` so a test double never has
 * to impersonate the rest of it.
 */
export type CourseSyncEngineLike = {
  checkForUpdate(): Promise<CourseSyncResult>;
};

/**
 * How long a foreground return waits before it is worth re-checking. Curriculum releases are
 * published on a human timescale (days), and a check costs a round trip plus a full payload download
 * whenever one landed, so checking on *every* foreground return would spend a learner's data to learn
 * nothing. Six hours means a device used through a day sees a same-day publication without ever
 * polling.
 */
export const FOREGROUND_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Consecutive automatic failures that escalate `retrying` to the still-non-blocking `attention`. */
const ATTENTION_AFTER_CONSECUTIVE_FAILURES = 2;

const REAL_TIMER: SyncSchedulerTimer = {
  after(delayMs, callback) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

const ALWAYS_ONLINE: SyncConnectivityMonitor = {
  isOnline: () => true,
  subscribe: () => () => {},
};

export type CourseSyncSchedulerOptions = {
  timer?: SyncSchedulerTimer;
  connectivity?: SyncConnectivityMonitor;
  /** Injected clock, so the recheck interval can be driven without waiting six hours. */
  now?: () => number;
  foregroundRecheckIntervalMs?: number;
};

const INITIAL_STATE: CourseSyncSchedulerState = {
  status: "idle",
  updatedReleaseId: null,
  requiredAppVersion: null,
  failureCategory: null,
};

/**
 * Decides *when* {@link CourseSyncEngineLike.checkForUpdate} runs, and what the UI may say about it.
 * The engine decides everything about whether a release applies; nothing here knows what a release
 * is.
 *
 * Modelled on `SyncScheduler` and sharing its {@link BACKOFF_DELAYS_MS} ladder, its injected
 * {@link SyncSchedulerTimer}, and its injected {@link SyncConnectivityMonitor} — so the whole schedule
 * is drivable by a test with no clock, no `AppState`, and no `expo-network`; turning those real
 * triggers into these calls is `src/context/sync-context.tsx`'s job. It keeps its own state, and
 * publishes only to its own subscribers, which is what keeps a failed curriculum check from ever
 * describing a learner's progress sync.
 *
 * - {@link start} — the local database is ready. Checks once, and only once: everything after is a
 *   foreground return, a retry, or the backoff ladder. Nothing is ever checked before this, because a
 *   release cannot be installed into a database that is not open, and a network call must never stand
 *   between launch and first paint.
 * - {@link notifyAppForeground} — the app came back. Checks only if
 *   {@link FOREGROUND_RECHECK_INTERVAL_MS} has passed since the last check *settled*.
 * - {@link retry} — an explicit, learner-initiated check. Ignores the interval and cancels any
 *   backoff wait.
 *
 * A check already in flight absorbs every trigger that arrives while it runs: unlike progress sync,
 * there is no local queue that could have grown mid-pass, so a second concurrent check would fetch
 * the same manifest and reach the same conclusion.
 */
export class CourseSyncScheduler {
  private state: CourseSyncSchedulerState = INITIAL_STATE;
  private readonly listeners = new Set<(state: CourseSyncSchedulerState) => void>();
  private started = false;
  private checking = false;
  private failureStreak = 0;
  private lastSettledAt: number | null = null;
  private cancelPendingRetry: (() => void) | null = null;
  private disposed = false;
  private readonly timer: SyncSchedulerTimer;
  private readonly connectivity: SyncConnectivityMonitor;
  private readonly now: () => number;
  private readonly recheckIntervalMs: number;
  private readonly unsubscribeConnectivity: () => void;

  constructor(
    private readonly engine: CourseSyncEngineLike,
    options: CourseSyncSchedulerOptions = {},
  ) {
    this.timer = options.timer ?? REAL_TIMER;
    this.connectivity = options.connectivity ?? ALWAYS_ONLINE;
    this.now = options.now ?? (() => Date.now());
    this.recheckIntervalMs = options.foregroundRecheckIntervalMs ?? FOREGROUND_RECHECK_INTERVAL_MS;
    this.unsubscribeConnectivity = this.connectivity.subscribe((online) => {
      this.handleConnectivityChange(online);
    });
  }

  getState(): CourseSyncSchedulerState {
    return this.state;
  }

  subscribe(listener: (state: CourseSyncSchedulerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    this.attempt();
  }

  notifyAppForeground(): void {
    if (this.disposed || !this.started) return;
    const settledAt = this.lastSettledAt;
    // A check still in flight has not settled, so there is nothing to measure the interval from — and
    // `attempt()` would absorb this trigger anyway.
    if (settledAt !== null && this.now() - settledAt < this.recheckIntervalMs) return;
    this.attempt();
  }

  retry(): void {
    if (this.disposed || !this.started) return;
    this.attempt();
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
    this.unsubscribeConnectivity();
    this.listeners.clear();
  }

  /**
   * The network came or went.
   *
   * Losing it cancels the backoff wait — every rung would fire into the same wall — and publishes
   * `offline`, which is the true account of why nothing is moving. Regaining it checks at once,
   * because the reason for the wait has just gone away.
   *
   * The failure streak is deliberately not reset either way: only a successful check earns that, so a
   * device flapping between networks still escalates rather than sitting on the first rung forever.
   */
  private handleConnectivityChange(online: boolean): void {
    if (this.disposed || !this.started) return;

    if (!online) {
      this.cancelTimer();
      this.publishOffline();
      return;
    }

    if (this.checking) return;
    this.attempt();
  }

  private attempt(): void {
    if (this.checking) return;

    this.cancelTimer();
    if (!this.connectivity.isOnline()) {
      // Known-offline, not merely unsure (see `SyncConnectivityMonitor`). Whatever asked for this
      // check stays true until the network is back, and `handleConnectivityChange` runs it then.
      this.publishOffline();
      return;
    }

    this.checking = true;
    this.publish({ ...this.state, status: "checking" });

    this.engine.checkForUpdate().then(
      (result) => {
        this.settle(() => this.applyResult(result));
      },
      () => {
        // `CourseSyncEngine.checkForUpdate` resolves rather than rejects, so this is a defect
        // somewhere above it, not a classified outcome. Treated as a retryable failure so a schedule
        // is never lost to an exception.
        this.settle(() => this.applyFailure("protocol"));
      },
    );
  }

  /** Common bookkeeping for a settled check: a disposed scheduler never publishes anything. */
  private settle(apply: () => void): void {
    if (this.disposed) return;
    this.checking = false;
    this.lastSettledAt = this.now();
    apply();
  }

  private applyResult(result: CourseSyncResult): void {
    switch (result.kind) {
      case "failed":
        this.applyFailure(result.category);
        return;
      case "requires-app-update":
        // Not a failure, and not retryable: the release is fine, this build is not. The next
        // foreground check re-reads the manifest in case a different release was published since.
        this.failureStreak = 0;
        this.publish({
          status: "requires-app-update",
          updatedReleaseId: this.state.updatedReleaseId,
          requiredAppVersion: result.minimumAppVersion,
          failureCategory: null,
        });
        return;
      case "updated":
        this.failureStreak = 0;
        this.publish({
          status: "up-to-date",
          updatedReleaseId: result.releaseId,
          requiredAppVersion: null,
          failureCategory: null,
        });
        return;
      case "current":
        this.failureStreak = 0;
        this.publish({
          status: "up-to-date",
          updatedReleaseId: this.state.updatedReleaseId,
          requiredAppVersion: null,
          failureCategory: null,
        });
    }
  }

  private applyFailure(category: CourseSyncFailureCategory): void {
    this.failureStreak += 1;

    // The network went away under the check. Say *that*, and schedule nothing:
    // `handleConnectivityChange` owns the resume. The streak still counted.
    if (!this.connectivity.isOnline()) {
      this.publishOffline();
      return;
    }

    this.publish({
      status:
        this.failureStreak >= ATTENTION_AFTER_CONSECUTIVE_FAILURES ? "attention" : "retrying",
      updatedReleaseId: this.state.updatedReleaseId,
      requiredAppVersion: null,
      failureCategory: category,
    });
    this.scheduleRetry();
  }

  /**
   * The one place `offline` is published, and it always clears `failureCategory`: "this device has no
   * network" is the whole explanation, and an earlier failure's category only describes a server that
   * is unreachable anyway.
   */
  private publishOffline(): void {
    this.publish({
      status: "offline",
      updatedReleaseId: this.state.updatedReleaseId,
      requiredAppVersion: null,
      failureCategory: null,
    });
  }

  private scheduleRetry(): void {
    const index = Math.min(this.failureStreak, BACKOFF_DELAYS_MS.length) - 1;

    this.cancelPendingRetry = this.timer.after(BACKOFF_DELAYS_MS[index], () => {
      this.cancelPendingRetry = null;
      if (this.disposed) return;
      this.attempt();
    });
  }

  private cancelTimer(): void {
    if (this.cancelPendingRetry) {
      this.cancelPendingRetry();
      this.cancelPendingRetry = null;
    }
  }

  private publish(state: CourseSyncSchedulerState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
