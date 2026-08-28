import {
  SHADERCRAFT_BLANK,
  fillTutorialTemplate,
  getCorrectTutorialSource,
  shuffleTutorialChoices,
} from "../tutorial-exercise";
import type { TutorialStep } from "../types";

const choices = () => [
  { id: "quarter", fragment: "0.25" },
  { id: "half", fragment: "0.5" },
  { id: "one", fragment: "1.0" },
  { id: "zero", fragment: "0.0" },
];

const step = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "radius",
    position: 1,
    title: "Set the radius",
    brief: "Choose the expression that gives this circle a quarter-unit radius.",
    sourceTemplate: `float radius = ${SHADERCRAFT_BLANK};`,
    answerChoices: choices(),
    correctChoiceId: "quarter",
    ...overrides,
  }) as TutorialStep;

test("fills exactly the authored blank", () => {
  expect(fillTutorialTemplate(`float radius = ${SHADERCRAFT_BLANK};`, "0.25")).toBe(
    "float radius = 0.25;",
  );
});

test("derives the target from the correct choice", () => {
  expect(getCorrectTutorialSource(step({ correctChoiceId: "quarter" }))).toContain("0.25");
});

test("shuffles without mutating authored choices", () => {
  const authored = choices();
  expect(shuffleTutorialChoices(authored, () => 0)).not.toEqual(authored);
  expect(authored.map(({ id }) => id)).toEqual(["quarter", "half", "one", "zero"]);
});
