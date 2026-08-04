import type { ProgressMutation } from "../progress/progress-repository";

/**
 * The outcome of sending one mutation to the server.
 *
 * A conflict is not an error: it is the server saying "your base revision is stale", carrying its
 * current state so the engine can rebase and resend the same mutation ID. Only `ProgressRemoteError`
 * represents a genuine failure to complete the request.
 */
export type RemoteMutationResult =
  | { kind: "applied"; completed: boolean; revision: number; changeId: number }
  | { kind: "conflict"; completed: boolean; revision: number; changeId: number };

export type AppliedProgressResult = {
  completed: boolean;
  revision: number;
  changeId: number;
};

export type RemoteProgressChange = AppliedProgressResult & {
  lessonId: string;
};

/**
 * Why a {@link ProgressRemote} call failed to produce a normal result, distinguished because the sync
 * engine reacts differently to each:
 *
 * - `"transport"` — the request never reached a considered response (offline, DNS failure, 5xx).
 *   Retryable with backoff.
 * - `"auth"` — the server rejected the caller's session (expired or invalid). The engine should pause
 *   authenticated sync without touching the outbox, rather than retrying immediately.
 * - `"rejected"` — a permanent failure: the server actively refused the request for a reason that
 *   resending unchanged would not fix, or the response did not match the protocol this adapter
 *   expects.
 */
export type ProgressRemoteErrorKind = "transport" | "auth" | "rejected";

/**
 * Thrown by {@link ProgressRemote} methods for anything other than a normal applied/conflict outcome.
 * Carries only a classification and a safe message — no token material, no raw Supabase payload —
 * matching the precedent set by {@link ../auth/supabase-auth-service.SupabaseAuthService}.
 */
export class ProgressRemoteError extends Error {
  readonly kind: ProgressRemoteErrorKind;

  constructor(kind: ProgressRemoteErrorKind, message: string) {
    super(message);
    this.name = "ProgressRemoteError";
    this.kind = kind;
  }
}

/**
 * The remote protocol the sync engine (Task 5) speaks to move progress to and from Supabase.
 *
 * Deliberately thin: this layer translates one request to one response and back. It performs no
 * local writes, holds no retry policy, and does not decide what to do about a conflict or an
 * error — that ordering, rebasing, and backoff logic belongs to the engine.
 *
 * Every method takes the Supabase user the caller believes it is acting as, and an implementation
 * **must** confirm that against the identity its transport will really authenticate with *before*
 * each request, failing with an `auth` error on any mismatch. A sync pass is scoped to a local
 * learner profile and can outlive the session it started under: an account switch mid-pass would
 * otherwise send one account's mutations under another's JWT, which the server would happily accept
 * and attribute to the wrong user. Passing the identity per request rather than binding it at
 * construction is what lets that check see a switch that happened after the pass began.
 */
export interface ProgressRemote {
  /**
   * Sends one outbox mutation. Replaying an already-accepted `mutationId` returns its recorded
   * outcome. `supabaseUserId` is the account the mutation belongs to — see {@link ProgressRemote}.
   */
  applyMutation(
    mutation: ProgressMutation,
    supabaseUserId: string,
  ): Promise<RemoteMutationResult>;
  /**
   * Rows accepted after `changeId`, oldest first, capped at `limit`. Empty when the caller is caught
   * up. `supabaseUserId` is the account whose rows are being read — see {@link ProgressRemote}.
   */
  pullAfter(
    changeId: number,
    limit: number,
    supabaseUserId: string,
  ): Promise<RemoteProgressChange[]>;
}
