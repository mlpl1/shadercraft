import type { CourseRelease } from "./types";

/**
 * A course release, or the same shape with `checksum` not yet computed. Lets one canonicalizer
 * serve both the pre-checksum body (build/publish tooling, before the checksum exists) and the
 * final release (with `checksum` present), without a second near-duplicate type.
 */
export type ReleaseLike = Omit<CourseRelease, "checksum"> & { checksum?: string };

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortKeysDeep(child)]),
    );
  }
  return value;
}

/**
 * Deterministic JSON serialization of a course release: object keys are sorted recursively, so
 * authoring/insertion order never affects the output, while array order is preserved because it is
 * semantically meaningful (module/lesson/preset/section order is display order). This is the one
 * canonical form shared by the Node build/publish tooling and, in a later task, on-device Expo
 * Crypto verification — both sides must hash exactly the same bytes.
 */
export function canonicalizeRelease(release: ReleaseLike): string {
  return JSON.stringify(sortKeysDeep(release));
}

/**
 * The exact bytes a release's checksum is computed over: the canonical release with the `checksum`
 * field itself excluded, so a release's checksum never depends on itself. Exported separately from
 * any particular hash function so both `node:crypto` (build/publish tooling) and Expo Crypto (the
 * mobile client) can hash identical input bytes.
 */
export function releaseChecksumInput(release: ReleaseLike): string {
  const { checksum, ...rest } = release;
  return canonicalizeRelease(rest);
}
