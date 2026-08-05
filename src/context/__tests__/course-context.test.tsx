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
import {
  STUB_BUNDLED_RELEASE_ID,
  STUB_RELEASE_INSTALLER,
} from "../../data/course/testing/stub-release-installer";

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
    previewCaption: "Preview",
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

type FakeCourseRepository = CourseRepository & {
  emit: () => void;
  getActiveRelease: jest.MockedFunction<CourseRepository["getActiveRelease"]>;
  getModules: jest.MockedFunction<CourseRepository["getModules"]>;
};
type FakeProgressRepository = ProgressRepository & {
  emit: () => void;
  getCompletedLessonIds: jest.MockedFunction<ProgressRepository["getCompletedLessonIds"]>;
  setLessonCompleted: jest.MockedFunction<ProgressRepository["setLessonCompleted"]>;
};

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

/** A promise whose settlement is controlled from outside, so no microtask is scheduled until
 * `resolve`/`reject` is called explicitly. Used to make the pre-hydration window deterministically
 * observable: an unresolved promise cannot settle during the initial `renderHook` mount's act()
 * flush, unlike a `mockResolvedValue(...)`, which resolves on the microtask queue immediately. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
      releaseInstaller: STUB_RELEASE_INSTALLER,
      bundledReleaseId: STUB_BUNDLED_RELEASE_ID,
      courseRepository: fakeCourseRepository,
      progressRepository: fakeProgressRepository,
      retry: jest.fn(),
    };
  });

  test("hydrates modules from the course repository and refreshes after invalidation", async () => {
    // `isHydrated` starts `false` (see the `useState(false)` in course-context.tsx) and only flips
    // once `getModules`/`getActiveRelease` resolve. Use deferred promises (rather than
    // `mockResolvedValue`, which resolves on the microtask queue immediately and so would already
    // be settled by the time the initial `renderHook` mount's act() flush returns) so the
    // pre-hydration window is deterministically observable here.
    const modulesDeferred = createDeferred<CourseModule[]>();
    const activeReleaseDeferred = createDeferred<CourseRelease>();
    fakeCourseRepository.getModules.mockReturnValue(modulesDeferred.promise);
    fakeCourseRepository.getActiveRelease.mockReturnValue(activeReleaseDeferred.promise);

    const { result } = await renderHook(() => useCourse(), { wrapper: Wrapper });

    expect(result.current.isHydrated).toBe(false);
    expect(result.current.modules).toHaveLength(0);

    await act(async () => {
      modulesDeferred.resolve(modules);
      activeReleaseDeferred.resolve(activeRelease);
    });

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

  test("rolls back the optimistic update and rejects when the SQLite write fails", async () => {
    const { result } = await renderHook(() => useProgress(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.hasCompletedLesson("lesson-1a")).toBe(false);
    expect(result.current.progressPercent).toBe(0);

    fakeProgressRepository.setLessonCompleted.mockRejectedValueOnce(
      new Error("write failed"),
    );

    await act(async () => {
      // The write rejects; `setLessonCompletion` must roll back its optimistic update and
      // rethrow rather than swallow the failure (see progress-context.tsx's `setLessonCompletion`).
      await expect(result.current.completeLesson("lesson-1a")).rejects.toThrow("write failed");
    });

    // Rolled back: the optimistic completion never sticks, and the percentage is unchanged.
    expect(result.current.hasCompletedLesson("lesson-1a")).toBe(false);
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

  test("surfaces an error instead of hanging forever when the course read rejects, and recovers via retry", async () => {
    // Before Fix 2, `refresh()` was invoked with a bare `void`, so a rejection here left
    // `isHydrated` false forever with no way for the UI to observe or recover from it.
    fakeCourseRepository.getModules.mockRejectedValueOnce(new Error("course read failed"));

    const { result } = await renderHook(() => useCourse(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isHydrated).toBe(false);
    expect(result.current.error?.message).toBe("course read failed");

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.modules).toHaveLength(4);
  });

  test("surfaces an error instead of hanging forever when the progress read rejects, and recovers via retry", async () => {
    fakeProgressRepository.getCompletedLessonIds.mockRejectedValueOnce(
      new Error("progress read failed"),
    );

    const { result } = await renderHook(() => useProgress(), { wrapper: Wrapper });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isHydrated).toBe(false);
    expect(result.current.error?.message).toBe("progress read failed");

    await act(async () => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
