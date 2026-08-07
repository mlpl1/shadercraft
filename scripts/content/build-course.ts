/// <reference types="node" />

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeRelease } from "../../src/data/course/canonicalize";
import { parseAuthoredModules, parseCourseRelease } from "../../src/data/course/schema";
import type { CourseModule, CourseRelease } from "../../src/data/course/types";
import { calculateNodeReleaseChecksum } from "./node-checksum";

const moduleFiles = [
  "content/module-01-fragments.json",
  "content/module-02-shaping.json",
  "content/module-03-distance-fields.json",
  "content/module-04-colour.json",
  "content/module-05-space.json",
  "content/module-06-noise.json",
  "content/module-07-composition.json",
  "content/module-08-raymarching.json",
  "content/module-09-3d-shape.json",
  "content/module-10-lighting.json",
  "content/module-11-performance.json",
];

// `process.cwd()` rather than `import.meta.dirname`: npm scripts and Jest both run from the repo
// root, and `import.meta` is unreliable under Jest's CommonJS transform (it comes back with
// `dirname`/`url` undefined instead of throwing on the property access, but `resolve(undefined, …)`
// still throws).
const root = process.cwd();
const outputFile = resolve(root, "assets/course/bundled-course.json");

/** Loads and validates the version-controlled authoring JSON, ordered by module position. */
export function loadAuthoredModules(): CourseModule[] {
  const authoredModules = moduleFiles.map((filename) =>
    JSON.parse(readFileSync(resolve(root, filename), "utf8")),
  );
  return parseAuthoredModules(authoredModules).toSorted(
    (left, right) => left.position - right.position,
  );
}

/** Builds the bundled, checksummed release seeded on-device for a fully offline first run. */
export function buildBundledRelease(): CourseRelease {
  const modules = loadAuthoredModules();
  const releaseBody = {
    // Bumped whenever committed content changes. A device that already installed an id rejects a
    // different checksum under that same id permanently, so the id and the content move together.
    id: "bundled-2026-08-08",
    schemaVersion: 1 as const,
    minimumAppVersion: "1.0.0",
    modules,
  };
  const checksum = calculateNodeReleaseChecksum(releaseBody);

  return parseCourseRelease({ ...releaseBody, checksum });
}

function main(): void {
  const generated = `${JSON.stringify(JSON.parse(canonicalizeRelease(buildBundledRelease())), null, 2)}\n`;

  if (process.argv.includes("--check")) {
    const tracked = existsSync(outputFile) ? readFileSync(outputFile, "utf8") : undefined;
    if (tracked !== generated) {
      console.error("Bundled course is stale. Run `npm run content:build`.");
      process.exitCode = 1;
    } else {
      console.log("Bundled course is up to date.");
    }
  } else {
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, generated, "utf8");
    console.log(`Wrote ${outputFile}`);
  }
}

// Guard so importing this module (the publisher reuses `loadAuthoredModules`, and tests import it
// too) never triggers a build/check as a side effect of import — only running it directly does.
const isMain =
  typeof import.meta.url === "string" && process.argv[1]
    ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
    : false;

if (isMain) {
  main();
}
