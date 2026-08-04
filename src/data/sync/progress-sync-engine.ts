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
  /**
   * How many of `pending` have failed often enough ({@link MAX_MUTATION_ATTEMPTS}) that they are no
   * longer expected to succeed on their own. Nothing is blocked by them — the rest of the queue is
   * pushed and the pull still runs — but a caller should surface a non-blocking attention state
   * rather than reporting a clean idle sync while a mutation is stuck.
   */
  blocked: number;
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

/**
 * How many recorded failures ({@link ProgressMutation.attempts}, which is durable) make one mutation
 * worth the learner's attention rather than silent patience.
 *
 * Reaching it does *not* drop the mutation or stop the queue: the row is kept and still offered to the
 * server once per pass, because the causes of a permanent rejection include ones a later deployment
 * fixes (a `lesson_progress` migration that is not live yet answers every push with a PostgREST 404)
 * and abandoning the row outright would strand the learner's action with no way back. What the bound
 * changes is only the reported state: {@link SyncResult.blocked} becomes non-zero, and the scheduler
 * surfaces `attention` instead of a clean `idle`.
 */
export const MAX_MUTATION_ATTEMPTS = 5;

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
 * Three rules hold across all of it. An outbox row is deleted only once the server has acknowledged
 * it, because progress and outbox rows are not reconstructible from anything else. A `transport` or
 * `auth` failure from the remote propagates to the caller unchanged, so the scheduler above can tell
 * an expired session (pause) from a transport failure (retry) — the outbox survives either way. And
 * every pass is bound to *both* the local profile and the Supabase account that profile belongs to:
 * the account travels with every request so a session that changes mid-pass is refused rather than
 * silently written to (see {@link ProgressRemote}).
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
   * Runs one pass for `profileId`, acting as the Supabase account `supabaseUserId` — the account that
   * profile is bound to. Every request the pass makes carries that identity, so the remote can refuse
   * to send it under a session that has since become someone else's; nothing here assumes the session
   * that started the pass is still current when a later request goes out.
   *
   * Concurrent callers get the pass already in flight rather than a second one, since two passes would
   * send the same mutations and race over the same cursor. Keyed by profile alone, because a profile
   * belongs to exactly one Supabase account for its whole life.
   *
   * Not `async`, so the in-flight entry is registered before the caller can interleave.
   *
   * This guard is per `ProgressSyncEngine` instance: it assumes exactly one engine instance ever runs
   * against a given profile at a time, which is the app's current shape (one engine, one process).
   * Two engine instances over the same profile — e.g. two processes, or a future background-task
   * engine alongside the foreground one — would each believe they had exclusivity and could both
   * push at once.
   */
  sync(profileId: string, supabaseUserId: string): Promise<SyncResult> {
    const inFlight = this.runs.get(profileId);
    if (inFlight) {
      return inFlight;
    }

    const run = this.runOnce(profileId, supabaseUserId).finally(() => {
      this.runs.delete(profileId);
    });
    this.runs.set(profileId, run);
    return run;
  }

  private async runOnce(profileId: string, supabaseUserId: string): Promise<SyncResult> {
    const pushed = await this.push(profileId, supabaseUserId);
    const pull = await this.pull(profileId, supabaseUserId);

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
      // Read from the durable attempt counter rather than tracked across the pass, so a mutation that
      // has been failing since long before this pass — across relaunches included — is still reported.
      blocked: pending.filter((mutation) => mutation.attempts >= MAX_MUTATION_ATTEMPTS).length,
      lastCursor: pull.cursor,
    };
  }

  /**
   * Sends every queued mutation, in creation order, and returns how many were accepted.
   *
   * Two per-mutation dead ends are handled the same way, and for the same reason: lessons are
   * independent, so one lesson going nowhere must not stall the uploads of lessons nobody else is
   * touching, nor the pull that follows — a device that stopped pulling would stop hearing from every
   * other device the learner owns.
   *
   * - A mutation that exhausts {@link MAX_CONFLICTS_PER_MUTATION} is abandoned on its own. The row is
   *   kept, rebased onto the newest revision the server reported, and picked up by the next pass.
   * - A `rejected` failure — the server considered the request and permanently refused it (a `42501`,
   *   a constraint refusal, a PostgREST 404 from an undeployed migration, a response that broke the
   *   protocol) — records the failure against the row and moves on. It is deliberately not raised to
   *   the caller, because "this one mutation cannot be sent" is not "this device cannot sync": raising
   *   it left every later mutation unsent and skipped the pull entirely, on every pass, forever.
   *
   * `transport` and `auth` still abort the whole pass, which is right: neither says anything about the
   * mutation, and both mean the *next* request would fail in exactly the same way.
   */
  private async push(profileId: string, supabaseUserId: string): Promise<number> {
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
        let result: RemoteMutationResult;
        try {
          result = await this.applyMutation(
            profileId,
            { ...mutation, baseRevision },
            supabaseUserId,
          );
        } catch (error) {
          if (error instanceof ProgressRemoteError && error.kind === "rejected") {
            // `applyMutation` has already counted the failure against the row, which is what
            // eventually surfaces it through `SyncResult.blocked`.
            break;
          }
          throw error;
        }

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
    supabaseUserId: string,
  ): Promise<RemoteMutationResult> {
    try {
      return await this.remote.applyMutation(mutation, supabaseUserId);
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

  private async pull(profileId: string, supabaseUserId: string): Promise<PullOutcome> {
    let cursor = await this.repository.getPullCursor(profileId);
    let pulled = 0;
    let received = 0;

    for (;;) {
      const changes = await this.remote.pullAfter(cursor, this.pullBatchSize, supabaseUserId);
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
