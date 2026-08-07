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
    ShaderSandbox: ({ source, active }: { source: string; active?: boolean }) =>
      React.createElement(
        View,
        { testID: "sandbox" },
        React.createElement(Text, null, `${active === false ? "inactive" : "active"}:${source}`),
      ),
  };
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
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

/**
 * The component cannot know any block's position until `onLayout` fires, and no test environment
 * fires it. This supplies plausible geometry — a 600pt viewport over four 400pt blocks, preceded by a
 * non-zero intro section — then scrolls.
 *
 * `INTRO_OFFSET` matters: React Native reports `onLayout`'s `y` relative to the *parent* view, not the
 * scroll content. Each stage block's measuring `View` sits below `styles.intro`, so its real `y` is
 * `INTRO_OFFSET + index * blockHeight`, never `index * blockHeight` alone. A fixture that omits the
 * intro offset encodes geometry the app can never produce.
 */
const INTRO_OFFSET = 240;

async function measureAndScroll({ scrollY }: { scrollY: number }) {
  const scroll = screen.getByTestId("lesson-scroll");

  await fireEvent(scroll, "layout", { nativeEvent: { layout: { height: 600, width: 400 } } });

  const blocks = screen.getAllByTestId(/^stage-block-/);
  for (const [index, block] of blocks.entries()) {
    await fireEvent(block, "layout", {
      nativeEvent: { layout: { y: INTRO_OFFSET + index * 400, height: 400, width: 400 } },
    });
  }

  await fireEvent.scroll(scroll, {
    nativeEvent: {
      contentOffset: { y: scrollY, x: 0 },
      contentSize: { height: blocks.length * 400, width: 400 },
      layoutMeasurement: { height: 600, width: 400 },
    },
  });
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

  it("renders every stage's title, body and source", async () => {
    await renderWorkspace();

    expect(screen.getByText(fragmentShaderLesson.stages[0].title)).toBeTruthy();
    expect(
      screen.getByText(fragmentShaderLesson.stages[fragmentShaderLesson.stages.length - 1].title),
    ).toBeTruthy();
    expect(screen.getAllByTestId("stage-source")).toHaveLength(4);
  });

  it("has no stage pager", async () => {
    await renderWorkspace();

    expect(screen.queryByLabelText("Next stage")).toBeNull();
    expect(screen.queryByLabelText("Previous stage")).toBeNull();
    expect(screen.queryByText(/Stage \d+ of \d+/)).toBeNull();
  });

  it("mounts the first stage's preview before any scrolling", async () => {
    await renderWorkspace();

    expect(screen.getAllByTestId("sandbox")).toHaveLength(1);
  });

  it("mounts a later stage once it comes within reach", async () => {
    await renderWorkspace();
    await measureAndScroll({ scrollY: 700 });

    expect(screen.getAllByTestId("sandbox").length).toBeGreaterThan(1);
  });

  it("keeps a stage mounted after it scrolls back out of view", async () => {
    await renderWorkspace();
    await measureAndScroll({ scrollY: 700 });
    const mountedAfterScroll = screen.getAllByTestId("sandbox").length;

    await measureAndScroll({ scrollY: 0 });

    expect(screen.getAllByTestId("sandbox").length).toBe(mountedAfterScroll);
  });

  it("tolerates stage blocks reporting layout out of index order", async () => {
    // React Native gives no ordering guarantee between sibling `onLayout` callbacks. Firing them
    // highest-index-first is the ordering most likely to produce a hole in `boundsRef` if bounds
    // aren't pre-sized — a hole `computeStageVisibility` would throw on. If the workspace doesn't
    // pre-size, this test fails with that thrown error rather than a false assertion.
    await renderWorkspace();

    const scroll = screen.getByTestId("lesson-scroll");
    await fireEvent(scroll, "layout", { nativeEvent: { layout: { height: 600, width: 400 } } });

    const blocks = [...screen.getAllByTestId(/^stage-block-/).entries()].reverse();
    for (const [index, block] of blocks) {
      await fireEvent(block, "layout", {
        nativeEvent: { layout: { y: INTRO_OFFSET + index * 400, height: 400, width: 400 } },
      });
    }

    await fireEvent.scroll(scroll, {
      nativeEvent: {
        contentOffset: { y: 700, x: 0 },
        contentSize: { height: blocks.length * 400, width: 400 },
        layoutMeasurement: { height: 600, width: 400 },
      },
    });

    expect(screen.getAllByTestId("sandbox").length).toBeGreaterThan(1);
  });

  it("keeps a block that still occupies the top of the screen active, not scrolled past", async () => {
    // Regression for the coordinate-space bug: a block's `top` must be measured in the same
    // (content-relative) space as `scrollY`. At scrollY 500, block 0 (real content top
    // `INTRO_OFFSET` = 240, bottom 640) still occupies the top 140px of the 600pt viewport, so it
    // must stay active. Feeding the pre-fix, intro-less top (0, bottom 400) into this same
    // assertion makes it fail — `400 > 500` is false — which is exactly the bug finding 1 describes:
    // a block still on screen gets computed as scrolled past.
    await renderWorkspace();
    await measureAndScroll({ scrollY: 500 });

    const firstBlock = screen.getByTestId("stage-block-0");
    expect(within(firstBlock).getByText(/^active:/)).toBeTruthy();
  });

  it("stops the loop on previews that scrolled off-screen", async () => {
    await renderWorkspace();
    await measureAndScroll({ scrollY: 1400 });

    // `node.props.children` on the testID'd wrapper View is the `Text` element, not its rendered
    // string — RN's `Text` is itself a composite component under this jest preset, one level below
    // the host node the query returns. Asserting through `queryAllByText` reaches the actual string
    // regardless of that nesting and keeps the same intent: some mounted preview reports itself
    // inactive once it has scrolled off-screen.
    expect(screen.queryAllByText(/^inactive:/).length).toBeGreaterThan(0);
  });

  it("resets mounted previews when the lesson changes", async () => {
    // `otherLesson` is defined at module scope in this file and has two stages.
    const { props, view } = await renderWorkspace();
    await measureAndScroll({ scrollY: 700 });
    expect(screen.getAllByTestId("sandbox").length).toBeGreaterThan(1);

    await view.rerender(<LessonWorkspace {...props} lesson={otherLesson} />);

    expect(screen.getAllByTestId("sandbox")).toHaveLength(1);
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
