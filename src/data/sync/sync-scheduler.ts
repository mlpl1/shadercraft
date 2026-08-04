import { ProgressRemoteError, type ProgressRemoteErrorKind } from "./progress-remote";
import type { SyncResult } from "./progress-sync-engine";

/**
 * What the UI can render about background sync, without ever describing a state that would justify
 * blocking or delaying local learning. Five distinct situations, because a learner acts differently in
 * each and one name for several of them is what made a working sync look broken:
 *
 * - `"signed-out"` — no authenticated session is active. Nothing syncs, nothing is scheduled, and
 *   nothing is wrong: this is every local-only learner's normal state.
 * - `"offline"` — signed in, but the device reports no usable network. No pass is attempted and no
 *   retry is scheduled; the moment connectivity returns, one runs (see
 *   {@link SyncConnectivityMonitor}). Local changes keep queueing meanwhile.
 * - `"syncing"` — a pass is currently running.
 * - `"retrying"` — the most recent pass failed once with a network up, and an automatic retry is
 *   already waiting on the backoff ladder. Expected to clear itself.
 * - `"up-to-date"` — the last pass succeeded and left nothing the server refuses. Whether anything is
 *   still queued locally is a separate fact the UI reads from the outbox, not from here.
 * - `"attention"` — failure has repeated, the session itself needs the learner's attention
 *   (expired/invalid), or a pass otherwise succeeded but left a mutation the server keeps refusing
 *   ({@link SyncResult.blocked}). Never blocking: it is a signal to surface non-intrusively, not an
 *   error page.
 */
export type SyncStatus =
  | "signed-out"
  | "offline"
  | "syncing"
  | "retrying"
  | "up-to-date"
  | "attention";

export type SyncSchedulerState = {
  status: SyncStatus;
  /** The safe classification of the most recent failure. Cleared to `null` on the next success. */
  errorKind: ProgressRemoteErrorKind | null;
};

/**
 * Which learner profile syncs, and which Supabase account it belongs to.
 *
 * Carried as one value rather than two arguments because the pair is meaningless apart: a pass scoped
 * to a profile must send every request as that profile's own account, and the whole point of
 * `ProgressRemote`'s per-request identity check is that the two can never drift.
 */
export type SyncSession = {
  profileId: string;
  supabaseUserId: string;
};

/**
 * The one operation the scheduler drives, narrowed from `ProgressSyncEngine` to `sync()` so a test
 * double never has to impersonate the rest of it.
 */
export type SyncEngineLike = {
  sync(profileId: string, supabaseUserId: string): Promise<SyncResult>;
};

/**
 * `setTimeout`, injected rather than reached for at module scope, so a test can drive every backoff
 * step deterministically instead of waiting on it. Hands back a canceller rather than a raw timer
 * handle, so the scheduler never has to know whether it is holding a `setTimeout` id or something
 * else.
 */
export type SyncSchedulerTimer = {
  after(delayMs: number, callback: () => void): () => void;
};

const REAL_TIMER: SyncSchedulerTimer = {
  after(delayMs, callback) {
    const handle = setTimeout(callback, delayMs);
    return () => clearTimeout(handle);
  },
};

/**
 * The device's connectivity, injected for the same reason the timer is: the scheduler must stay free of
 * native modules, so a test drives outages directly and `src/context/sync-context.tsx` is the single
 * place that ever touches `expo-network`.
 *
 * `isOnline()` answers the scheduler's only question — "is there any point sending a request?" — and
 * must answer `true` whenever the platform is merely *unsure*. Unknown is not offline: a device whose
 * reachability cannot be determined has to be allowed to try and let the attempt decide, or it would
 * stop syncing altogether.
 */
export type SyncConnectivityMonitor = {
  isOnline(): boolean;
  /** Notified on every change, with the new value. Returns its own unsubscribe. */
  subscribe(listener: (online: boolean) => void): () => void;
};

/**
 * The default for anything that has no connectivity source: always try. Same principle as an unknown
 * `NetworkState` — the attempt itself, not an assumption, decides whether the network is there.
 */
const ALWAYS_ONLINE: SyncConnectivityMonitor = {
  isOnline: () => true,
  subscribe: () => () => {},
};

export type SyncSchedulerOptions = {
  timer?: SyncSchedulerTimer;
  connectivity?: SyncConnectivityMonitor;
};

/**
 * Bounded exponential backoff between automatic retries after a failed pass: doubling from 2s up to
 * a 60s ceiling. Reset to the first step by any successful pass — see {@link SyncScheduler.setSession}
 * and the success branch of {@link SyncScheduler.attempt}.
 */
export const BACKOFF_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];

/**
 * How many consecutive automatic failures escalate the non-blocking state from `"retrying"` (a single
 * blip, expected to clear itself on the next scheduled retry) to `"attention"` (worth a learner's
 * notice, even though nothing is blocked).
 */
const ATTENTION_AFTER_CONSECUTIVE_FAILURES = 2;

const INITIAL_STATE: SyncSchedulerState = { status: "signed-out", errorKind: null };

/**
 * Decides *when* {@link SyncEngineLike.sync} runs and what the UI should show about it. The engine
 * itself is deterministic and already dedupes concurrent callers (see `ProgressSyncEngine.sync`);
 * everything here is about the schedule around it — startup, foreground return, local writes, manual
 * retry, and the backoff that follows a failure — never about the sync algorithm itself.
 *
 * Every external event arrives through one of four methods or through the injected
 * {@link SyncConnectivityMonitor}, so the whole schedule can be driven and observed by a test without
 * touching a clock, `AppState`, `expo-network`, or Supabase's own auth listener; turning those real
 * triggers into these calls is `src/context/sync-context.tsx`'s job, not this class's.
 *
 * - {@link setSession} — the authenticated profile changed: signed in, switched accounts, a session
 *   refresh, or signed out. Carries the profile *and* the Supabase account it belongs to, since every
 *   pass is scoped to both. The only method that runs while anonymous, and even then only to *stop*:
 *   passing `null` cancels any pending retry and leaves the scheduler idle without ever attempting.
 * - {@link notifyAppForeground} — the app returned to the foreground.
 * - {@link retry} — an explicit, learner-initiated retry. The only trigger that is *queued* rather
 *   than dropped when a pass is already in flight, since a person asked for it and handing them the
 *   pass already running would look like the control did nothing.
 * - {@link notifyLocalMutation} — a local write just queued a fresh outbox mutation.
 *
 * Connectivity is the fifth trigger, and the only one that is not a method: losing the network stops
 * the schedule and says so, and regaining it attempts at once. Nothing is *ever* attempted while the
 * device reports itself offline — every request would fail on the first byte, and spending backoff steps
 * on that is what left a device sitting out a 60s wait long after the network was back.
 *
 * `setSession`, `notifyAppForeground`, and `retry` all attempt immediately, cancelling any pending
 * backoff wait first: each is either the start of a session or something a person or the OS just did,
 * and making any of them wait out a schedule meant for unattended retries would feel broken (and, for
 * `setSession`, would leave a session that just came back from an auth pause with no way to resume
 * other than a totally unrelated trigger). `notifyLocalMutation` is the one soft trigger — it only
 * attempts when the scheduler is otherwise idle, so completing a lesson never turns into a retry storm
 * during a backoff wait or an auth pause; the mutation still gets pushed by whichever attempt runs next.
 */
export class SyncScheduler {
  private state: SyncSchedulerState = INITIAL_STATE;
  private readonly listeners = new Set<(state: SyncSchedulerState) => void>();
  private session: SyncSession | null = null;
  /**
   * Bumped on every {@link setSession} call, so a pass started for a since-abandoned (or merely
   * superseded) session can never write its outcome into a different one's state — see the "ignores a
   * stale result" test.
   */
  private generation = 0;
  private failureStreak = 0;
  private syncing = false;
  /**
   * True after an `auth` failure until the next attempt. Blocks the soft `notifyLocalMutation`
   * trigger from repeatedly retrying a session already known to be bad; `setSession`,
   * `notifyAppForeground`, and `retry` are explicit enough to be allowed to try anyway.
   */
  private authPaused = false;
  /**
   * Set when {@link retry} arrived while a pass was already in flight. `ProgressSyncEngine.sync` hands
   * a concurrent caller the pass already running rather than starting a second one, so without this
   * the retry would resolve into that pass and do nothing — and the pass may well have read the outbox
   * before whatever the learner is retrying for. Cleared by the follow-up itself, by any fresh
   * attempt, and by a session change.
   */
  private followUpRequested = false;
  private cancelPendingRetry: (() => void) | null = null;
  private disposed = false;
  private readonly timer: SyncSchedulerTimer;
  private readonly connectivity: SyncConnectivityMonitor;
  private readonly unsubscribeConnectivity: () => void;

  constructor(
    private readonly engine: SyncEngineLike,
    options: SyncSchedulerOptions = {},
  ) {
    this.timer = options.timer ?? REAL_TIMER;
    this.connectivity = options.connectivity ?? ALWAYS_ONLINE;
    this.unsubscribeConnectivity = this.connectivity.subscribe((online) => {
      this.handleConnectivityChange(online);
    });
  }

  getState(): SyncSchedulerState {
    return this.state;
  }

  subscribe(listener: (state: SyncSchedulerState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setSession(session: SyncSession | null): void {
    if (this.disposed) return;

    this.cancelTimer();
    this.generation += 1;
    this.session = session;
    // Not observable by itself (a stale attempt's callback is already discarded by the generation
    // check above), but kept in step so `syncing` stays true only while *this* generation is really
    // mid-attempt — an invariant worth holding even where nothing currently depends on it.
    this.syncing = false;
    this.failureStreak = 0;
    this.authPaused = false;
    this.followUpRequested = false;

    if (session === null) {
      this.publish({ status: "signed-out", errorKind: null });
      return;
    }

    this.attempt();
  }

  notifyAppForeground(): void {
    if (this.disposed || this.session === null) return;
    // `attempt()` itself cancels any pending backoff wait before it does anything else.
    this.attempt();
  }

  retry(): void {
    if (this.disposed || this.session === null) return;
    if (this.syncing) {
      // Cannot usefully start now (see {@link followUpRequested}); the earliest a *fresh* pass can
      // read the outbox again is when this one settles, so ask for one then.
      this.followUpRequested = true;
      return;
    }
    this.attempt();
  }

  notifyLocalMutation(): void {
    if (this.disposed || this.session === null) return;
    if (this.syncing || this.cancelPendingRetry || this.authPaused) return;
    this.attempt();
  }

  dispose(): void {
    this.disposed = true;
    this.followUpRequested = false;
    this.cancelTimer();
    this.unsubscribeConnectivity();
    this.listeners.clear();
  }

  /**
   * The network came or went.
   *
   * Losing it cancels the backoff wait — every step of that ladder would fire into the same wall — and
   * publishes `offline`, which is the true account of why nothing is moving. Regaining it attempts at
   * once, because the reason the wait existed has just gone away; waiting out the remainder is exactly
   * the delay a learner feels as "sync took ages to notice I was back".
   *
   * The failure streak is deliberately *not* reset here: only a successful pass earns that. A device
   * flapping between networks would otherwise sit on the ladder's first rung forever and never escalate.
   *
   * While an `auth` failure is holding the session paused, neither direction changes anything: a network
   * that came and went says nothing about a session the server has already refused, and replacing that
   * `attention` with `offline` would hide the one thing the learner has to act on.
   */
  private handleConnectivityChange(online: boolean): void {
    if (this.disposed || this.session === null || this.authPaused) return;

    if (!online) {
      this.cancelTimer();
      this.publishOffline();
      return;
    }

    // A pass already in flight will report its own outcome; starting a second one is what
    // `ProgressSyncEngine.sync` would only dedupe back into the first anyway.
    if (this.syncing) return;
    this.attempt();
  }

  private attempt(): void {
    const session = this.session;
    if (session === null) return;

    this.cancelTimer();
    if (!this.connectivity.isOnline()) {
      // Known-offline — not merely unsure, which counts as online (see `SyncConnectivityMonitor`).
      // Whatever asked for this pass stays true until the network is back, and `handleConnectivityChange`
      // runs it then; queued mutations are untouched either way.
      this.publishOffline();
      return;
    }

    this.syncing = true;
    this.authPaused = false;
    // A pass starting now supersedes any queued follow-up: it will read the outbox afresh anyway.
    this.followUpRequested = false;
    const generation = this.generation;
    this.publish({ status: "syncing", errorKind: this.state.errorKind });

    this.engine.sync(session.profileId, session.supabaseUserId).then(
      (result) => {
        if (generation !== this.generation) return;
        this.syncing = false;
        // The pass itself succeeded, so the backoff resets either way: whatever is wrong with a
        // blocked mutation, this device is reaching the server and everything else went through.
        this.failureStreak = 0;
        if (result.blocked > 0) {
          // Reported as `rejected` because that is what a blocked mutation means to the learner: the
          // server has considered it and will not take it, and no amount of waiting changes that.
          this.publish({ status: "attention", errorKind: "rejected" });
        } else {
          this.publish({ status: "up-to-date", errorKind: null });
        }
        this.runQueuedFollowUp();
      },
      (error: unknown) => {
        if (generation !== this.generation) return;
        this.syncing = false;
        this.handleFailure(error);
        this.runQueuedFollowUp();
      },
    );
  }

  /**
   * Runs the pass a {@link retry} asked for while the previous one was still in flight. Overrides
   * whatever {@link handleFailure} just decided — a backoff wait or an auth pause — because that is
   * exactly what an explicit retry is allowed to do.
   */
  private runQueuedFollowUp(): void {
    if (!this.followUpRequested || this.disposed || this.session === null) return;
    this.attempt();
  }

  private handleFailure(error: unknown): void {
    const kind = classify(error);

    if (kind === "auth") {
      // An expired/invalid session cannot be fixed by resending — retrying it blindly would just fail
      // again. The outbox is untouched (that guarantee lives in `ProgressSyncEngine`); the scheduler
      // simply stops scheduling and waits for whatever happens next: a fresh sign-in, a foreground
      // return, or a manual retry.
      this.authPaused = true;
      this.publish({ status: "attention", errorKind: "auth" });
      return;
    }

    this.failureStreak += 1;

    // The network went away under the pass. It failed for a reason that has nothing to say about the
    // server, so say *that* — and schedule nothing, because `handleConnectivityChange` owns the resume.
    // The streak still counted, so a flapping connection escalates rather than looping quietly.
    if (!this.connectivity.isOnline()) {
      this.publishOffline();
      return;
    }

    const status: SyncStatus =
      this.failureStreak >= ATTENTION_AFTER_CONSECUTIVE_FAILURES ? "attention" : "retrying";
    this.publish({ status, errorKind: kind });
    this.scheduleRetry();
  }

  /**
   * The one place `offline` is published, and it always clears `errorKind`: "this device has no network"
   * is the whole explanation, and an earlier failure's kind only describes a server that is now
   * unreachable anyway — showing "it will keep retrying automatically" underneath would be a lie.
   */
  private publishOffline(): void {
    this.publish({ status: "offline", errorKind: null });
  }

  private scheduleRetry(): void {
    const index = Math.min(this.failureStreak, BACKOFF_DELAYS_MS.length) - 1;
    const delay = BACKOFF_DELAYS_MS[index];
    const generation = this.generation;

    this.cancelPendingRetry = this.timer.after(delay, () => {
      this.cancelPendingRetry = null;
      if (this.disposed || generation !== this.generation) return;
      this.attempt();
    });
  }

  private cancelTimer(): void {
    if (this.cancelPendingRetry) {
      this.cancelPendingRetry();
      this.cancelPendingRetry = null;
    }
  }

  private publish(state: SyncSchedulerState): void {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

function classify(error: unknown): ProgressRemoteErrorKind {
  return error instanceof ProgressRemoteError ? error.kind : "transport";
}
