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
jest.mock("../../components/live-shader-preview", () => {
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

import bundledCourse from "../../../assets/course/bundled-course.json";

import LessonScreen from "../lesson";
import { CourseProvider } from "../../context/course-context";
import { DataContext } from "../../context/data-context";
import { ProgressProvider } from "../../context/progress-context";
import type { CourseRepository } from "../../data/course/course-repository";
import { parseCourseRelease } from "../../data/course/schema";
import type { CourseLesson, CourseModule, CourseRelease } from "../../data/course/types";
import type { ProgressMutation, ProgressRepository } from "../../data/progress/progress-repository";
import {
  STUB_BUNDLED_RELEASE_ID,
  STUB_RELEASE_INSTALLER,
} from "../../data/course/testing/stub-release-installer";

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

const publishedLessonIds = release.modules
  .filter((module) => module.status === "published")
  .flatMap((module) => module.lessons.map((lesson) => lesson.id));

class FakeCourseRepository implements CourseRepository {
  private readonly listeners = new Set<() => void>();

  constructor(private courseRelease: CourseRelease) {}

  /**
   * Stands in for `SqliteCourseRepository.onActiveReleaseChanged()` after a downloaded release is
   * activated: the curriculum behind every read is replaced, and subscribers are told once.
   */
  activateRelease(next: CourseRelease): void {
    this.courseRelease = next;
    for (const listener of this.listeners) {
      listener();
    }
  }

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
      value={{
        courseRepository,
        progressRepository,
        releaseInstaller: STUB_RELEASE_INSTALLER,
        bundledReleaseId: STUB_BUNDLED_RELEASE_ID,
        retry: () => {},
        status: "ready",
      }}
    >
      <CourseProvider>
        <ProgressProvider>
          <LessonScreen />
        </ProgressProvider>
      </CourseProvider>
    </DataContext.Provider>,
  );

  await waitFor(() => expect(screen.queryByText("Loading lesson…")).toBeNull());

  return { courseRepository, progressRepository };
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
    expect(screen.getByText("Module 01")).toBeTruthy();
    expect(screen.getByText("Fragment color")).toBeTruthy();
  });

  test("falls back to the current unlocked lesson for a locked deep link", async () => {
    await renderRoute({ lessonId: "color-light-challenge" });

    expect(screen.getByText("Coordinate Systems & UV Space")).toBeTruthy();
    expect(screen.queryByText("Color & Light Challenge")).toBeNull();
    expect(screen.getByText("1 of 5")).toBeTruthy();
  });

  test("falls back to the current unlocked lesson when only the module is locked", async () => {
    // `step-and-smoothstep` is position 1 within Module 2, so the lesson-unlock guard alone would
    // allow it (position-1 lessons are always unlocked within their module). With no completions,
    // Module 2 itself is locked because Module 1 isn't complete yet, so only the module-unlock
    // check blocks this deep link. This isolates that guard from the lesson-unlock guard, unlike
    // `color-light-challenge` above, which both guards already block.
    await renderRoute({ lessonId: "step-and-smoothstep" });

    expect(screen.getByText("Coordinate Systems & UV Space")).toBeTruthy();
    expect(screen.queryByText("Step & Smoothstep")).toBeNull();
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
    expect(screen.getByText("Module 02")).toBeTruthy();
    expect(screen.getByText("Shape field")).toBeTruthy();
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

  describe("when a newly activated release changes the published lesson set", () => {
    /** The bundled release with `mutate` applied to its modules, still a valid parsed release. */
    function releaseWithModules(modules: CourseModule[]): CourseRelease {
      return { ...release, modules };
    }

    /** Module 1 with only its first two lessons, so lessons 3..5 no longer exist anywhere. */
    function withModuleOneTruncated(): CourseRelease {
      return releaseWithModules(
        release.modules.map((module) =>
          module.id !== "coordinate-foundations"
            ? module
            : {
                ...module,
                lessons: module.lessons.filter((lesson) => lesson.position <= 2),
              },
        ),
      );
    }

    test("falls back to the current unlocked lesson when the open lesson was removed", async () => {
      // Open lesson 3 of Module 1 with lessons 1-2 complete, then publish a release that drops it.
      const { courseRepository } = await renderRoute({
        completedLessonIds: moduleOneLessonIds.slice(0, 2),
        lessonId: moduleOneLessonIds[2],
      });
      expect(screen.getByText("3 of 5")).toBeTruthy();

      await act(async () => {
        courseRepository.activateRelease(withModuleOneTruncated());
      });

      // Truncating Module 1 leaves it fully complete, so the learner's current lesson is now the
      // first lesson of Module 2 — resolved and rendered, never an error state.
      await waitFor(() => expect(screen.getByText("Step & Smoothstep")).toBeTruthy());
      expect(screen.getByText("Module 02")).toBeTruthy();
      expect(screen.getByText("1 of 5")).toBeTruthy();
      expect(screen.queryByText("This lesson is not available yet.")).toBeNull();
    });

    test("falls back to a reviewable last lesson when the removal completes the course", async () => {
      // The -1 case: with every remaining lesson complete, no module has a "next incomplete" lesson,
      // so the fallback has to resolve to a last lesson to review rather than to index -1.
      const { courseRepository } = await renderRoute({
        completedLessonIds: publishedLessonIds,
        lessonId: moduleOneLessonIds[2],
      });

      await act(async () => {
        courseRepository.activateRelease(withModuleOneTruncated());
      });

      await waitFor(() => expect(screen.getByText("Color & Light Challenge")).toBeTruthy());
      expect(screen.getByText("Module 03")).toBeTruthy();
      expect(screen.getByText("4 of 4")).toBeTruthy();
      expect(screen.queryByText("This lesson is not available yet.")).toBeNull();
    });

    test("reports the lesson as unavailable, without crashing, when every lesson is gone", async () => {
      const { courseRepository } = await renderRoute({ lessonId: moduleOneLessonIds[0] });

      await act(async () => {
        // A release with no published lessons at all: `featuredLesson` is null and the fallback has
        // nothing to resolve to. The route must say so rather than throw on a -1 index.
        courseRepository.activateRelease(
          releaseWithModules(
            release.modules.map((module) => ({
              ...module,
              status: "planned" as const,
              lessons: [],
              plannedLessonCount: 0,
              plannedTopics: [],
            })),
          ),
        );
      });

      await waitFor(() =>
        expect(screen.getByText("This lesson is not available yet.")).toBeTruthy(),
      );
    });
  });

  test("goes back from the lesson header", async () => {
    await renderRoute({ lessonId: "coordinate-systems-uv-space" });

    await fireEvent.press(screen.getByLabelText("Back"));

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
