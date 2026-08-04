import { ProgressRemoteError, type ProgressRemoteErrorKind } from "./progress-remote";
import type { SyncResult } from "./progress-sync-engine";

/**
 * What the UI can render about background sync, without ever describing a state that would justify
 * blocking or delaying local learning.
 *
 * - `"offline"` — nothing is syncing right now: either no authenticated session is active, or the
 *   most recent attempt failed once and a retry is already scheduled.
 * - `"idle"` — authenticated and caught up; the last pass, if any, succeeded.
 * - `"syncing"` — a pass is currently running.
 * - `"attention"` — failure has repeated, the session itself needs the learner's attention
 *   (expired/invalid), or a pass otherwise succeeded but left a mutation the server keeps refusing
 *   ({@link SyncResult.blocked}). Never blocking: it is a signal to surface non-intrusively, not an
 *   error page.
 */
export type SyncStatus = "offline" | "idle" | "syncing" | "attention";

export type SyncSchedulerState = {
  status: SyncStatus;
  /**
   * The last known count of outbox mutations still queued. Carried through a failure rather than
   * reset, so `attention` never has to guess whether "something's wrong" also means "and now we don't
   * know how much is unsynced" — see `ProgressSyncEngine`'s own `SyncResult.pending`.
   */
  pending: number;
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
 * Bounded exponential backoff between automatic retries after a failed pass: doubling from 2s up to
 * a 60s ceiling. Reset to the first step by any successful pass — see {@link SyncScheduler.setSession}
 * and the success branch of {@link SyncScheduler.attempt}.
 */
export const BACKOFF_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 32_000, 60_000];

/**
 * How many consecutive automatic failures escalate the non-blocking state from `"offline"` (a single
 * blip, expected to clear itself on the next scheduled retry) to `"attention"` (worth a learner's
 * notice, even though nothing is blocked).
 */
const ATTENTION_AFTER_CONSECUTIVE_FAILURES = 2;

const INITIAL_STATE: SyncSchedulerState = { status: "offline", pending: 0, errorKind: null };

/**
 * Decides *when* {@link SyncEngineLike.sync} runs and what the UI should show about it. The engine
 * itself is deterministic and already dedupes concurrent callers (see `ProgressSyncEngine.sync`);
 * everything here is about the schedule around it — startup, foreground return, local writes, manual
 * retry, and the backoff that follows a failure — never about the sync algorithm itself.
 *
 * Every external event arrives through one of four methods, so the whole schedule can be driven and
 * observed by a test without touching a clock, `AppState`, or Supabase's own auth listener; turning
 * those real triggers into these calls is `src/context/sync-context.tsx`'s job, not this class's.
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

  constructor(
    private readonly engine: SyncEngineLike,
    private readonly timer: SyncSchedulerTimer = REAL_TIMER,
  ) {}

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
      this.publish({ status: "offline", pending: 0, errorKind: null });
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
    this.listeners.clear();
  }

  private attempt(): void {
    const session = this.session;
    if (session === null) return;

    this.cancelTimer();
    this.syncing = true;
    this.authPaused = false;
    // A pass starting now supersedes any queued follow-up: it will read the outbox afresh anyway.
    this.followUpRequested = false;
    const generation = this.generation;
    this.publish({ ...this.state, status: "syncing" });

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
          this.publish({ status: "attention", pending: result.pending, errorKind: "rejected" });
        } else {
          this.publish({ status: "idle", pending: result.pending, errorKind: null });
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
      this.publish({ status: "attention", pending: this.state.pending, errorKind: "auth" });
      return;
    }

    this.failureStreak += 1;
    const status: SyncStatus =
      this.failureStreak >= ATTENTION_AFTER_CONSECUTIVE_FAILURES ? "attention" : "offline";
    this.publish({ status, pending: this.state.pending, errorKind: kind });
    this.scheduleRetry();
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
