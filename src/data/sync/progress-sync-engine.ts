import type { ProgressMutation, ProgressSyncRepository } from "../progress/progress-repository";
import {
  ProgressRemoteError,
  type ProgressRemote,
  type RemoteMutationResult,
} from "./progress-remote";

/**
 * What one sync pass did. `pushed` counts mutations acknowledged; `pulled` counts remote changes
 * actually *applied* locally — a change skipped because a pending local mutation for the same lesson
 * outranks it, or because the row already holds that revision, is received but not counted here.
 * `pending` is how many mutations are still queued afterwards, which is the signal a caller uses to
 * show a non-blocking attention state; `lastCursor` is the durable pull cursor the next pass will
 * resume from.
 */
export type SyncResult = {
  pushed: number;
  pulled: number;
  pending: number;
  lastCursor: number;
};

/**
 * How many remote changes one pull request asks for, and therefore how many are applied per local
 * transaction. Matches `supabase-progress-remote`'s own page size so one batch is one request.
 */
export const DEFAULT_PULL_BATCH_SIZE = 200;

/**
 * How many times one mutation may be rebased and resent inside a single pass before the pass gives
 * up on it. Reaching this bound means another device is writing the same lesson faster than this one
 * can answer; the row is kept, rebased onto the newest revision the server reported, and retried by
 * the next pass.
 */
export const MAX_CONFLICTS_PER_MUTATION = 3;

export type ProgressSyncEngineOptions = {
  /** Overridable mainly so tests can exercise multi-batch pulls; defaults to {@link DEFAULT_PULL_BATCH_SIZE}. */
  pullBatchSize?: number;
};

type PullOutcome = {
  /** Remote changes actually applied — see {@link SyncResult}. */
  pulled: number;
  /**
   * Remote changes received across every batch this pass, applied or not. Used only to decide
   * whether {@link ProgressSyncEngine.runOnce} needs to record a successful pass itself, because an
   * empty batch never reaches `applyRemoteChanges` (which would otherwise record it).
   */
  received: number;
  cursor: number;
};

/**
 * Reconciles one learner profile's local progress with the server, exactly once per call.
 *
 * The whole algorithm is three ordered phases, and the order is the design:
 *
 * 1. **Push, in creation order.** Every queued mutation is sent before anything is pulled, so a
 *    device can never overwrite its own pending state with an older server snapshot. Each mutation
 *    carries a stable ID, which is what makes a resend after an ambiguous failure idempotent rather
 *    than duplicating an action.
 * 2. **Rebase on conflict.** A conflict is the server saying "your base revision is stale" and
 *    handing back its current state. The engine repoints the *same* mutation at that revision and
 *    resends it, so the local action is accepted next and becomes authoritative — "most recently
 *    server-accepted explicit action wins", decided by server revisions alone, never by comparing
 *    device clocks. Accepting a mutation also rebases the lesson's later queued actions onto the
 *    revision it produced, so a device's own actions replay in order without conflicting.
 * 3. **Pull from a durable cursor.** Changes newer than the stored cursor are applied one batch at a
 *    time, each batch committing its rows and its new cursor together.
 *
 * Two rules hold across all of it. An outbox row is deleted only once the server has acknowledged
 * it, because progress and outbox rows are not reconstructible from anything else. And a failure
 * from the remote propagates to the caller unchanged, so the scheduler above can tell an expired
 * session (pause) from a transport failure (retry) — the outbox survives either way.
 */
export class ProgressSyncEngine {
  private readonly pullBatchSize: number;
  private readonly runs = new Map<string, Promise<SyncResult>>();

  constructor(
    private readonly remote: ProgressRemote,
    private readonly repository: ProgressSyncRepository,
    options: ProgressSyncEngineOptions = {},
  ) {
    this.pullBatchSize = options.pullBatchSize ?? DEFAULT_PULL_BATCH_SIZE;
  }

  /**
   * Runs one pass for `profileId`. Concurrent callers get the pass already in flight rather than a
   * second one, since two passes would send the same mutations and race over the same cursor.
   *
   * Not `async`, so the in-flight entry is registered before the caller can interleave.
   *
   * This guard is per `ProgressSyncEngine` instance: it assumes exactly one engine instance ever runs
   * against a given profile at a time, which is the app's current shape (one engine, one process).
   * Two engine instances over the same profile — e.g. two processes, or a future background-task
   * engine alongside the foreground one — would each believe they had exclusivity and could both
   * push at once.
   */
  sync(profileId: string): Promise<SyncResult> {
    const inFlight = this.runs.get(profileId);
    if (inFlight) {
      return inFlight;
    }

    const run = this.runOnce(profileId).finally(() => {
      this.runs.delete(profileId);
    });
    this.runs.set(profileId, run);
    return run;
  }

  private async runOnce(profileId: string): Promise<SyncResult> {
    const pushed = await this.push(profileId);
    const pull = await this.pull(profileId);

    // `applyRemoteChanges` stamps a successful pass's timestamp itself, but only runs when a batch is
    // non-empty. A pass that pushed something yet received nothing to pull (an idle server) would
    // otherwise record no success at all, even though real work happened. A genuinely idle pass —
    // nothing queued, nothing received — deliberately still writes nothing, so a profile that has
    // never done anything does not get a `sync_state` row just for asking.
    if (pushed > 0 && pull.received === 0) {
      await this.repository.recordSyncSuccess(profileId, pull.cursor);
    }

    const pending = await this.repository.getPendingMutations(profileId);

    return {
      pushed,
      pulled: pull.pulled,
      pending: pending.length,
      lastCursor: pull.cursor,
    };
  }

  /**
   * Sends every queued mutation, in creation order, and returns how many were accepted. A mutation
   * that exhausts {@link MAX_CONFLICTS_PER_MUTATION} is abandoned *on its own* — the loop moves on to
   * the next queued mutation rather than returning, because lessons are independent: another device
   * fighting over one lesson says nothing about lessons nobody else is touching, and must not stall
   * their uploads or the pull that follows. The abandoned row is kept, rebased onto the newest
   * revision the server reported, and picked up again by the next pass.
   */
  private async push(profileId: string): Promise<number> {
    const mutations = await this.repository.getPendingMutations(profileId);
    /** The newest revision this pass has had accepted per lesson, i.e. the next mutation's base. */
    const acceptedRevisions = new Map<string, number>();
    let pushed = 0;

    for (const mutation of mutations) {
      let baseRevision = acceptedRevisions.get(mutation.lessonId) ?? mutation.baseRevision;
      if (baseRevision !== mutation.baseRevision) {
        await this.repository.rebaseMutation(profileId, mutation.mutationId, baseRevision);
      }

      let conflicts = 0;
      for (;;) {
        const result = await this.applyMutation(profileId, { ...mutation, baseRevision });

        if (result.kind === "applied") {
          await this.repository.acknowledgeMutation(profileId, mutation.mutationId, result);
          acceptedRevisions.set(mutation.lessonId, result.revision);
          pushed += 1;
          break;
        }

        conflicts += 1;
        baseRevision = result.revision;
        // Persisted even on the final attempt, so the next pass starts from the newest revision the
        // server reported rather than replaying a base already known to be stale.
        await this.repository.rebaseMutation(profileId, mutation.mutationId, baseRevision);

        if (conflicts >= MAX_CONFLICTS_PER_MUTATION) {
          await this.repository.recordMutationFailure(
            profileId,
            mutation.mutationId,
            `Gave up after ${conflicts} revision conflicts in one sync pass.`,
          );
          break;
        }
      }
    }

    return pushed;
  }

  /**
   * Sends one mutation, counting a failed delivery against it before letting the error through.
   *
   * An `auth` failure is excluded on purpose: an expired session says nothing about the mutation, so
   * pausing must leave the row untouched rather than inflating its attempt count on every retry.
   */
  private async applyMutation(
    profileId: string,
    mutation: ProgressMutation,
  ): Promise<RemoteMutationResult> {
    try {
      return await this.remote.applyMutation(mutation);
    } catch (error) {
      if (!(error instanceof ProgressRemoteError) || error.kind !== "auth") {
        await this.repository.recordMutationFailure(
          profileId,
          mutation.mutationId,
          error instanceof Error ? error.message : String(error),
        );
      }
      throw error;
    }
  }

  private async pull(profileId: string): Promise<PullOutcome> {
    let cursor = await this.repository.getPullCursor(profileId);
    let pulled = 0;
    let received = 0;

    for (;;) {
      const changes = await this.remote.pullAfter(cursor, this.pullBatchSize);
      if (changes.length === 0) {
        break;
      }
      received += changes.length;

      // The maximum, not the last element: trusting the batch to arrive in ascending order would
      // silently misbehave against a reordered or misbehaving response instead of failing the guard
      // below.
      const nextCursor = changes.reduce((max, change) => Math.max(max, change.changeId), cursor);
      // The protocol only ever returns changes after the cursor. Trusting that blindly would turn a
      // misbehaving server into an endless loop of identical batches.
      if (nextCursor <= cursor) {
        throw new ProgressRemoteError(
          "rejected",
          `A pull after change ${cursor} returned change ${nextCursor}, which would not advance the cursor.`,
        );
      }

      pulled += await this.repository.applyRemoteChanges(profileId, changes, nextCursor);
      cursor = nextCursor;

      // A short batch means the server has nothing left; another request would be wasted.
      if (changes.length < this.pullBatchSize) {
        break;
      }
    }

    return { pulled, received, cursor };
  }
}
