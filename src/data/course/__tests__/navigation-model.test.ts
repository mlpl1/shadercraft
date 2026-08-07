import { buildNavigationModel } from "../navigation-model";
import type { CourseLesson, CourseModule } from "../types";

/**
 * The navigation model reads module/lesson position and status, not prose or stages. Building a
 * synthetic set of modules here (rather than importing the real bundled course) keeps these tests
 * independent of how many modules and lessons are currently authored.
 */
function buildLesson(id: string, moduleId: string, position: number): CourseLesson {
  return {
    id,
    moduleId,
    position,
    title: id,
    shortTitle: id,
    intro: "",
    takeaway: "",
    stages: [],
  };
}

function buildModule(
  id: string,
  position: number,
  status: CourseModule["status"],
  lessonCount: number,
  plannedTopics: string[] = [],
): CourseModule {
  const lessons =
    status === "published"
      ? Array.from({ length: lessonCount }, (_, index) =>
          buildLesson(`${id}-lesson-${index + 1}`, id, index + 1),
        )
      : [];

  return {
    id,
    position,
    status,
    title: id,
    description: "",
    plannedLessonCount: status === "planned" ? plannedTopics.length : 0,
    plannedTopics: status === "planned" ? plannedTopics : [],
    lessons,
  };
}

const module1 = buildModule("module-1", 1, "published", 5);
const module2 = buildModule("module-2", 2, "published", 5);
const module3 = buildModule("module-3", 3, "published", 4);
const plannedModule4 = buildModule("module-4", 4, "planned", 0, [
  "Tiling Space",
  "Value Noise",
  "Layered Motion",
  "Fractal Brownian Motion",
  "Domain Warping",
]);

const modules = [module1, module2, module3, plannedModule4];

const completedModule1Ids = module1.lessons.map((lesson) => lesson.id);
const completedModule2Ids = [module1, module2].flatMap((module) =>
  module.lessons.map((lesson) => lesson.id),
);
const completedModule3Ids = [module1, module2, module3].flatMap((module) =>
  module.lessons.map((lesson) => lesson.id),
);

const model = buildNavigationModel(modules, [], true);
const completedModule1Model = buildNavigationModel(modules, completedModule1Ids, true);
const completedModule2Model = buildNavigationModel(modules, completedModule2Ids, true);
const completedModule3Model = buildNavigationModel(modules, completedModule3Ids, true);

describe("navigation presentation model", () => {
  test("features the first lesson of the first module before any completion", () => {
    expect(model.featuredLesson!.id).toBe(module1.lessons[0].id);
  });

  test("features the first lesson of module three once modules one and two are complete", () => {
    expect(completedModule2Model.featuredLesson!.id).toBe(module3.lessons[0].id);
  });

  test("keeps the fourth module planned even after every published module is complete", () => {
    expect(completedModule3Model.modules[3].status).toBe("planned");
  });

  test("reports full progress once every published lesson is complete", () => {
    expect(completedModule3Model.progressPercent).toBe(100);
  });

  test("locks the second module until the first module is complete", () => {
    expect(model.modules[1].status).toBe("locked");
  });

  test("unlocks the second module once the first module is complete", () => {
    expect(completedModule1Model.modules[1].status).toBe("available");
  });

  test("locks the planned fourth module until the third module is complete", () => {
    expect(model.modules[3].status).toBe("locked");
  });

  test("derives a planned module's lesson count and topics from its planned metadata", () => {
    expect(completedModule3Model.modules[3]).toMatchObject({
      lessonCount: 5,
      topics: [
        "Tiling Space",
        "Value Noise",
        "Layered Motion",
        "Fractal Brownian Motion",
        "Domain Warping",
      ],
    });
  });

  test("passes the hydration flag through unchanged", () => {
    expect(buildNavigationModel(modules, [], false).isHydrated).toBe(false);
  });

  test("reports no featured module or lesson before the course has hydrated any modules", () => {
    const preHydrationModel = buildNavigationModel([], [], false);

    expect(preHydrationModel.featuredModule).toBeNull();
    expect(preHydrationModel.featuredLesson).toBeNull();
  });

  test("points a fully complete module's currentLessonIndex at its last lesson, not -1", () => {
    const completedFirstModule = completedModule1Model.modules[0];

    expect(completedFirstModule.status).toBe("complete");
    expect(completedFirstModule.currentLessonIndex).toBe(completedFirstModule.lessons.length - 1);
    expect(completedFirstModule.currentLessonIndex).not.toBe(-1);
  });
});

/**
 * The shape the real curriculum took once Module 1 was the only published module: one published
 * module followed by many planned ones. Every planned module after the first is also *locked*,
 * because `getModuleStatus` never reports a planned module as "complete", so nothing behind it
 * can unlock.
 */
const soloPublished = buildModule("solo-published", 1, "published", 5);
const plannedNext = buildModule("planned-next", 2, "planned", 0, ["A", "B"]);
const plannedAfter = buildModule("planned-after", 3, "planned", 0, ["C", "D"]);
const plannedLast = buildModule("planned-last", 4, "planned", 0, ["E", "F"]);
const soloModules = [soloPublished, plannedNext, plannedAfter, plannedLast];
const soloCompletedIds = soloPublished.lessons.map((lesson) => lesson.id);

describe("a course whose only published module is complete", () => {
  const soloModel = buildNavigationModel(soloModules, soloCompletedIds, true);

  test("still features a module and a lesson, so Home can render", () => {
    // Home bails to its loading state when either is null, which strands the learner on
    // "Loading curriculum…" forever with no error and no way forward.
    expect(soloModel.featuredModule).not.toBeNull();
    expect(soloModel.featuredLesson).not.toBeNull();
  });

  test("features the completed module's last lesson for review", () => {
    expect(soloModel.featuredModule?.id).toBe("solo-published");
    expect(soloModel.featuredLesson?.id).toBe("solo-published-lesson-5");
  });

  test("still surfaces the next planned module", () => {
    expect(soloModel.modules.find((module) => module.status === "planned")?.id).toBe("planned-next");
  });
});

describe("featured selection never lands on a module the learner cannot open", () => {
  test("skips a locked published module", () => {
    // module1 complete, module2 available, module3 locked behind it.
    const featured = buildNavigationModel(modules, completedModule1Ids, true);

    expect(featured.featuredModule?.id).toBe("module-2");
  });

  test("never features a module with no lessons", () => {
    const soloModel = buildNavigationModel(soloModules, soloCompletedIds, true);

    expect(soloModel.featuredModule?.lessons.length).toBeGreaterThan(0);
  });
});
