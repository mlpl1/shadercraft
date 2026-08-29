jest.mock("../shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text } = require("react-native") as typeof import("react-native");
  return {
    ShaderSandbox: ({ source }: { source: string }) =>
      React.createElement(Text, { testID: "sandbox-source" }, source),
  };
});

import { fireEvent, render, screen } from "@testing-library/react-native";

import { TutorialActionDock } from "../tutorial-action-dock";
import { TutorialAnswerTile } from "../tutorial-answer-tile";
import { TutorialFeedback } from "../tutorial-feedback";
import { TutorialProgressRail } from "../tutorial-progress-rail";

const actionProps = {
  canConfirm: true,
  hasHint: true,
  onConfirm: jest.fn(),
  onContinue: jest.fn(),
  onHint: jest.fn(),
  onSkip: jest.fn(),
};

beforeEach(() => jest.clearAllMocks());

test("renders one progress segment per step and identifies the current segment", async () => {
  await render(<TutorialProgressRail completed={new Set(["s1"])} current={1} stepIds={["s1", "s2", "s3"]} />);
  expect(screen.getByTestId("tutorial-progress-rail")).toBeTruthy();
  expect(screen.getByLabelText("Step 1 completed")).toBeTruthy();
  expect(screen.getByLabelText("Step 2 current")).toBeTruthy();
  expect(screen.getByLabelText("Step 3 not completed")).toBeTruthy();
});

test("renders a lettered answer tile with explicit selected status", async () => {
  const onPress = jest.fn();
  await render(<TutorialAnswerTile disabled={false} fragment="uv.x" marker="B" onPress={onPress} selected status="pending" />);
  expect(screen.getByText("B")).toBeTruthy();
  expect(screen.getByText("Selected")).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "uv.x" }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test("hides comparison while idle", async () => {
  await render(<TutorialFeedback helpers={undefined} learnerSource={null} state="idle" targetSource="target" />);
  expect(screen.queryByText("Target")).toBeNull();
});

test("reveals comparison after confirmation", async () => {
  await render(<TutorialFeedback helpers={undefined} learnerSource="learner" state="incorrect" targetSource="target" />);
  expect(screen.getByText("Target")).toBeTruthy();
  expect(screen.getByText("Yours")).toBeTruthy();
  expect(screen.getByText("Not quite")).toBeTruthy();
});

test("uses confirm as the primary action before completion", async () => {
  await render(<TutorialActionDock {...actionProps} state="idle" />);
  fireEvent.press(screen.getByRole("button", { name: "Confirm" }));
  expect(actionProps.onConfirm).toHaveBeenCalledTimes(1);
});

test("uses continue as the primary action after completion", async () => {
  await render(<TutorialActionDock {...actionProps} state="correct" />);
  fireEvent.press(screen.getByRole("button", { name: "Continue" }));
  expect(actionProps.onContinue).toHaveBeenCalledTimes(1);
});