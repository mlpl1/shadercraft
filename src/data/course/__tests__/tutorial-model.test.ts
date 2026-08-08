import { buildTutorialsModel, isTutorialUnlocked } from "../tutorial-model";
import type { CourseModule, Tutorial } from "../types";

const step = (id: string, position: number) => ({
  id,
  position,
  title: `Step ${position}`,
  brief: "brief",
  starterSource: "a",
  solutionSource: "b",
});

const tutorial = (id: string, moduleId: string, position: number, stepIds: string[]): Tutorial => ({
  id,
  moduleId,
  position,
  title: `Tutorial ${id}`,
  summary: "summary",
  steps: stepIds.map((stepId, index) => step(stepId, index + 1)),
});

const module = (
  id: string,
  position: number,
  lessonIds: string[],
  tutorials?: Tutorial[],
): CourseModule => ({
  id,
  position,
  status: "published",
  title: `Module ${position}`,
  description: "description",
  plannedLessonCount: 0,
  plannedTopics: [],
  lessons: lessonIds.map((lessonId, index) => ({
    id: lessonId,
    moduleId: id,
    position: index + 1,
    title: lessonId,
    shortTitle: lessonId,
    intro: "intro",
    takeaway: "takeaway",
    stages: [],
  })),
  ...(tutorials ? { tutorials } : {}),
});

const MODULES = [
  module("m1", 1, ["m1-l1", "m1-l2"], [tutorial("t1", "m1", 1, ["t1-s1", "t1-s2"])]),
  module("m2", 2, ["m2-l1"], [tutorial("t2", "m2", 1, ["t2-s1"])]),
  module("m3", 3, ["m3-l1"]),
];

const build = (completedLessons: string[], completedSteps: string[] = []) =>
  buildTutorialsModel(MODULES, completedLessons, new Set(completedSteps));

describe("isTutorialUnlocked", () => {
  it("stays locked while its own module is unfinished", () => {
    // Deliberately a later gate than a lesson's: reaching a module is not the same as having read
    // it, and a tutorial exercises what that module teaches.
    expect(isTutorialUnlocked(MODULES[0], ["m1-l1"])).toBe(false);
  });

  it("unlocks when its own module is complete", () => {
    expect(isTutorialUnlocked(MODULES[0], ["m1-l1", "m1-l2"])).toBe(true);
  });

  it("does not unlock just because a later module is complete", () => {
    expect(isTutorialUnlocked(MODULES[0], ["m2-l1"])).toBe(false);
  });
});

describe("buildTutorialsModel", () => {
  it("locks everything before any module is finished", () => {
    const model = build([]);

    expect(model.tutorials.map(({ status }) => status)).toEqual(["locked", "locked"]);
    expect(model.featured).toBeNull();
    expect(model.unlockedCount).toBe(0);
  });

  it("unlocks only the tutorial whose module is complete", () => {
    const model = build(["m1-l1", "m1-l2"]);

    expect(model.tutorials.map(({ id, status }) => `${id}:${status}`)).toEqual([
      "t1:available",
      "t2:locked",
    ]);
    expect(model.featured?.id).toBe("t1");
  });

  it("reports progress and moves to in-progress on a partly finished tutorial", () => {
    const model = build(["m1-l1", "m1-l2"], ["t1-s1"]);

    expect(model.tutorials[0]).toMatchObject({
      status: "in-progress",
      stepCount: 2,
      completedStepCount: 1,
    });
  });

  it("completes only when every step is done", () => {
    expect(build(["m1-l1", "m1-l2"], ["t1-s1"]).tutorials[0].status).toBe("in-progress");
    expect(build(["m1-l1", "m1-l2"], ["t1-s1", "t1-s2"]).tutorials[0].status).toBe("complete");
  });

  it("resumes on the first unfinished step rather than after the last completed one", () => {
    // A learner who finished step 2 but not step 1 stopped on step 1, and that is where they want
    // to land — position order decides, not completion order.
    expect(build(["m1-l1", "m1-l2"], ["t1-s2"]).tutorials[0].resumeStepId).toBe("t1-s1");
    expect(build(["m1-l1", "m1-l2"], ["t1-s1"]).tutorials[0].resumeStepId).toBe("t1-s2");
  });

  it("resumes a finished tutorial on its last step rather than bouncing to the start", () => {
    expect(build(["m1-l1", "m1-l2"], ["t1-s1", "t1-s2"]).tutorials[0].resumeStepId).toBe("t1-s2");
  });

  it("features the earliest unfinished tutorial, not the newest unlocked one", () => {
    const model = build(["m1-l1", "m1-l2", "m2-l1"]);

    expect(model.unlockedCount).toBe(2);
    expect(model.featured?.id).toBe("t1");
  });

  it("features the last unlocked tutorial once every one of them is complete", () => {
    // Home needs something to point at rather than an empty slot.
    const model = build(["m1-l1", "m1-l2", "m2-l1"], ["t1-s1", "t1-s2", "t2-s1"]);

    expect(model.featured?.id).toBe("t2");
    expect(model.featured?.status).toBe("complete");
  });

  it("ignores modules that carry no tutorials", () => {
    const model = build(["m1-l1", "m1-l2", "m2-l1", "m3-l1"]);

    expect(model.tutorials.map(({ moduleId }) => moduleId)).toEqual(["m1", "m2"]);
  });
});
