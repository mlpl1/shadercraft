/// <reference types="node" />

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseAuthoredModules, parseCourseRelease } from "../../src/data/course/schema";

const moduleFiles = [
  "content/module-01-foundations.json",
  "content/module-02-shapes.json",
  "content/module-03-color-light.json",
  "content/module-04-textures.json",
];

const root = resolve(import.meta.dirname, "../..");
const outputFile = resolve(root, "assets/course/bundled-course.json");

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function buildRelease() {
  const authoredModules = moduleFiles.map((filename) =>
    JSON.parse(readFileSync(resolve(root, filename), "utf8")),
  );
  const modules = parseAuthoredModules(authoredModules).toSorted(
    (left, right) => left.position - right.position,
  );
  const releaseBody = {
    id: "bundled-2026-08-03",
    schemaVersion: 1 as const,
    minimumAppVersion: "1.0.0",
    modules,
  };
  const checksum = createHash("sha256")
    .update(JSON.stringify(canonicalize(releaseBody)))
    .digest("hex");

  return parseCourseRelease({ ...releaseBody, checksum });
}

const generated = `${JSON.stringify(canonicalize(buildRelease()), null, 2)}\n`;

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
