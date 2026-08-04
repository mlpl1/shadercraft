// `../../context/data-context` imports the AsyncStorage native module at module scope (used only by
// `DataProvider`'s real initialization path, not exercised here since these tests inject fake
// repositories directly through `DataContext.Provider`). That native module isn't available under
// plain Jest, so it needs the package's own documented mock swapped in before anything requires it
// transitively.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// The real preview compiles GLSL through an `expo-gl` context, which no Jest environment provides.
// Stand in a view that reports the preview key and restart token it was handed, so the workspace's
// contract with the preview stays observable.
jest.mock("../live-shader-preview", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");

  return {
    LiveShaderPreview: ({
      previewKey,
      restartToken = 0,
    }: {
      previewKey: string;
      restartToken?: number;
    }) =>
      React.createElement(View, {
        accessibilityLabel: `${previewKey}#${restartToken}`,
        testID: "live-shader-preview",
      }),
  };
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, StyleSheet } from "react-native";

import bundledCourse from "../../../assets/course/bundled-course.json";

import { Colors } from "../../constants/theme";
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

const coordinateFoundations = findModule("coordinate-foundations");
const colorLight = findModule("color-light");
const challengeLesson = findLesson("color-light-challenge");
const timeLesson = findLesson("uniforms-time");
const foundationChallengeLesson = findLesson("foundation-challenge");

function textColorOf(text: string): string | undefined {
  return StyleSheet.flatten(screen.getByText(text).props.style)?.color;
}

function previewLabel(): string {
  return String(screen.getByTestId("live-shader-preview").props.accessibilityLabel);
}

/**
 * Finds the nearest ancestor fiber's `onPress` handler for a queried host element. `fireEvent.press`
 * opens and closes its own `act` scope per call, so firing it twice without awaiting between calls
 * (needed to land two presses in a single React batch) would open a second scope before the first
 * one closes and log React's "overlapping act() calls" warning. Calling the handler directly, twice,
 * inside one `act` avoids that: it is the same handler `fireEvent.press` would have found and called,
 * just without an `act` scope per press.
 */
function findOnPressHandler(element: ReturnType<typeof screen.getByText>): () => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fiber: any = (element as unknown as { unstable_fiber?: unknown }).unstable_fiber;
  while (fiber) {
    const onPress = fiber.memoizedProps?.onPress;
    if (typeof onPress === "function") {
      return onPress;
    }
    fiber = fiber.return;
  }
  throw new Error("No onPress handler found in the element's ancestor fibers");
}

async function pressAlertAction(alertSpy: jest.SpiedFunction<typeof Alert.alert>, index: number) {
  const buttons = alertSpy.mock.calls[0][2];
  await act(async () => {
    buttons?.[index]?.onPress?.();
  });
}

async function renderWorkspace(overrides: Partial<LessonWorkspaceProps> = {}) {
  const props: LessonWorkspaceProps = {
    completed: false,
    hydrated: true,
    lesson: challengeLesson,
    lessonCount: colorLight.lessons.length,
    lessonIndex: colorLight.lessons.length - 1,
    modulePosition: colorLight.position,
    moduleTitle: colorLight.title,
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

/** Module 1 props for a lesson at `lessonIndex`, so its authored presentation stays observable. */
function moduleOneProps(lesson: CourseLesson, lessonIndex: number): Partial<LessonWorkspaceProps> {
  return {
    lesson,
    lessonCount: coordinateFoundations.lessons.length,
    lessonIndex,
    modulePosition: coordinateFoundations.position,
    moduleTitle: coordinateFoundations.title,
  };
}

describe("lesson workspace", () => {
  test("renders the lesson, its module context, and the first preset", async () => {
    await renderWorkspace();

    expect(screen.getByText(challengeLesson.title)).toBeTruthy();
    expect(screen.getByText(challengeLesson.intro)).toBeTruthy();
    expect(screen.getByText(challengeLesson.shortTitle)).toBeTruthy();
    expect(screen.getByText("Module 03")).toBeTruthy();
    expect(screen.getByText("4 of 4")).toBeTruthy();
    expect(screen.getByText("Palette albedo")).toBeTruthy();
    expect(previewLabel()).toBe("lighting-albedo#0");
  });

  test("zero-pads the module numeral in the header", async () => {
    await renderWorkspace(moduleOneProps(timeLesson, 2));

    expect(screen.getByText("Module 01")).toBeTruthy();
    expect(screen.queryByText(coordinateFoundations.title)).toBeNull();
  });

  test("renders the authored preview caption for the lesson", async () => {
    await renderWorkspace();

    expect(screen.getByText("Color field")).toBeTruthy();
    expect(screen.queryByText("Preview output")).toBeNull();
  });

  test("renders a Module 1 lesson's own preview caption", async () => {
    await renderWorkspace(moduleOneProps(timeLesson, 2));

    expect(screen.getByText("Time animation")).toBeTruthy();
  });

  test("opens on the preset a lesson authors as its default", async () => {
    await renderWorkspace(moduleOneProps(timeLesson, 2));

    expect(previewLabel()).toBe("time-play#0");
  });

  test("opens on the authored default preset of the foundation challenge", async () => {
    await renderWorkspace(moduleOneProps(foundationChallengeLesson, 4));

    expect(previewLabel()).toBe("challenge-final#0");
  });

  test("opens on the first preset when the lesson authors no default", async () => {
    await renderWorkspace(moduleOneProps(findLesson("transforming-uvs"), 3));

    expect(previewLabel()).toBe("transform-translate#0");
  });

  test("reports a preset authored as not animated as paused rather than running", async () => {
    await renderWorkspace(moduleOneProps(timeLesson, 2));

    expect(screen.getByText("Running")).toBeTruthy();

    await fireEvent.press(screen.getByText("Static"));

    expect(screen.getByText("Paused")).toBeTruthy();
    expect(screen.queryByText("Running")).toBeNull();

    await fireEvent.press(screen.getByText("Half speed"));

    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.queryByText("Paused")).toBeNull();
  });

  test("renders every concept section and the takeaway", async () => {
    await renderWorkspace();

    expect(screen.getByText(challengeLesson.conceptTitle)).toBeTruthy();
    expect(screen.getByText(challengeLesson.conceptLede)).toBeTruthy();
    expect(screen.getByText(challengeLesson.tryHint)).toBeTruthy();
    expect(screen.getByText(challengeLesson.takeaway)).toBeTruthy();
    for (const section of challengeLesson.sections) {
      expect(screen.getByText(section.title)).toBeTruthy();
      expect(screen.getByText(section.body)).toBeTruthy();
    }
  });

  test("swaps the preview, source, and line numbers when another preset is selected", async () => {
    await renderWorkspace();

    await fireEvent.press(screen.getByText("Diffuse light"));

    expect(screen.getByText("float diffuse = max(dot(normal, lightDir), 0.0);")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("02_diffuse.glsl")).toBeTruthy();
    expect(previewLabel()).toBe("lighting-diffuse#0");
  });

  test("accents only the 1-based highlighted line of the selected preset", async () => {
    await renderWorkspace();

    await fireEvent.press(screen.getByText("Diffuse light"));

    expect(textColorOf("float diffuse = max(dot(normal, lightDir), 0.0);")).toBe(Colors.accent);
    expect(textColorOf("vec3 lightDir = normalize(vec3(-0.55, 0.65, 0.75));")).not.toBe(
      Colors.accent,
    );
    expect(textColorOf("color = mix(background, lit, orb);")).not.toBe(Colors.accent);
  });

  test("accents every highlighted line when a preset highlights several", async () => {
    await renderWorkspace();

    await fireEvent.press(screen.getByText("Final material"));

    expect(textColorOf("float diffuse = max(dot(normal, lightDir), 0.0);")).toBe(Colors.accent);
    expect(textColorOf("float specular = pow(max(dot(normal, halfDir), 0.0), 42.0);")).toBe(
      Colors.accent,
    );
    expect(textColorOf("lit += cyan * rim * 0.6 + warm * specular * 1.3;")).toBe(Colors.accent);
    expect(textColorOf("vec3 lightDir = orbitingLight(u_time);")).not.toBe(Colors.accent);
    expect(textColorOf("vec3 lit = albedo * (0.14 + diffuse * 0.9);")).not.toBe(Colors.accent);
  });

  test("restarts the preview timeline for a restartable preset", async () => {
    await renderWorkspace(moduleOneProps(timeLesson, 2));

    expect(previewLabel()).toBe("time-play#0");

    await fireEvent.press(screen.getByText("Restart timeline"));

    expect(previewLabel()).toBe("time-play#1");
  });

  test("advances the restart token once per press even when two presses land in one batch", async () => {
    await renderWorkspace(moduleOneProps(timeLesson, 2));

    expect(previewLabel()).toBe("time-play#0");

    // Invoke the press handler directly, twice, inside one `act` call. `fireEvent.press` opens and
    // closes its own `act` scope per call, so firing it twice without awaiting between calls would
    // overlap two act scopes (a React warning) instead of landing both updates in one render pass.
    // Calling the handler itself twice inside a single scope is what actually reproduces two
    // presses batching into one render: a naive `restartToken + 1` computed from the closed-over
    // render-time value would compute the same next token for both presses and silently drop one.
    const restartButton = screen.getByText("Restart timeline");
    const onPress = findOnPressHandler(restartButton);
    await act(async () => {
      onPress();
      onPress();
    });

    expect(previewLabel()).toBe("time-play#2");
  });

  test("hides the restart control when no preview parameter requests it", async () => {
    await renderWorkspace();

    expect(screen.queryByText("Restart timeline")).toBeNull();
  });

  test("resets the selected preset to the new lesson's default when the lesson switches", async () => {
    const { props, view } = await renderWorkspace(moduleOneProps(timeLesson, 2));

    await fireEvent.press(screen.getByText("Double speed"));
    expect(previewLabel()).toBe("time-fast#0");

    await view.rerender(<LessonWorkspace {...props} lesson={challengeLesson} />);

    expect(previewLabel()).toBe("lighting-albedo#0");

    await view.rerender(<LessonWorkspace {...props} lesson={foundationChallengeLesson} />);

    expect(previewLabel()).toBe("challenge-final#0");
  });

  test("renders Module 1's bespoke preview footer values for Coordinate Systems & UV Space", async () => {
    const lesson = findLesson("coordinate-systems-uv-space");
    await renderWorkspace(moduleOneProps(lesson, 0));

    expect(screen.getByText("0.0 → 1.0 · screen space")).toBeTruthy();

    await fireEvent.press(screen.getByText("Centered"));
    expect(screen.getByText("−1.0 → 1.0 · centered")).toBeTruthy();

    await fireEvent.press(screen.getByText("Pixel space"));
    expect(screen.getByText("0 → resolution · pixel coordinates")).toBeTruthy();

    await fireEvent.press(screen.getByText("Corrected"));
    expect(screen.getByText("−aspect → aspect · corrected")).toBeTruthy();
  });

  test("falls back to the default label · value footer for a lesson with no bespoke footer copy", async () => {
    await renderWorkspace();

    expect(screen.getByText(`${challengeLesson.presets[0].label} · ${challengeLesson.presets[0].value}`)).toBeTruthy();
  });

  test("shows the default Concept eyebrow for a Module 1 lesson", async () => {
    await renderWorkspace(moduleOneProps(findLesson("coordinate-systems-uv-space"), 0));

    expect(screen.getByText("Concept")).toBeTruthy();
  });

  test("shows Module 2's authored intro eyebrow", async () => {
    const shapeSynthesis = findModule("shape-synthesis");
    const lesson = findLesson("step-and-smoothstep");

    await renderWorkspace({
      lesson,
      lessonCount: shapeSynthesis.lessons.length,
      lessonIndex: 0,
      modulePosition: shapeSynthesis.position,
      moduleTitle: shapeSynthesis.title,
    });

    expect(screen.getByText("Shape synthesis")).toBeTruthy();
    expect(screen.queryByText("Concept")).toBeNull();
  });

  test("shows Module 3's authored intro eyebrow", async () => {
    await renderWorkspace();

    expect(screen.getByText("Color & light")).toBeTruthy();
    expect(screen.queryByText("Concept")).toBeNull();
  });

  test("shows the completion sheet after a successful completion", async () => {
    const { props } = await renderWorkspace();

    await fireEvent.press(screen.getByText("Mark lesson complete"));

    await waitFor(() => expect(screen.getByText("Lesson complete")).toBeTruthy());
    expect(props.onComplete).toHaveBeenCalledTimes(1);
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("Return to course")).toBeTruthy();

    await fireEvent.press(screen.getByText("Return to course"));

    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  test("offers the next lesson when the module still has one", async () => {
    const { props } = await renderWorkspace({
      lesson: findLesson("color-mixing"),
      lessonIndex: 0,
    });

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
