import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProgressMutation } from "../progress/progress-repository";
import {
  ProgressRemoteError,
  type ProgressRemote,
  type RemoteMutationResult,
  type RemoteProgressChange,
} from "./progress-remote";

type SupabaseErrorLike = { message: string; code: string };

type SupabaseQueryResponse<T> = {
  data: T | null;
  error: SupabaseErrorLike | null;
  status: number;
};

type ApplyMutationRow = {
  applied: unknown;
  conflict: unknown;
  completed: unknown;
  revision: unknown;
  change_id: unknown;
};

type ProgressChangeRow = {
  lesson_id: unknown;
  completed: unknown;
  revision: unknown;
  change_id: unknown;
};

/**
 * The slice of Supabase's client this adapter actually uses, narrowed to the exact `.rpc()` and
 * `.from().select().gt().order().limit()` calls made below.
 *
 * Narrowed on purpose, same as {@link ../auth/supabase-auth-service.SupabaseAuthLike}: the real client
 * satisfies it structurally, tests can supply a plain object instead of impersonating PostgREST
 * internals, and the compiler still catches drift if a call site here stops matching the real shape.
 */
export type SupabaseProgressClientLike = {
  rpc(
    fn: "apply_progress_mutation",
    args: {
      p_mutation_id: string;
      p_lesson_id: string;
      p_completed: boolean;
      p_base_revision: number;
    },
  ): PromiseLike<SupabaseQueryResponse<ApplyMutationRow[]>>;
  from(table: "lesson_progress"): {
    select(columns: string): {
      gt(
        column: string,
        value: number,
      ): {
        order(
          column: string,
          options: { ascending: boolean },
        ): {
          limit(count: number): PromiseLike<SupabaseQueryResponse<ProgressChangeRow[]>>;
        };
      };
    };
  };
};

/** One page of `pullAfter`'s underlying request. Kept well under PostgREST's own row cap. */
export const PULL_PAGE_SIZE = 200;

const PROGRESS_COLUMNS = "lesson_id, completed, revision, change_id";

/**
 * Classifies a PostgREST/Supabase error into what the sync engine needs to react correctly:
 * retry transport failures, pause on an expired/invalid session, or give up on a permanent
 * rejection. See {@link ProgressRemoteError} for what each category means to callers.
 */
function classifyError(error: SupabaseErrorLike, status: number): ProgressRemoteError {
  // status 0 is how the client reports a request that never got a response at all (offline, DNS
  // failure, aborted) — see @supabase/postgrest-js's PostgrestBuilder. 5xx means the server itself
  // failed to produce a considered response. Both are worth retrying, never worth giving up on.
  if (status === 0 || status >= 500) {
    return new ProgressRemoteError(
      "transport",
      error.message || "The request to Supabase failed before a response was received.",
    );
  }

  // 401 is PostgREST's status for a missing/invalid/expired JWT (commonly code "PGRST301"). "28000"
  // is what this project's own RPC raises when auth.uid() resolves to nothing.
  if (status === 401 || error.code === "PGRST301" || error.code === "28000") {
    return new ProgressRemoteError("auth", error.message || "Supabase rejected the caller's session.");
  }

  return new ProgressRemoteError("rejected", error.message || "Supabase rejected the request.");
}

function requireBoolean(value: unknown, field: string, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new ProgressRemoteError(
      "rejected",
      `${context}: expected boolean "${field}", got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function requireInteger(value: unknown, field: string, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ProgressRemoteError(
      "rejected",
      `${context}: expected integer "${field}", got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ProgressRemoteError(
      "rejected",
      `${context}: expected non-empty string "${field}", got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

function toMutationResult(row: ApplyMutationRow): RemoteMutationResult {
  const context = "apply_progress_mutation";
  const completed = requireBoolean(row.completed, "completed", context);
  const revision = requireInteger(row.revision, "revision", context);
  const changeId = requireInteger(row.change_id, "change_id", context);
  const applied = requireBoolean(row.applied, "applied", context);
  const conflict = requireBoolean(row.conflict, "conflict", context);

  if (applied === conflict) {
    throw new ProgressRemoteError(
      "rejected",
      `${context}: expected exactly one of "applied"/"conflict" to be true, got applied=${applied} conflict=${conflict}.`,
    );
  }

  return { kind: applied ? "applied" : "conflict", completed, revision, changeId };
}

function toProgressChange(row: ProgressChangeRow): RemoteProgressChange {
  const context = "lesson_progress pull";
  const lessonId = requireNonEmptyString(row.lesson_id, "lesson_id", context);
  const completed = requireBoolean(row.completed, "completed", context);
  const revision = requireInteger(row.revision, "revision", context);
  const changeId = requireInteger(row.change_id, "change_id", context);
  return { lessonId, completed, revision, changeId };
}

/**
 * Adapts the sync engine's remote protocol onto Supabase: one RPC call per mutation, and a
 * cursor-ordered table read for pulls. See {@link ProgressRemote} for what this layer is and is not
 * responsible for.
 */
export class SupabaseProgressRemote implements ProgressRemote {
  constructor(private readonly client: SupabaseProgressClientLike) {}

  async applyMutation(mutation: ProgressMutation): Promise<RemoteMutationResult> {
    const { data, error, status } = await this.client.rpc("apply_progress_mutation", {
      p_mutation_id: mutation.mutationId,
      p_lesson_id: mutation.lessonId,
      p_completed: mutation.completed,
      p_base_revision: mutation.baseRevision,
    });

    if (error) throw classifyError(error, status);

    if (!Array.isArray(data) || data.length !== 1) {
      const count = Array.isArray(data) ? data.length : "a non-array response";
      throw new ProgressRemoteError(
        "rejected",
        `apply_progress_mutation returned ${count}; expected exactly 1 row.`,
      );
    }

    return toMutationResult(data[0]);
  }

  async pullAfter(changeId: number, limit: number): Promise<RemoteProgressChange[]> {
    const results: RemoteProgressChange[] = [];
    let cursor = changeId;

    while (results.length < limit) {
      const pageSize = Math.min(PULL_PAGE_SIZE, limit - results.length);
      const { data, error, status } = await this.client
        .from("lesson_progress")
        .select(PROGRESS_COLUMNS)
        .gt("change_id", cursor)
        .order("change_id", { ascending: true })
        .limit(pageSize);

      if (error) throw classifyError(error, status);

      if (!Array.isArray(data)) {
        throw new ProgressRemoteError("rejected", "lesson_progress pull returned a non-array response.");
      }

      if (data.length === 0) break;

      // Parsed one row at a time and appended immediately, rather than mapped and appended in bulk,
      // so a malformed row later in the page throws before any row past it is trusted — but note the
      // whole call still rejects, so nothing already pushed here is ever handed back to the caller
      // either. The cursor this method's caller holds is only ever advanced from a value it returned.
      for (const row of data) {
        results.push(toProgressChange(row));
      }

      cursor = results[results.length - 1].changeId;

      if (data.length < pageSize) break;
    }

    return results;
  }
}

/**
 * Builds the adapter from a real client.
 *
 * This exists as much for the type check as for convenience: it is the one place the compiler
 * confirms a real Supabase client still satisfies {@link SupabaseProgressClientLike}. Without it the
 * narrow type could drift from the library and only fail at runtime.
 */
export function createSupabaseProgressRemote(client: SupabaseClient): SupabaseProgressRemote {
  return new SupabaseProgressRemote(client);
}
