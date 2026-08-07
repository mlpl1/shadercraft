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
jest.mock("../../components/shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");

  return {
    ShaderSandbox: () => React.createElement(View, { testID: "sandbox" }),
  };
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import LessonScreen from "../lesson";
import { CourseProvider } from "../../context/course-context";
import { DataContext } from "../../context/data-context";
import { ProgressProvider } from "../../context/progress-context";
import type { CourseRepository } from "../../data/course/course-repository";
import type { CourseLesson, CourseModule, CourseRelease } from "../../data/course/types";
import type { ProgressMutation, ProgressRepository } from "../../data/progress/progress-repository";
import { createFakeSketchRepository } from "../../data/sketches/testing/fake-sketch-repository";
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

/**
 * `LessonScreen`'s route-resolution logic (lesson/module locking, "what opens next") only reads
 * position and status, never prose or stages. Building a synthetic release here — rather than
 * importing the real bundled course — keeps these tests independent of how many modules and
 * lessons are currently authored, and lets each scenario (a locked module, a lesson mid-module, a
 * course that ends) be sized exactly as the test needs. `ShaderSandbox` is mocked above, so the
 * single placeholder stage per lesson is never actually rendered.
 */
function buildLesson(id: string, moduleId: string, position: number, title: string): CourseLesson {
  return {
    id,
    moduleId,
    position,
    // Distinct from `shortTitle` (as real content is) so a lesson's header label and its intro
    // heading never collide under an exact-text query.
    title: `${title} in depth`,
    shortTitle: title,
    intro: "",
    takeaway: "",
    stages: [
      {
        id: `${id}-stage-1`,
        position: 1,
        title: "",
        body: "",
        source: "fragColor = vec4(0.0, 0.0, 0.0, 1.0);",
      },
    ],
  };
}

function buildModule(
  id: string,
  position: number,
  title: string,
  lessonTitles: readonly string[],
): CourseModule {
  return {
    id,
    position,
    status: "published",
    title,
    description: "",
    plannedLessonCount: 0,
    plannedTopics: [],
    lessons: lessonTitles.map((lessonTitle, index) =>
      buildLesson(`${id}-lesson-${index + 1}`, id, index + 1, lessonTitle),
    ),
  };
}

// Module 1 has three lessons (enough to exercise mid-module locking and a lesson removal), module 2
// has two, and module 3 has a single lesson that is the last lesson of the whole course.
const moduleOne = buildModule("module-1", 1, "Coordinate Foundations", [
  "Coordinate Spaces",
  "Aspect Ratio Correction",
  "Screen Space Mapping",
]);
const moduleTwo = buildModule("module-2", 2, "Shape Synthesis", ["Circles & Boxes", "Step & Smoothstep"]);
const moduleThree = buildModule("module-3", 3, "Color & Light", ["Color & Light Challenge"]);

const modules: CourseModule[] = [moduleOne, moduleTwo, moduleThree];

const release: CourseRelease = {
  id: "release-1",
  schemaVersion: 1,
  minimumAppVersion: "1.0.0",
  checksum: "checksum-1",
  modules,
};

const moduleOneLessonIds = moduleOne.lessons.map((lesson) => lesson.id);
const moduleTwoLessonIds = moduleTwo.lessons.map((lesson) => lesson.id);
const moduleThreeLessonIds = moduleThree.lessons.map((lesson) => lesson.id);
const publishedLessonIds = [...moduleOneLessonIds, ...moduleTwoLessonIds, ...moduleThreeLessonIds];

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
    return this.courseRelease.modules
      .filter((module) => module.status === "published")
      .flatMap((module) => module.lessons.map((lesson) => lesson.id));
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
        sketchRepository: createFakeSketchRepository(),
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

describe("lesson route", () => {
  beforeEach(() => {
    mockRouter.back.mockClear();
    mockRouter.push.mockClear();
    mockRouter.replace.mockClear();
  });

  test("loads the requested unlocked lesson from the repository", async () => {
    await renderRoute({
      completedLessonIds: [moduleOneLessonIds[0]],
      lessonId: moduleOneLessonIds[1],
    });

    expect(screen.getByText("Aspect Ratio Correction")).toBeTruthy();
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getByText("Module 01")).toBeTruthy();
  });

  test("falls back to the current unlocked lesson for a locked deep link", async () => {
    await renderRoute({ lessonId: moduleThreeLessonIds[0] });

    expect(screen.getByText("Coordinate Spaces")).toBeTruthy();
    expect(screen.queryByText("Color & Light Challenge")).toBeNull();
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });

  test("falls back to the current unlocked lesson when only the module is locked", async () => {
    // `module-2-lesson-1` is position 1 within module two, so the lesson-unlock guard alone would
    // allow it (position-1 lessons are always unlocked within their module). With no completions,
    // module two itself is locked because module one isn't complete yet, so only the module-unlock
    // check blocks this deep link. This isolates that guard from the lesson-unlock guard, unlike
    // the module-three deep link above, which both guards already block.
    await renderRoute({ lessonId: moduleTwoLessonIds[0] });

    expect(screen.getByText("Coordinate Spaces")).toBeTruthy();
    expect(screen.queryByText("Circles & Boxes")).toBeNull();
    expect(screen.getByText("1 of 3")).toBeTruthy();
  });

  test("falls back to the current unlocked lesson for an unknown lesson id", async () => {
    await renderRoute({ completedLessonIds: moduleOneLessonIds, lessonId: "does-not-exist" });

    expect(screen.getByText("Circles & Boxes")).toBeTruthy();
  });

  test("opens the current unlocked lesson when no lesson id is requested", async () => {
    await renderRoute({ completedLessonIds: [...moduleOneLessonIds, moduleTwoLessonIds[0]] });

    expect(screen.getByText("Step & Smoothstep")).toBeTruthy();
    expect(screen.getByText("2 of 2")).toBeTruthy();
    expect(screen.getByText("Module 02")).toBeTruthy();
  });

  test("replaces the route with the next lesson after a completion", async () => {
    await renderRoute({ lessonId: moduleOneLessonIds[0] });

    await fireEvent.press(screen.getByText("Mark lesson complete"));

    await waitFor(() => expect(screen.getByText("Continue to next lesson")).toBeTruthy());
    await fireEvent.press(screen.getByText("Continue to next lesson"));

    expect(mockRouter.replace).toHaveBeenCalledWith({
      params: { lessonId: moduleOneLessonIds[1] },
      pathname: "/lesson",
    });
  });

  test("replaces the route with the course when the module ends", async () => {
    await renderRoute({
      completedLessonIds: [...moduleOneLessonIds, ...moduleTwoLessonIds],
      lessonId: moduleThreeLessonIds[0],
    });

    await fireEvent.press(screen.getByText("Mark lesson complete"));

    await waitFor(() => expect(screen.getByText("Return to course")).toBeTruthy());
    await fireEvent.press(screen.getByText("Return to course"));

    expect(mockRouter.replace).toHaveBeenCalledWith("/course");
  });

  test("keeps the lesson incomplete and offers a retry when the SQLite write fails", async () => {
    await renderRoute({
      lessonId: moduleOneLessonIds[0],
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
    /** The synthetic release with `mutate` applied to its modules, still a valid `CourseRelease`. */
    function releaseWithModules(nextModules: CourseModule[]): CourseRelease {
      return { ...release, modules: nextModules };
    }

    /** Module one with only its first two lessons, so lesson 3 no longer exists anywhere. */
    function withModuleOneTruncated(): CourseRelease {
      return releaseWithModules(
        modules.map((module) =>
          module.id !== moduleOne.id
            ? module
            : { ...module, lessons: module.lessons.filter((lesson) => lesson.position <= 2) },
        ),
      );
    }

    test("falls back to the current unlocked lesson when the open lesson was removed", async () => {
      // Open lesson 3 of module one with lessons 1-2 complete, then publish a release that drops it.
      const { courseRepository } = await renderRoute({
        completedLessonIds: moduleOneLessonIds.slice(0, 2),
        lessonId: moduleOneLessonIds[2],
      });
      expect(screen.getByText("3 of 3")).toBeTruthy();

      await act(async () => {
        courseRepository.activateRelease(withModuleOneTruncated());
      });

      // Truncating module one leaves it fully complete, so the learner's current lesson is now the
      // first lesson of module two — resolved and rendered, never an error state.
      await waitFor(() => expect(screen.getByText("Circles & Boxes")).toBeTruthy());
      expect(screen.getByText("Module 02")).toBeTruthy();
      expect(screen.getByText("1 of 2")).toBeTruthy();
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
      expect(screen.getByText("1 of 1")).toBeTruthy();
      expect(screen.queryByText("This lesson is not available yet.")).toBeNull();
    });

    test("reports the lesson as unavailable, without crashing, when every lesson is gone", async () => {
      const { courseRepository } = await renderRoute({ lessonId: moduleOneLessonIds[0] });

      await act(async () => {
        // A release with no published lessons at all: `featuredLesson` is null and the fallback has
        // nothing to resolve to. The route must say so rather than throw on a -1 index.
        courseRepository.activateRelease(
          releaseWithModules(
            modules.map((module) => ({
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
    await renderRoute({ lessonId: moduleOneLessonIds[0] });

    await fireEvent.press(screen.getByLabelText("Back"));

    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
