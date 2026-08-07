// `../../context/data-context` imports the AsyncStorage native module at module scope (used only by
// `DataProvider`'s real initialization path, not exercised here since these tests inject fake
// repositories directly through `DataContext.Provider`). That native module isn't available under
// plain Jest, so it needs the package's own documented mock swapped in before anything requires it
// transitively.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// The real sandbox compiles GLSL through an `expo-gl` context, which no Jest environment provides.
// Stand in a view that reports the source it was handed, so the workspace's contract with the
// sandbox stays observable.
jest.mock("../shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text, View } = require("react-native") as typeof import("react-native");

  return {
    ShaderSandbox: ({ source }: { source: string }) =>
      React.createElement(View, { testID: "sandbox" }, React.createElement(Text, null, source)),
  };
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import bundledCourse from "../../../assets/course/bundled-course.json";

import { parseCourseRelease } from "../../data/course/schema";
import type { CourseLesson, CourseModule } from "../../data/course/types";
import { LessonWorkspace, type LessonWorkspaceProps } from "../lesson-workspace";

const release = parseCourseRelease(bundledCourse);

function findModule(moduleId: string): CourseModule {
  const module = release.modules.find((candidate) => candidate.id === moduleId);
  if (!module) throw new Error(`Missing fixture module ${moduleId}`);
  return module;
}

function findLesson(lessonId: string): CourseLesson {
  const lesson = release.modules
    .flatMap((module) => module.lessons)
    .find((candidate) => candidate.id === lessonId);
  if (!lesson) throw new Error(`Missing fixture lesson ${lessonId}`);
  return lesson;
}

const fragmentsModule = findModule("fragments-and-coordinates");
const fragmentShaderLesson = findLesson("what-a-fragment-shader-is");

/**
 * A second lesson, distinct from the bundled fixture, purely to exercise switching lessons while
 * a later stage is open. `LessonWorkspace` gets no `key` from its caller (see `src/app/lesson.tsx`,
 * which advances lessons via `router.replace` on the same route), so its instance survives a lesson
 * change and any state that isn't explicitly reset per-lesson would leak across lessons.
 */
const otherLesson: CourseLesson = {
  id: "other-lesson",
  moduleId: fragmentsModule.id,
  position: 2,
  title: "Another lesson",
  shortTitle: "Another lesson",
  intro: "A second lesson used only to prove stage state resets when the lesson prop changes.",
  takeaway: "Switching lessons must not carry over stage position from the previous lesson.",
  stages: [
    {
      id: "other-lesson-stage-1",
      position: 1,
      title: "Other lesson, stage one",
      body: "The first stage of the other lesson.",
      source: "fragColor = vec4(0.1, 0.2, 0.3, 1.0);",
    },
    {
      id: "other-lesson-stage-2",
      position: 2,
      title: "Other lesson, stage two",
      body: "The second stage of the other lesson.",
      source: "fragColor = vec4(0.4, 0.5, 0.6, 1.0);",
    },
  ],
};

async function renderWorkspace(overrides: Partial<LessonWorkspaceProps> = {}) {
  const props: LessonWorkspaceProps = {
    completed: false,
    hydrated: true,
    lesson: fragmentShaderLesson,
    lessonCount: fragmentsModule.lessons.length,
    lessonIndex: 0,
    modulePosition: fragmentsModule.position,
    moduleTitle: fragmentsModule.title,
    onBack: jest.fn(),
    onComplete: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    onNext: jest.fn(),
    onUndo: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
    progressPercent: 75,
    ...overrides,
  };

  const view = await render(<LessonWorkspace {...props} />);

  return { props, view };
}

async function pressAlertAction(alertSpy: jest.SpiedFunction<typeof Alert.alert>, index: number) {
  const buttons = alertSpy.mock.calls[0][2];
  await act(async () => {
    buttons?.[index]?.onPress?.();
  });
}

describe("lesson workspace", () => {
  test("renders the lesson and its module context", async () => {
    await renderWorkspace();

    expect(screen.getByText(fragmentShaderLesson.title)).toBeTruthy();
    expect(screen.getByText(fragmentShaderLesson.intro)).toBeTruthy();
    expect(screen.getByText(fragmentShaderLesson.shortTitle)).toBeTruthy();
    expect(screen.getByText("Module 01")).toBeTruthy();
    expect(screen.getByText(`1 of ${fragmentsModule.lessons.length}`)).toBeTruthy();
  });

  it("opens on the first stage", async () => {
    await renderWorkspace();

    expect(screen.getByText("Stage 1 of 4")).toBeTruthy();
    expect(screen.getByTestId("sandbox")).toHaveTextContent(/vec4\(0\.85/);
  });

  it("advances to the next stage and shows its source", async () => {
    await renderWorkspace();

    await fireEvent.press(screen.getByLabelText("Next stage"));

    expect(screen.getByText("Stage 2 of 4")).toBeTruthy();
    expect(screen.getByTestId("sandbox")).toHaveTextContent(/400\.0/);
  });

  it("goes back, reverting the rendered source", async () => {
    await renderWorkspace();

    await fireEvent.press(screen.getByLabelText("Next stage"));
    await fireEvent.press(screen.getByLabelText("Previous stage"));

    expect(screen.getByText("Stage 1 of 4")).toBeTruthy();
    expect(screen.getByTestId("sandbox")).toHaveTextContent(/vec4\(0\.85/);
  });

  it("shows the current stage's source as readable code, and advances it with the stage", async () => {
    await renderWorkspace();

    // The code shown to the learner is exactly the source the sandbox above it is compiling —
    // never a paraphrase of it.
    expect(screen.getByTestId("stage-source")).toHaveTextContent(/vec4\(0\.85/);

    await fireEvent.press(screen.getByLabelText("Next stage"));

    expect(screen.getByTestId("stage-source")).toHaveTextContent(/400\.0/);
  });

  it("disables previous on the first stage and next on the last", async () => {
    await renderWorkspace();
    expect(screen.getByLabelText("Previous stage").props.accessibilityState.disabled).toBe(true);

    for (let i = 0; i < 3; i += 1) {
      await fireEvent.press(screen.getByLabelText("Next stage"));
    }

    expect(screen.getByLabelText("Next stage").props.accessibilityState.disabled).toBe(true);
  });

  it("shows the current stage's title and body", async () => {
    await renderWorkspace();

    expect(screen.getByText("One colour, everywhere")).toBeTruthy();
    expect(screen.getByText(/simplest possible shader/)).toBeTruthy();
  });

  it("shows the takeaway and the optional tryThis prompt", async () => {
    await renderWorkspace();

    expect(screen.getByText(/One function, run once per pixel/)).toBeTruthy();
    expect(screen.getByText(/Swap uv.x and uv.y/)).toBeTruthy();
  });

  it("resets to the first stage when the lesson prop changes", async () => {
    const { props, view } = await renderWorkspace();

    await fireEvent.press(screen.getByLabelText("Next stage"));
    await fireEvent.press(screen.getByLabelText("Next stage"));
    expect(screen.getByText("Stage 3 of 4")).toBeTruthy();

    // Same component instance, new `lesson` prop — exactly what `router.replace`-driven lesson
    // navigation produces, since `LessonWorkspace` is never remounted with a fresh `key`.
    await view.rerender(<LessonWorkspace {...props} lesson={otherLesson} />);

    expect(screen.getByText("Stage 1 of 2")).toBeTruthy();
    expect(screen.getByTestId("sandbox")).toHaveTextContent(/vec4\(0\.1, 0\.2, 0\.3/);
  });

  test("zero-pads the module numeral in the header", async () => {
    await renderWorkspace({ modulePosition: 7 });

    expect(screen.getByText("Module 07")).toBeTruthy();
  });

  test("shows the completion sheet after a successful completion", async () => {
    // Explicitly the last lesson in the module, so completing it offers "Return to course" rather
    // than "Continue to next lesson" — independent of how many lessons the module happens to carry.
    const { props } = await renderWorkspace({ lessonIndex: fragmentsModule.lessons.length - 1 });

    await fireEvent.press(screen.getByText("Mark lesson complete"));

    await waitFor(() => expect(screen.getByText("Lesson complete")).toBeTruthy());
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("Return to course")).toBeTruthy();

    await fireEvent.press(screen.getByText("Return to course"));

    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  test("offers the next lesson when the module still has one ahead", async () => {
    const { props } = await renderWorkspace({ lessonCount: 2, lessonIndex: 0 });

    await fireEvent.press(screen.getByText("Mark lesson complete"));

    await waitFor(() => expect(screen.getByText("Continue to next lesson")).toBeTruthy());

    await fireEvent.press(screen.getByText("Continue to next lesson"));

    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  test("confirms before undoing a completed lesson", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const { props } = await renderWorkspace({ completed: true });

    expect(screen.getByText("Completed · Tap to undo")).toBeTruthy();

    await fireEvent.press(screen.getByText("Completed · Tap to undo"));

    expect(props.onUndo).not.toHaveBeenCalled();

    await pressAlertAction(alertSpy, 1);

    expect(props.onUndo).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  test("disables completion until progress has hydrated", async () => {
    const { props } = await renderWorkspace({ hydrated: false });

    expect(screen.getByText("Loading progress…")).toBeTruthy();

    await fireEvent.press(screen.getByText("Loading progress…"));

    expect(props.onComplete).not.toHaveBeenCalled();
  });

  test("surfaces a retryable error when saving the completion fails", async () => {
    const onComplete = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error("database is locked"))
      .mockResolvedValue(undefined);
    await renderWorkspace({ onComplete });

    await fireEvent.press(screen.getByText("Mark lesson complete"));

    await waitFor(() => expect(screen.getByText("Progress not saved")).toBeTruthy());
    expect(screen.queryByText("Lesson complete")).toBeNull();
    expect(screen.getByText("Mark lesson complete")).toBeTruthy();

    await fireEvent.press(screen.getByText("Retry"));

    await waitFor(() => expect(screen.getByText("Lesson complete")).toBeTruthy());
    expect(screen.queryByText("Progress not saved")).toBeNull();
    expect(onComplete).toHaveBeenCalledTimes(2);
  });

  test("surfaces a retryable error when undoing the completion fails", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const onUndo = jest.fn<Promise<void>, []>().mockRejectedValue(new Error("database is locked"));
    await renderWorkspace({ completed: true, onUndo });

    await fireEvent.press(screen.getByText("Completed · Tap to undo"));
    await pressAlertAction(alertSpy, 1);

    await waitFor(() => expect(screen.getByText("Progress not saved")).toBeTruthy());
    expect(screen.getByText("Retry")).toBeTruthy();
    alertSpy.mockRestore();
  });

  test("navigates back from the header", async () => {
    const { props } = await renderWorkspace();

    await fireEvent.press(screen.getByLabelText("Back"));

    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
