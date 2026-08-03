import bundledCourse from "../../../../assets/course/bundled-course.json";

import { buildNavigationModel } from "../navigation-model";
import { parseCourseRelease } from "../schema";

const release = parseCourseRelease(bundledCourse);
const [module1, module2, module3] = release.modules;

const completedModule1Ids = module1.lessons.map((lesson) => lesson.id);
const completedModule2Ids = [module1, module2].flatMap((module) =>
  module.lessons.map((lesson) => lesson.id),
);
const completedModule3Ids = [module1, module2, module3].flatMap((module) =>
  module.lessons.map((lesson) => lesson.id),
);

const model = buildNavigationModel(release.modules, [], true);
const completedModule1Model = buildNavigationModel(release.modules, completedModule1Ids, true);
const completedModule2Model = buildNavigationModel(release.modules, completedModule2Ids, true);
const completedModule3Model = buildNavigationModel(release.modules, completedModule3Ids, true);

describe("navigation presentation model", () => {
  test("features the first lesson of the first module before any completion", () => {
    expect(model.featuredLesson!.id).toBe("coordinate-systems-uv-space");
  });

  test("features the first lesson of module three once modules one and two are complete", () => {
    expect(completedModule2Model.featuredLesson!.id).toBe("color-mixing");
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
    expect(buildNavigationModel(release.modules, [], false).isHydrated).toBe(false);
  });
});
