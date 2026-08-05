import { calculateNodeReleaseChecksum } from "../../../../scripts/content/node-checksum";
import { canonicalizeRelease, releaseChecksumInput, type ReleaseLike } from "../canonicalize";

function baseRelease(): ReleaseLike {
  return {
    id: "sample-release",
    schemaVersion: 1,
    minimumAppVersion: "1.0.0",
    modules: [
      {
        id: "module-one",
        position: 1,
        status: "planned",
        title: "Module One",
        description: "Description",
        plannedLessonCount: 1,
        plannedTopics: ["Topic"],
        lessons: [],
      },
      {
        id: "module-two",
        position: 2,
        status: "planned",
        title: "Module Two",
        description: "Description",
        plannedLessonCount: 1,
        plannedTopics: ["Topic"],
        lessons: [],
      },
    ],
  };
}

test("canonical output does not depend on object key insertion order", () => {
  const releaseA: ReleaseLike = {
    id: "sample-release",
    schemaVersion: 1,
    minimumAppVersion: "1.0.0",
    modules: [],
  };
  const releaseB: ReleaseLike = {
    modules: [],
    minimumAppVersion: "1.0.0",
    schemaVersion: 1,
    id: "sample-release",
  };

  expect(canonicalizeRelease(releaseA)).toBe(canonicalizeRelease(releaseB));
});

test("canonical output changes when array element order changes", () => {
  const release = baseRelease();
  const reordered: ReleaseLike = { ...release, modules: [...release.modules].reverse() };

  expect(canonicalizeRelease(release)).not.toBe(canonicalizeRelease(reordered));
});

test("checksum field is excluded from its own checksum input", () => {
  const release = baseRelease();
  const withChecksumA: ReleaseLike = { ...release, checksum: "a".repeat(64) };
  const withChecksumB: ReleaseLike = { ...release, checksum: "b".repeat(64) };

  expect(releaseChecksumInput(withChecksumA)).toBe(releaseChecksumInput(withChecksumB));
});

test("node release checksum is a sha-256 hex digest", () => {
  expect(calculateNodeReleaseChecksum(baseRelease())).toMatch(/^[a-f0-9]{64}$/);
});
