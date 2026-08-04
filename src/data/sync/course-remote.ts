import type { CourseRelease } from "../course/types";

/**
 * The active release's identity and compatibility metadata, without its (potentially large) nested
 * payload. Mirrors `get_active_course_manifest()`'s row shape
 * (supabase/migrations/202608030002_curriculum_releases.sql) but in the app's camelCase convention —
 * see {@link SupabaseCourseRemote} for the snake_case -> camelCase mapping.
 */
export type CourseReleaseManifest = {
  id: string;
  schemaVersion: number;
  minimumAppVersion: string;
  checksum: string;
  publishedAt: string;
};

/**
 * The remote protocol the app speaks to discover and download published curriculum releases.
 *
 * Deliberately thin, matching {@link ../progress/progress-remote.ProgressRemote}: this layer only
 * calls the two public read RPCs and validates their shape. It decides nothing about whether a
 * release should be activated, whether its checksum matches the downloaded payload, or how it gets
 * installed into the on-device database — that belongs to later tasks (4 and 5).
 */
export interface CourseRemote {
  /**
   * The manifest of whichever release is currently active, or `null` if none is. `null` is a valid,
   * expected outcome (e.g. a fresh project with nothing published yet) — it is not an error and must
   * not be confused with a malformed response, which throws instead.
   */
  getActiveManifest(): Promise<CourseReleaseManifest | null>;
  /**
   * The full validated payload for one published release id. Rejects if the id names no published
   * release, or if the response does not validate against `parseCourseRelease` — both are protocol
   * failures, not a valid "not found" result, because every caller of this method already learned the
   * id from a manifest that claimed the release exists.
   */
  getRelease(releaseId: string): Promise<CourseRelease>;
}
