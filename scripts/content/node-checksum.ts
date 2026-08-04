/// <reference types="node" />

import { createHash } from "node:crypto";

import { releaseChecksumInput, type ReleaseLike } from "../../src/data/course/canonicalize";

/**
 * SHA-256 hex digest of a release's canonical checksum input, computed with Node's `node:crypto`.
 * Node-only: the mobile client hashes the same {@link releaseChecksumInput} bytes with Expo Crypto
 * instead, since `node:crypto` is unavailable there.
 */
export function calculateNodeReleaseChecksum(release: ReleaseLike): string {
  return createHash("sha256").update(releaseChecksumInput(release)).digest("hex");
}
