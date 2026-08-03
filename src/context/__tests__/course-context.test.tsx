// `../data-context` imports the AsyncStorage native module at module scope (used only by
// `DataProvider`'s real initialization path, not exercised here since these tests inject fake
// repositories directly through `DataContext.Provider`). That native module isn't available under
// plain Jest, so it needs the package's own documented mock swapped in before anything requires it
// transitively.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import type { CourseRepository } from "../../data/course/course-repository";
import type { CourseLesson, CourseModule, CourseRelease } from "../../data/course/types";
import type { ProgressRepository } from "../../data/progress/progress-repository";
import { CourseProvider, useCourse } from "../course-context";
import { DataContext, type DataContextValue } from "../data-context";
import { ProgressProvider, useProgress } from "../progress-context";

function buildLesson(id: string, moduleId: string, position: number): CourseLesson {
  return {
    id,
    moduleId,
    position,
    title: id,
    shortTitle: id,
    intro: "",
    conceptTitle: "",
    conceptLede: "",
    tryHint: "",
    takeaway: "",
    presets: [],
    sections: [],
  };
}

function buildModule(
  id: string,
  position: number,
  status: CourseModule["status"],
  lessonIds: string[],
): CourseModule {
  return {
    id,
    position,
    status,
    title: id,
    description: "",
    plannedLessonCount: status === "planned" ? 3 : 0,
    plannedTopics: [],
    lessons: lessonIds.map((lessonId, index) => buildLesson(lessonId, id, index)),
  };
}

const modules: CourseModule[] = [
  buildModule("module-1", 0, "published", ["lesson-1a", "lesson-1b"]),
  buildModule("module-2", 1, "published", ["lesson-2a"]),
  buildModule("module-3", 2, "published", ["lesson-3a"]),
  buildModule("module-4", 3, "planned", []),
];

const activeRelease: CourseRelease = {
  id: "release-1",
  schemaVersion: 1,
  minimumAppVersion: "1.0.0",
  checksum: "checksum-1",
  modules,
};

const publishedLessonIds = ["lesson-1a", "lesson-1b", "lesson-2a", "lesson-3a"];

type FakeCourseRepository = CourseRepository & { emit: () => void };
type FakeProgressRepository = ProgressRepository & { emit: () => void };

function createFakeCourseRepository(): FakeCourseRepository {
  const listeners = new Set<() => void>();

  return {
    getActiveRelease: jest.fn().mockResolvedValue(activeRelease),
    getModules: jest.fn().mockResolvedValue(modules),
    getLesson: jest.fn(async (lessonId: string) =>
      modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === lessonId) ?? null,
    ),
    getPublishedLessonIds: jest.fn().mockResolvedValue(publishedLessonIds),
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit: () => {
      for (const listener of listeners) listener();
    },
  };
}

function createFakeProgressRepository(): FakeProgressRepository {
  const listeners = new Set<() => void>();
  let completedLessonIds: string[] = [];

  return {
    getActiveProfileId: jest.fn().mockResolvedValue("fake-profile"),
    getCompletedLessonIds: jest.fn(async () => completedLessonIds),
    isLessonCompleted: jest.fn(async (lessonId: string) => completedLessonIds.includes(lessonId)),
    setLessonCompleted: jest.fn(async (lessonId: string, completed: boolean) => {
      completedLessonIds = completed
        ? [...completedLessonIds, lessonId]
        : completedLessonIds.filter((completedLessonId) => completedLessonId !== lessonId);
      for (const listener of listeners) listener();
    }),
    importLegacyCompletions: jest.fn().mockResolvedValue(undefined),
    getPendingMutations: jest.fn().mockResolvedValue([]),
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit: () => {
      for (const listener of listeners) listener();
    },
  };
}

describe("course and progress providers", () => {
  let fakeCourseRepository: FakeCourseRepository;
  let fakeProgressRepository: FakeProgressRepository;
  let dataValue: DataContextValue;

  function Wrapper({ children }: PropsWithChildren) {
    return (
      <DataContext.Provider value={dataValue}>
        <CourseProvider>
          <ProgressProvider>{children}</ProgressProvider>
        </CourseProvider>
      </DataContext.Provider>
    );
  }

  beforeEach(() => {
    fakeCourseRepository = createFakeCourseRepository();
    fakeProgressRepository = createFakeProgressRepository();
    dataValue = {
      status: "ready",
      courseRepository: fakeCourseRepository,
      progressRepository: fakeProgressRepository,
      retry: jest.fn(),
    };
  });

  test("hydrates modules from the course repository and refreshes after invalidation", async () => {
    // `isHydrated` starts `false` (see the `useState(false)` in course-context.tsx) and only flips
    // once `getModules`/`getActiveRelease` resolve; this test renderer's initial `renderHook` mount
    // already flushes that microtask chain to completion, so the pre-hydration window itself isn't
    // observable here. What we can and do assert is the eventual hydrated state, plus the refetch
    // that a subscription notification must trigger.
    const { result } = await renderHook(() => useCourse(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.modules).toHaveLength(4));
    expect(result.current.isHydrated).toBe(true);
    expect(result.current.activeRelease).toEqual(activeRelease);
    expect(fakeCourseRepository.getModules).toHaveBeenCalledTimes(1);

    await act(() => fakeCourseRepository.emit());
    await waitFor(() => expect(fakeCourseRepository.getModules).toHaveBeenCalledTimes(2));
  });

  test("resolves a lesson by ID once modules have hydrated", async () => {
    const { result } = await renderHook(() => useCourse(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.modules).toHaveLength(4));

    expect(result.current.getLesson("lesson-2a")).toMatchObject({
      id: "lesson-2a",
      moduleId: "module-2",
    });
    expect(result.current.getLesson("missing-lesson")).toBeNull();
  });

  test("retains the completeLesson/uncompleteLesson signatures and persists through the repository", async () => {
    const { result } = await renderHook(() => useProgress(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.progress).toEqual({ completedLessonIds: [], version: 1 });

    // Retains the existing `(lessonId: string) => Promise<void>` signatures.
    const completeLessonSignature: (lessonId: string) => Promise<void> = result.current.completeLesson;
    const uncompleteLessonSignature: (lessonId: string) => Promise<void> =
      result.current.uncompleteLesson;
    expect(completeLessonSignature).toBeInstanceOf(Function);
    expect(uncompleteLessonSignature).toBeInstanceOf(Function);

    await act(async () => {
      // Read `result.current` fresh at call time rather than reusing the signature check above:
      // it's memoized per render, and calling a stale closure after a completion changes state
      // would silently no-op against the pre-change snapshot instead of exercising a real update.
      await result.current.completeLesson("lesson-1a");
    });

    expect(fakeProgressRepository.setLessonCompleted).toHaveBeenCalledWith("lesson-1a", true);
    await waitFor(() => expect(result.current.hasCompletedLesson("lesson-1a")).toBe(true));
    expect(result.current.progressPercent).toBe(25);

    await act(async () => {
      await result.current.uncompleteLesson("lesson-1a");
    });

    expect(fakeProgressRepository.setLessonCompleted).toHaveBeenCalledWith("lesson-1a", false);
    await waitFor(() => expect(result.current.hasCompletedLesson("lesson-1a")).toBe(false));
    expect(result.current.progressPercent).toBe(0);
  });

  test("refreshes completed lesson IDs when the course repository invalidates", async () => {
    const { result } = await renderHook(() => useProgress(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(fakeProgressRepository.getCompletedLessonIds).toHaveBeenCalledTimes(1);

    await act(() => fakeCourseRepository.emit());

    await waitFor(() =>
      expect(fakeProgressRepository.getCompletedLessonIds).toHaveBeenCalledTimes(2),
    );
  });
});
