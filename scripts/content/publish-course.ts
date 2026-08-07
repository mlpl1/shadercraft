/// <reference types="node" />

import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCourseRelease } from "../../src/data/course/schema";
import type { CourseModule, CourseRelease } from "../../src/data/course/types";
import { loadAuthoredModules } from "./build-course";
import { calculateNodeReleaseChecksum } from "./node-checksum";

const releaseIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AdminRpcError = { message: string };
export type AdminRpcResult = { error: AdminRpcError | null };

/**
 * The minimal shape the publisher needs from a Supabase admin client. Matches
 * `SupabaseClient["rpc"]` closely enough to be satisfied by the real client, while letting tests
 * inject a fake with no network access.
 */
export type AdminClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<AdminRpcResult>;
};

export type PublishEnv = Record<string, string | undefined>;

export type PublishDeps = {
  env: PublishEnv;
  loadAuthoredModules: () => CourseModule[];
  createAdminClient: (url: string, serviceRoleKey: string) => AdminClient;
  log?: (message: string) => void;
};

type ReleaseCounts = { modules: number; lessons: number; stages: number };

function countRelease(release: CourseRelease): ReleaseCounts {
  let lessons = 0;
  let stages = 0;

  for (const module of release.modules) {
    for (const lesson of module.lessons) {
      lessons += 1;
      stages += lesson.stages.length;
    }
  }

  return { modules: release.modules.length, lessons, stages };
}

/**
 * Publishes the current authoring JSON as a new immutable release under `releaseId`.
 *
 * Validates the authored content (the same validation `content:build` runs) before touching the
 * network, so a malformed authoring change never reaches the service-role credential or Supabase.
 * The Supabase RPC itself enforces everything else — role check, nested-count verification,
 * immutability, and idempotent republishing of an identical checksum — so this function relies on
 * that contract rather than re-implementing it.
 */
export async function publishCourseRelease(releaseId: string, deps: PublishDeps): Promise<void> {
  const { env, loadAuthoredModules: load, createAdminClient, log = (message: string) => console.log(message) } = deps;

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both required to publish a course release.",
    );
  }

  if (!releaseIdPattern.test(releaseId)) {
    throw new Error(`Invalid release id: ${releaseId}`);
  }

  const modules = load();
  const releaseBody = {
    id: releaseId,
    schemaVersion: 1 as const,
    minimumAppVersion: "1.0.0",
    modules,
  };
  const checksum = calculateNodeReleaseChecksum(releaseBody);
  const release = parseCourseRelease({ ...releaseBody, checksum });

  const admin = createAdminClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await admin.rpc("publish_course_release", { p_payload: release });
  if (error) {
    throw new Error(`publish_course_release failed: ${error.message}`);
  }

  const counts = countRelease(release);
  log(JSON.stringify({ id: release.id, checksum: release.checksum, ...counts }));
}

function parseCliReleaseId(argv: string[]): string {
  const flagIndex = argv.indexOf("--release");
  const value = flagIndex === -1 ? undefined : argv[flagIndex + 1];
  if (!value) {
    throw new Error("Usage: npm run content:publish -- --release <release-id>");
  }
  return value;
}

async function main(): Promise<void> {
  const releaseId = parseCliReleaseId(process.argv.slice(2));
  await publishCourseRelease(releaseId, {
    env: process.env,
    loadAuthoredModules,
    createAdminClient: (url, serviceRoleKey) =>
      createClient(url, serviceRoleKey, { auth: { persistSession: false } }),
  });
}

const isMain =
  typeof import.meta.url === "string" && process.argv[1]
    ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
    : false;

if (isMain) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
