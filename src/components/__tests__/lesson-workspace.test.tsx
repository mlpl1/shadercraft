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

import LessonScreen from "../../app/lesson";
import { Colors } from "../../constants/theme";
import { CourseProvider } from "../../context/course-context";
import { DataContext } from "../../context/data-context";
import { ProgressProvider } from "../../context/progress-context";
import type { CourseRepository } from "../../data/course/course-repository";
import { parseCourseRelease } from "../../data/course/schema";
import type { CourseLesson, CourseModule, CourseRelease } from "../../data/course/types";
import type { ProgressMutation, ProgressRepository } from "../../data/progress/progress-repository";
import { LessonWorkspace, type LessonWorkspaceProps } from "../lesson-workspace";

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
let mockSearchParams: Record<string, string> = {};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => mockRouter,
}));

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

const colorLight = findModule("color-light");
const challengeLesson = findLesson("color-light-challenge");
const timeLesson = findLesson("uniforms-time");

const publishedLessonIds = release.modules
  .filter((module) => module.status === "published")
  .flatMap((module) => module.lessons.map((lesson) => lesson.id));

function textColorOf(text: string): string | undefined {
  return StyleSheet.flatten(screen.getByText(text).props.style)?.color;
}

function previewLabel(): string {
  return String(screen.getByTestId("live-shader-preview").props.accessibilityLabel);
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

describe("lesson workspace", () => {
  test("renders the lesson, its module context, and the first preset", async () => {
    await renderWorkspace();

    expect(screen.getByText(challengeLesson.title)).toBeTruthy();
    expect(screen.getByText(challengeLesson.intro)).toBeTruthy();
    expect(screen.getByText(challengeLesson.shortTitle)).toBeTruthy();
    expect(screen.getByText(colorLight.title)).toBeTruthy();
    expect(screen.getByText("4 of 4")).toBeTruthy();
    expect(screen.getByText("Palette albedo")).toBeTruthy();
    expect(previewLabel()).toBe("lighting-albedo#0");
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
    await renderWorkspace({
      lesson: timeLesson,
      lessonCount: 5,
      lessonIndex: 2,
      moduleTitle: "Coordinate Foundations",
    });

    expect(previewLabel()).toBe("time-static#0");

    await fireEvent.press(screen.getByText("Restart timeline"));

    expect(previewLabel()).toBe("time-static#1");
  });

  test("hides the restart control when no preview parameter requests it", async () => {
    await renderWorkspace();

    expect(screen.queryByText("Restart timeline")).toBeNull();
  });

  test("resets the selected preset when the workspace switches lesson", async () => {
    const { props, view } = await renderWorkspace({
      lesson: timeLesson,
      lessonCount: 5,
      lessonIndex: 2,
      moduleTitle: "Coordinate Foundations",
    });

    await fireEvent.press(screen.getByText("Double speed"));
    expect(previewLabel()).toBe("time-fast#0");

    await view.rerender(<LessonWorkspace {...props} lesson={challengeLesson} />);

    expect(previewLabel()).toBe("lighting-albedo#0");
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

class FakeCourseRepository implements CourseRepository {
  private readonly listeners = new Set<() => void>();

  constructor(private readonly courseRelease: CourseRelease) {}

  async getActiveRelease(): Promise<CourseRelease> {
    return this.courseRelease;
  }

  async getModules(): Promise<CourseModule[]> {
    return this.courseRelease.modules;
  }

  async getLesson(lessonId: string): Promise<CourseLesson | null> {
    return (
      this.courseRelease.modules
        .flatMap((module) => module.lessons)
        .find((lesson) => lesson.id === lessonId) ?? null
    );
  }

  async getPublishedLessonIds(): Promise<string[]> {
    return publishedLessonIds;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

class FakeProgressRepository implements ProgressRepository {
  private readonly listeners = new Set<() => void>();
  private readonly completed: Set<string>;

  constructor(
    completedLessonIds: readonly string[],
    private readonly writeError?: Error,
  ) {
    this.completed = new Set(completedLessonIds);
  }

  async getActiveProfileId(): Promise<string> {
    return "local-profile";
  }

  async getCompletedLessonIds(): Promise<string[]> {
    return [...this.completed];
  }

  async isLessonCompleted(lessonId: string): Promise<boolean> {
    return this.completed.has(lessonId);
  }

  async setLessonCompleted(lessonId: string, completed: boolean): Promise<void> {
    if (this.writeError) {
      throw this.writeError;
    }
    if (completed) {
      this.completed.add(lessonId);
    } else {
      this.completed.delete(lessonId);
    }
    for (const listener of this.listeners) {
      listener();
    }
  }

  async getPendingMutations(): Promise<ProgressMutation[]> {
    return [];
  }

  async importLegacyCompletions(): Promise<void> {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

async function renderRoute(
  options: { completedLessonIds?: string[]; lessonId?: string; writeError?: Error } = {},
) {
  mockSearchParams = options.lessonId ? { lessonId: options.lessonId } : {};

  const courseRepository = new FakeCourseRepository(release);
  const progressRepository = new FakeProgressRepository(
    options.completedLessonIds ?? [],
    options.writeError,
  );

  await render(
    <DataContext.Provider
      value={{ courseRepository, progressRepository, retry: () => {}, status: "ready" }}
    >
      <CourseProvider>
        <ProgressProvider>
          <LessonScreen />
        </ProgressProvider>
      </CourseProvider>
    </DataContext.Provider>,
  );

  await waitFor(() => expect(screen.queryByText("Loading lesson…")).toBeNull());
}

const moduleOneLessonIds = findModule("coordinate-foundations").lessons.map((lesson) => lesson.id);
const moduleTwoLessonIds = findModule("shape-synthesis").lessons.map((lesson) => lesson.id);

describe("lesson route", () => {
  beforeEach(() => {
    mockRouter.back.mockClear();
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
  });

  test("loads the requested unlocked lesson from the repository", async () => {
    await renderRoute({
      completedLessonIds: [moduleOneLessonIds[0]],
      lessonId: "colors-fragment-output",
    });

    expect(screen.getByText("Colors & Fragment Output")).toBeTruthy();
    expect(screen.getByText("2 of 5")).toBeTruthy();
    expect(screen.getByText("Coordinate Foundations")).toBeTruthy();
  });

  test("falls back to the current unlocked lesson for a locked deep link", async () => {
    await renderRoute({ lessonId: "color-light-challenge" });

    expect(screen.getByText("Coordinate Systems & UV Space")).toBeTruthy();
    expect(screen.queryByText("Color & Light Challenge")).toBeNull();
    expect(screen.getByText("1 of 5")).toBeTruthy();
  });

  test("falls back to the current unlocked lesson for an unknown lesson id", async () => {
    await renderRoute({ completedLessonIds: moduleOneLessonIds, lessonId: "tiling-space" });

    expect(screen.getByText("Step & Smoothstep")).toBeTruthy();
  });

  test("opens the current unlocked lesson when no lesson id is requested", async () => {
    await renderRoute({ completedLessonIds: [...moduleOneLessonIds, moduleTwoLessonIds[0]] });

    expect(screen.getByText("Circles & Boxes")).toBeTruthy();
    expect(screen.getByText("2 of 5")).toBeTruthy();
    expect(screen.getByText("Shape Synthesis")).toBeTruthy();
  });

  test("replaces the route with the next lesson after a completion", async () => {
    await renderRoute({ lessonId: "coordinate-systems-uv-space" });

    await fireEvent.press(screen.getByText("Mark lesson complete"));

    await waitFor(() => expect(screen.getByText("Continue to next lesson")).toBeTruthy());
    await fireEvent.press(screen.getByText("Continue to next lesson"));

    expect(mockRouter.replace).toHaveBeenCalledWith({
      params: { lessonId: "colors-fragment-output" },
      pathname: "/lesson",
    });
  });

  test("replaces the route with the course when the module ends", async () => {
    await renderRoute({
      completedLessonIds: [
        ...moduleOneLessonIds,
        ...moduleTwoLessonIds,
        "color-mixing",
        "luma-and-contrast",
        "procedural-palettes",
      ],
      lessonId: "color-light-challenge",
    });

    await fireEvent.press(screen.getByText("Mark lesson complete"));

    await waitFor(() => expect(screen.getByText("Return to course")).toBeTruthy());
    await fireEvent.press(screen.getByText("Return to course"));

    expect(mockRouter.replace).toHaveBeenCalledWith("/course");
  });

  test("keeps the lesson incomplete and offers a retry when the SQLite write fails", async () => {
    await renderRoute({
      lessonId: "coordinate-systems-uv-space",
      writeError: new Error("database is locked"),
    });

    await fireEvent.press(screen.getByText("Mark lesson complete"));

    await waitFor(() => expect(screen.getByText("Progress not saved")).toBeTruthy());
    expect(screen.getByText("Retry")).toBeTruthy();
    expect(screen.queryByText("Lesson complete")).toBeNull();
    expect(screen.getByText("Mark lesson complete")).toBeTruthy();
    expect(screen.queryByText("Completed · Tap to undo")).toBeNull();
  });

  test("goes back from the lesson header", async () => {
    await renderRoute({ lessonId: "coordinate-systems-uv-space" });

    await fireEvent.press(screen.getByLabelText("Back"));

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
