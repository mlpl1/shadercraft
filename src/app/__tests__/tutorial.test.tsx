jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

jest.mock("../../components/shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text } = require("react-native") as typeof import("react-native");
  return {
    ShaderSandbox: ({ source }: { source: string }) =>
      React.createElement(Text, { testID: "sandbox-source" }, source),
  };
});

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockRouteParams = { current: { tutorialId: "pulse", stepId: "pulse-s1" } };

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockRouteParams.current,
  useRouter: () => mockRouter,
}));

jest.mock("../../context/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../context/course-context", () => ({ useCourse: jest.fn() }));
jest.mock("../../context/data-context", () => ({ useData: jest.fn() }));

jest.mock("../../context/settings-context", () => ({
  useSettings: () => ({
    settings: { editorFontSize: 16, showEditorLineNumbers: false },
  }),
}));

jest.mock("../../components/glsl-input", () => ({
  GlslInput: () => null,
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import TutorialScreen from "../tutorial";
import { useAuth } from "../../context/auth-context";
import { useCourse } from "../../context/course-context";
import { useData } from "../../context/data-context";
import { SHADERCRAFT_BLANK } from "../../data/course/tutorial-exercise";
import type { CourseModule } from "../../data/course/types";

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseCourse = useCourse as jest.MockedFunction<typeof useCourse>;
const mockUseData = useData as jest.MockedFunction<typeof useData>;

const template = `float radius = ${SHADERCRAFT_BLANK};\nfragColor = vec4(radius);`;
const targetSource = "float radius = 0.25;\nfragColor = vec4(radius);";
const choices = [
  { id: "quarter", fragment: "0.25" },
  { id: "half", fragment: "0.5" },
  { id: "three-quarters", fragment: "0.75" },
  { id: "one", fragment: "1.0" },
];

const modules: CourseModule[] = [
  {
    id: "m1",
    position: 1,
    status: "published",
    title: "Fragments",
    description: "d",
    plannedLessonCount: 0,
    plannedTopics: [],
    lessons: [],
    tutorials: [
      {
        id: "pulse",
        moduleId: "m1",
        position: 1,
        title: "Make it pulse",
        summary: "Drive a radius from time.",
        steps: [
          {
            id: "pulse-s1",
            position: 1,
            title: "Step one",
            brief: "Choose the target radius.",
            sourceTemplate: template,
            answerChoices: choices,
            correctChoiceId: "quarter",
          },
        ],
      },
    ],
  },
];

let repository: {
  getStates: jest.Mock;
  saveDraft: jest.Mock;
  setCompleted: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockRouteParams.current = { tutorialId: "pulse", stepId: "pulse-s1" };
  repository = {
    getStates: jest.fn(async () => new Map()),
    saveDraft: jest.fn(async () => undefined),
    setCompleted: jest.fn(async () => undefined),
  };
  mockUseAuth.mockReturnValue({ profileId: "profile-a" } as ReturnType<typeof useAuth>);
  mockUseCourse.mockReturnValue({ modules } as ReturnType<typeof useCourse>);
  mockUseData.mockReturnValue({
    status: "ready",
    tutorialProgressRepository: repository,
  } as unknown as ReturnType<typeof useData>);
});

async function renderScreen() {
  const rendered = await render(<TutorialScreen />);
  await waitFor(() => expect(screen.getByText("Step one")).toBeTruthy());
  return rendered;
}

function optionOrder() {
  return screen
    .getAllByRole("button")
    .map((button) => button.props.accessibilityLabel)
    .filter((label): label is string => choices.some((choice) => choice.fragment === label));
}

test("shows the target while keeping the learner preview hidden before confirmation", async () => {
  await renderScreen();

  expect(screen.getAllByTestId("sandbox-source")).toHaveLength(1);
  expect(screen.getByTestId("sandbox-source").props.children).toBe(targetSource);
  expect(screen.getByText("Target")).toBeTruthy();
  expect(screen.queryByText("Yours")).toBeNull();
});

test("keeps the learner result hidden when an answer is only selected", async () => {
  await renderScreen();

  await fireEvent.press(screen.getByRole("button", { name: "0.5" }));

  expect(screen.getAllByTestId("sandbox-source")).toHaveLength(1);
  expect(screen.getByTestId("sandbox-source").props.children).toBe(targetSource);
  expect(screen.getByLabelText(
    "Source template: float radius = Choose an answer; fragColor = vec4(radius);",
  )).toBeTruthy();
  expect(screen.getByText("Target")).toBeTruthy();
  expect(screen.queryByText("Yours")).toBeNull();
});

test("places the persistent target between the description and code card", async () => {
  const rendered = await renderScreen();
  const tree = JSON.stringify(rendered.toJSON());
  const descriptionIndex = tree.indexOf("Choose the target radius.");
  const targetIndex = tree.indexOf("tutorial-target-preview");
  const codeIndex = tree.indexOf("tutorial-source-template");

  expect(descriptionIndex).toBeGreaterThanOrEqual(0);
  expect(targetIndex).toBeGreaterThan(descriptionIndex);
  expect(codeIndex).toBeGreaterThan(targetIndex);
});
test("keeps hint content and previous navigation inside the fixed action dock", async () => {
  const exerciseModules = structuredClone(modules);
  exerciseModules[0].tutorials![0].steps[0].hint = "The radius is the distance from the center.";
  exerciseModules[0].tutorials![0].steps.push({ ...exerciseModules[0].tutorials![0].steps[0], id: "pulse-s2", position: 2, title: "Step two" });
  mockUseCourse.mockReturnValue({ modules: exerciseModules } as ReturnType<typeof useCourse>);

  mockRouteParams.current = { tutorialId: "pulse", stepId: "pulse-s2" };
  await render(<TutorialScreen />);
  await waitFor(() => expect(screen.getByText("Step two")).toBeTruthy());
  await fireEvent.press(screen.getByRole("button", { name: "Hint" }));

  const dock = screen.getByTestId("tutorial-action-dock");
  expect(dock).toHaveTextContent(/radius is the distance/);
  expect(dock).toHaveTextContent(/Previous step/);
  expect(screen.getByText("Previous step")).toBeTruthy();
});
test("keeps Previous, Hint, and Skip in the same control row", async () => {
  const exerciseModules = structuredClone(modules);
  exerciseModules[0].tutorials![0].steps[0].hint = "The radius is the distance from the center.";
  exerciseModules[0].tutorials![0].steps.push({ ...exerciseModules[0].tutorials![0].steps[0], id: "pulse-s2", position: 2, title: "Step two" });
  mockUseCourse.mockReturnValue({ modules: exerciseModules } as ReturnType<typeof useCourse>);
  mockRouteParams.current = { tutorialId: "pulse", stepId: "pulse-s2" };

  await render(<TutorialScreen />);
  await waitFor(() => expect(screen.getByText("Step two")).toBeTruthy());

  const previous = screen.getByRole("button", { name: "Previous step" });
  const hint = screen.getByRole("button", { name: "Hint" });
  const skip = screen.getByRole("button", { name: "Skip and reveal answer" });
  expect(previous.parent).toBe(hint.parent);
  expect(hint.parent).toBe(skip.parent);
});

test("shows a selected Hint control while the hint is open", async () => {
  const exerciseModules = structuredClone(modules);
  exerciseModules[0].tutorials![0].steps[0].hint = "The radius is the distance from the center.";
  mockUseCourse.mockReturnValue({ modules: exerciseModules } as ReturnType<typeof useCourse>);

  await renderScreen();
  await fireEvent.press(screen.getByRole("button", { name: "Hint" }));

  const selectedHint = screen.getByRole("button", { name: "Hide hint" });
  expect(selectedHint.props.accessibilityState).toMatchObject({ selected: true });
});
test("shows segmented progress and lettered answer choices", async () => {
  await renderScreen();

  expect(screen.getByTestId("tutorial-progress-rail")).toBeTruthy();
  expect(screen.getByText("A")).toBeTruthy();
  expect(screen.getByText("B")).toBeTruthy();
  expect(screen.getByText("C")).toBeTruthy();
  expect(screen.getByText("D")).toBeTruthy();
});

test("applies and evaluates a wrong answer only when it is confirmed", async () => {
  await renderScreen();

  await fireEvent.press(screen.getByRole("button", { name: "0.5" }));
  await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));

  expect(screen.getByText("Not quite")).toBeTruthy();
  expect(screen.getByText("Target")).toBeTruthy();
  expect(screen.getByText("Yours")).toBeTruthy();
  expect(screen.getAllByTestId("sandbox-source")[1].props.children).toBe(
    "float radius = 0.5;\nfragColor = vec4(radius);",
  );
  expect(screen.getAllByTestId("sandbox-source")[0].props.children).toBe(targetSource);
});

test("keeps the last confirmed result until a retry is confirmed", async () => {
  await renderScreen();

  await fireEvent.press(screen.getByRole("button", { name: "0.5" }));
  await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));
  await fireEvent.press(screen.getByRole("button", { name: "0.25" }));

  expect(screen.getAllByTestId("sandbox-source")[1].props.children).toBe(
    "float radius = 0.5;\nfragColor = vec4(radius);",
  );

  await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));

  expect(screen.getByText("Correct")).toBeTruthy();
  expect(screen.getAllByTestId("sandbox-source")[1].props.children).toBe(targetSource);
});

test("disables confirmation until an answer is selected", async () => {
  await renderScreen();

  expect(screen.getByRole("button", { name: "Confirm" }).props.accessibilityState).toMatchObject({
    disabled: true,
  });
});

test("allows retries without changing option order or writing drafts", async () => {
  await renderScreen();
  const orderBeforeChecks = optionOrder();

  await fireEvent.press(screen.getByRole("button", { name: "0.5" }));
  await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));
  expect(screen.getByText("Not quite")).toBeTruthy();
  expect(repository.setCompleted).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));
  expect(screen.getByText("Not quite")).toBeTruthy();
  expect(optionOrder()).toEqual(orderBeforeChecks);
  expect(repository.saveDraft).not.toHaveBeenCalled();
});

test("completes a step after the correct answer", async () => {
  await renderScreen();

  await fireEvent.press(screen.getByRole("button", { name: "0.25" }));
  await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));

  expect(screen.getByText("Correct")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Continue/ })).toBeTruthy();
  expect(repository.setCompleted).toHaveBeenCalledWith("profile-a", "pulse-s1", true);
});

test("keeps the correct answer locked after completion", async () => {
  await renderScreen();

  await fireEvent.press(screen.getByRole("button", { name: "0.25" }));
  await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));
  await fireEvent.press(screen.getByRole("button", { name: "0.5" }));

  expect(screen.getByText("Correct")).toBeTruthy();
  expect(screen.getAllByTestId("sandbox-source")[1].props.children).toBe(targetSource);
});
test("skips by revealing the correct answer and completing the step", async () => {
  await renderScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Skip and reveal answer" }));

  expect(screen.getByText("Skipped")).toBeTruthy();
  expect(screen.getAllByText("0.25").length).toBeGreaterThan(0);
  expect(repository.setCompleted).toHaveBeenCalledWith("profile-a", "pulse-s1", true);
});

test("keeps the revealed answer locked after skipping", async () => {
  await renderScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Skip and reveal answer" }));
  await fireEvent.press(screen.getByRole("button", { name: "0.5" }));

  expect(screen.getByText("Skipped")).toBeTruthy();
  expect(screen.getAllByTestId("sandbox-source")[1].props.children).toBe(targetSource);
});
test("shows persisted completed steps as completed", async () => {
  repository.getStates.mockResolvedValue(
    new Map([["pulse-s1", { completed: true, draft: null }]]),
  );

  await renderScreen();

  expect(screen.getByText("Completed")).toBeTruthy();
});

test("replaces completed steps when switching profiles", async () => {
  let activeProfileId = "profile-a";
  repository.getStates.mockImplementation(async (profileId: string) =>
    profileId === "profile-a"
      ? new Map([["pulse-s1", { completed: true, draft: null }]])
      : new Map(),
  );
  mockUseAuth.mockImplementation(
    () => ({ profileId: activeProfileId }) as ReturnType<typeof useAuth>,
  );

  const rendered = await render(<TutorialScreen />);
  await waitFor(() => expect(screen.getByText("Completed")).toBeTruthy());

  activeProfileId = "profile-b";
  rendered.rerender(<TutorialScreen />);

  await waitFor(() => expect(repository.getStates).toHaveBeenLastCalledWith("profile-b", ["pulse-s1"]));
  expect(screen.queryByText("Completed")).toBeNull();
});
test("reshuffles choices for a new screen visit", async () => {
  jest
    .spyOn(Math, "random")
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0.999)
    .mockReturnValueOnce(0.999)
    .mockReturnValueOnce(0.999);

  const first = await render(<TutorialScreen />);
  await waitFor(() => expect(screen.getByText("Step one")).toBeTruthy());
  const firstOrder = optionOrder();
  await first.unmount();

  await renderScreen();

  expect(optionOrder()).not.toEqual(firstOrder);
});
test.each(["correct answer", "skip"])(
  "retains optimistic completion when initial progress resolves after a %s",
  async (completionMethod) => {
    let resolveStates: (states: Map<string, { completed: boolean; draft: null }>) => void = () => undefined;
    repository.getStates.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStates = resolve;
        }),
    );

    await renderScreen();

    if (completionMethod === "correct answer") {
      await fireEvent.press(screen.getByRole("button", { name: "0.25" }));
      await fireEvent.press(screen.getByRole("button", { name: "Confirm" }));
    } else {
      await fireEvent.press(screen.getByRole("button", { name: "Skip and reveal answer" }));
    }

    expect(screen.getByText("Completed")).toBeTruthy();
    expect(repository.setCompleted).toHaveBeenCalledWith("profile-a", "pulse-s1", true);

    await act(async () => {
      resolveStates(new Map());
    });

    expect(screen.getByText("Completed")).toBeTruthy();
  },
);
test("uses an ASCII single-chevron back label", async () => {
  await renderScreen();

  expect(screen.getByRole("button", { name: "< Make it pulse" })).toBeTruthy();
});
