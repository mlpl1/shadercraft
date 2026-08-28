import type { CourseModule } from "../../data/course/types";
import { collectSources } from "../shader-audit";

const modules: CourseModule[] = [
  {
    id: "module",
    position: 1,
    status: "published",
    title: "Module",
    description: "Module description",
    plannedLessonCount: 0,
    plannedTopics: [],
    lessons: [],
    tutorials: [
      {
        id: "tutorial",
        moduleId: "module",
        position: 1,
        title: "Tutorial",
        summary: "Tutorial summary",
        steps: [
          {
            id: "step",
            position: 1,
            title: "Step",
            brief: "Choose the fragment that produces the requested colour in this shader exercise.",
            sourceTemplate: "fragColor = vec4(/*__SHADERCRAFT_BLANK__*/);",
            answerChoices: [
              { id: "red", fragment: "1.0, 0.0, 0.0, 1.0" },
              { id: "green", fragment: "0.0, 1.0, 0.0, 1.0" },
              { id: "blue", fragment: "0.0, 0.0, 1.0, 1.0" },
              { id: "white", fragment: "1.0" },
            ],
            correctChoiceId: "red",
            helpers: "float identity(float value) { return value; }",
          },
        ],
      },
    ],
  },
];

test("collects one compilable source for every authored tutorial choice", () => {
  expect(collectSources(modules)).toEqual([
    {
      id: "step",
      kind: "choice:red",
      source: "fragColor = vec4(1.0, 0.0, 0.0, 1.0);",
      helpers: "float identity(float value) { return value; }",
    },
    {
      id: "step",
      kind: "choice:green",
      source: "fragColor = vec4(0.0, 1.0, 0.0, 1.0);",
      helpers: "float identity(float value) { return value; }",
    },
    {
      id: "step",
      kind: "choice:blue",
      source: "fragColor = vec4(0.0, 0.0, 1.0, 1.0);",
      helpers: "float identity(float value) { return value; }",
    },
    {
      id: "step",
      kind: "choice:white",
      source: "fragColor = vec4(1.0);",
      helpers: "float identity(float value) { return value; }",
    },
  ]);
});
