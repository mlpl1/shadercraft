import type { SupabaseClient } from "@supabase/supabase-js";

import { parseCourseRelease } from "../course/schema";
import type { CourseRelease } from "../course/types";
import type { CourseRemote, CourseReleaseManifest } from "./course-remote";

type SupabaseErrorLike = { message: string; code: string };

type SupabaseQueryResponse<T> = {
  data: T | null;
  error: SupabaseErrorLike | null;
  status: number;
};

type ManifestRow = {
  id: unknown;
  schema_version: unknown;
  minimum_app_version: unknown;
  checksum: unknown;
  published_at: unknown;
};

/** Same rule the database enforces (`content_releases.checksum` check constraint): 64 lowercase hex. */
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

/** Same format `parseCourseRelease` (src/data/course/schema.ts) requires of `minimumAppVersion`. */
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/**
 * The slice of Supabase's client this adapter actually uses, narrowed to the two read RPCs defined
 * in supabase/migrations/202608030002_curriculum_releases.sql. Same narrowing rationale as
 * {@link ../supabase-progress-remote.SupabaseProgressClientLike}: a real client satisfies this
 * structurally, and tests can supply a plain object instead of impersonating PostgREST internals.
 */
export type SupabaseCourseClientLike = {
  rpc(
    fn: "get_active_course_manifest",
    args: Record<string, never>,
  ): PromiseLike<SupabaseQueryResponse<ManifestRow[]>>;
  rpc(
    fn: "get_course_release",
    args: { p_release_id: string },
  ): PromiseLike<SupabaseQueryResponse<unknown>>;
};

/**
 * Turns a Supabase/PostgREST error into a thrown `Error` carrying its message.
 *
 * Unlike {@link ../supabase-progress-remote.SupabaseProgressRemote}, this adapter has no retry
 * policy or auth-scoped identity of its own to protect: both RPCs it calls are readable by `anon`
 * (see the migration's grants), so there is no "auth" failure mode distinct from any other rejection,
 * and no caller here needs to distinguish transport/auth/rejected the way progress sync's retry loop
 * does. Callers of `CourseRemote` (Tasks 4/5) treat any thrown error the same way: keep the previous
 * active SQLite release and try again later.
 */
function reportSupabaseError(error: SupabaseErrorLike): never {
  throw new Error(error.message || "Supabase rejected the request.");
}

function requireInteger(value: unknown, field: string, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${context}: expected integer "${field}", got ${JSON.stringify(value)}.`);
  }
  return value;
}

function requireNonEmptyString(value: unknown, field: string, context: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context}: expected non-empty string "${field}", got ${JSON.stringify(value)}.`);
  }
  return value;
}

function toManifest(row: ManifestRow): CourseReleaseManifest {
  const context = "get_active_course_manifest";
  const id = requireNonEmptyString(row.id, "id", context);
  const schemaVersion = requireInteger(row.schema_version, "schema_version", context);
  const minimumAppVersion = requireNonEmptyString(row.minimum_app_version, "minimum_app_version", context);
  const checksum = requireNonEmptyString(row.checksum, "checksum", context);
  const publishedAt = requireNonEmptyString(row.published_at, "published_at", context);

  if (!CHECKSUM_PATTERN.test(checksum)) {
    throw new Error(`${context}: checksum is not 64 lowercase hex characters, got ${JSON.stringify(checksum)}.`);
  }
  if (!APP_VERSION_PATTERN.test(minimumAppVersion)) {
    throw new Error(
      `${context}: minimum_app_version is not in x.y.z form, got ${JSON.stringify(minimumAppVersion)}.`,
    );
  }

  return { id, schemaVersion, minimumAppVersion, checksum, publishedAt };
}

/**
 * Adapts the read side of curriculum publishing onto Supabase's two public RPCs. See
 * {@link CourseRemote} for what this layer is and is not responsible for — in particular, it never
 * decides whether to activate anything; it only fetches and validates.
 */
export class SupabaseCourseRemote implements CourseRemote {
  constructor(private readonly client: SupabaseCourseClientLike) {}

  async getActiveManifest(): Promise<CourseReleaseManifest | null> {
    const { data, error, status } = await this.client.rpc("get_active_course_manifest", {});

    if (error) reportSupabaseError(error);
    void status;

    if (!Array.isArray(data)) {
      throw new Error("get_active_course_manifest returned a non-array response.");
    }

    // Zero rows is the one case the brief calls a valid, expected outcome (see CourseRemote's
    // getActiveManifest doc) — nothing published yet, or nothing currently active. Anything else that
    // does not resolve to exactly one well-formed row is a protocol failure, not coerced to null.
    if (data.length === 0) {
      return null;
    }
    if (data.length > 1) {
      throw new Error(
        `get_active_course_manifest returned ${data.length} rows; the partial unique index on ` +
          `content_releases.active guarantees at most 1.`,
      );
    }

    return toManifest(data[0]);
  }

  async getRelease(releaseId: string): Promise<CourseRelease> {
    const { data, error } = await this.client.rpc("get_course_release", { p_release_id: releaseId });

    if (error) reportSupabaseError(error);

    // `get_course_release` returns SQL NULL (received here as `null`) when no release with this id
    // exists — the migration's own comment notes there is no distinct "not found" vs. "not published"
    // case, because every row in these tables is published by construction. Every caller of
    // `getRelease` already learned this id from a manifest that claimed the release exists, so a
    // missing payload here means the two RPCs disagree about the world: a protocol failure, not a
    // valid empty result the way `getActiveManifest`'s zero rows are.
    if (data === null || data === undefined) {
      throw new Error(`get_course_release returned no payload for release id ${JSON.stringify(releaseId)}.`);
    }

    return parseCourseRelease(data);
  }
}

/**
 * Builds the adapter from a real client.
 *
 * Exists as much for the type check as for convenience — the one place the compiler confirms a real
 * Supabase client still satisfies {@link SupabaseCourseClientLike} — same rationale as
 * {@link ../supabase-progress-remote.createSupabaseProgressRemote}.
 */
export function createSupabaseCourseRemote(client: SupabaseClient): SupabaseCourseRemote {
  return new SupabaseCourseRemote(client);
}
