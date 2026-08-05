// `../../context/data-context` imports the AsyncStorage native module at module scope (used only by
// `DataProvider`'s real initialization path, not exercised here since these tests inject fake
// repositories directly through `DataContext.Provider`). That native module isn't available under
// plain Jest, so it needs the package's own documented mock swapped in before anything requires it
// transitively.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// The real `SafeAreaProvider` only renders its children after receiving a native `onInsetsChange`
// event, which never fires under Jest (no native module), so children would never mount. Swap in
// the package's own documented test mock, which provides insets synchronously instead.
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import HomeScreen from "../index";
import { CourseProvider } from "../../context/course-context";
import { DataContext, type DataContextValue } from "../../context/data-context";
import { ProgressProvider } from "../../context/progress-context";
import type { CourseRepository } from "../../data/course/course-repository";
import type { CourseLesson, CourseModule, CourseRelease } from "../../data/course/types";
import type { ProgressRepository } from "../../data/progress/progress-repository";
import {
  STUB_BUNDLED_RELEASE_ID,
  STUB_RELEASE_INSTALLER,
} from "../../data/course/testing/stub-release-installer";

jest.mock("expo-router", () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

function buildLesson(id: string, moduleId: string, position: number, title: string): CourseLesson {
  return {
    id,
    moduleId,
    position,
    title,
    shortTitle: title,
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

const module1: CourseModule = {
  id: "module-1",
  position: 0,
  status: "published",
  title: "Coordinate systems",
  description: "Module one",
  plannedLessonCount: 0,
  plannedTopics: [],
  lessons: [buildLesson("lesson-1a", "module-1", 0, "Coordinate spaces")],
};

const modules: CourseModule[] = [module1];

const activeRelease: CourseRelease = {
  id: "release-1",
  schemaVersion: 1,
  minimumAppVersion: "1.0.0",
  checksum: "checksum-1",
  modules,
};

class FakeCourseRepository implements CourseRepository {
  private readonly listeners = new Set<() => void>();
  private pendingReadError: Error | undefined;

  constructor(readError?: Error) {
    this.pendingReadError = readError;
  }

  async getActiveRelease(): Promise<CourseRelease> {
    return activeRelease;
  }

  async getModules(): Promise<CourseModule[]> {
    if (this.pendingReadError) {
      const error = this.pendingReadError;
      this.pendingReadError = undefined;
      throw error;
    }
    return modules;
  }

  async getLesson(lessonId: string): Promise<CourseLesson | null> {
    return modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === lessonId) ?? null;
  }

  async getPublishedLessonIds(): Promise<string[]> {
    return modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Arms the next `getModules()` call to reject, mirroring a refresh triggered after hydration
   * (e.g. by `emit()`) rather than the initial load. */
  failNextRead(error: Error): void {
    this.pendingReadError = error;
  }

  /** Notifies subscribers, mirroring `courseRepository.subscribe(...)` firing after hydration
   * (e.g. a release re-activation). */
  emit(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeProgressRepository implements ProgressRepository {
  private readonly listeners = new Set<() => void>();

  async getActiveProfileId(): Promise<string> {
    return "local-profile";
  }

  async getCompletedLessonIds(): Promise<string[]> {
    return [];
  }

  async isLessonCompleted(): Promise<boolean> {
    return false;
  }

  async setLessonCompleted(): Promise<void> {
    // Not exercised by this test.
  }

  async importLegacyCompletions(): Promise<void> {
    // Not exercised by this test.
  }

  async getPendingMutations() {
    return [];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function buildDataValue(courseReadError?: Error): DataContextValue {
  return {
    status: "ready",
    releaseInstaller: STUB_RELEASE_INSTALLER,
    bundledReleaseId: STUB_BUNDLED_RELEASE_ID,
    courseRepository: new FakeCourseRepository(courseReadError),
    progressRepository: new FakeProgressRepository(),
    retry: jest.fn(),
  };
}

async function renderHomeScreen(courseReadError?: Error) {
  const dataValue = buildDataValue(courseReadError);

  return render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <DataContext.Provider value={dataValue}>
        <CourseProvider>
          <ProgressProvider>
            <HomeScreen />
          </ProgressProvider>
        </CourseProvider>
      </DataContext.Provider>
    </SafeAreaProvider>,
  );
}

describe("HomeScreen", () => {
  test("shows a retry affordance instead of hanging on 'Loading curriculum…' when the course read fails", async () => {
    // Mirrors the CourseScreen regression: before Fix 2, a rejecting `getModules()` left
    // `isHydrated` false forever with no error and no way to recover.
    await renderHomeScreen(new Error("curriculum read failed"));

    await waitFor(() => expect(screen.getByText("Could not load curriculum")).toBeTruthy());
    expect(screen.getByText("curriculum read failed")).toBeTruthy();
    expect(screen.queryByText("Loading curriculum…")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    });

    await waitFor(() => expect(screen.getAllByText("Coordinate spaces").length).toBeGreaterThan(0));
    expect(screen.queryByText("Could not load curriculum")).toBeNull();
  });

  test("surfaces a retry affordance for a post-hydration course refresh failure without hiding hydrated content, and recovers via retry", async () => {
    // Mirrors the CourseScreen regression test: `courseError` was previously only read inside the
    // pre-hydration branch, so once `isHydrated` flips to `true` it never flips back (see
    // `course-context.tsx`), and a later rejection (e.g. from `courseRepository.subscribe(...)`
    // after a release re-activation) set `error` with nothing rendered anywhere. This first read
    // succeeds so the screen actually hydrates before the post-hydration rejection is injected.
    const dataValue = buildDataValue();
    if (dataValue.status !== "ready") throw new Error("expected a ready DataContextValue");
    const courseRepository = dataValue.courseRepository as FakeCourseRepository;

    async function renderScreen() {
      return render(
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <DataContext.Provider value={dataValue}>
            <CourseProvider>
              <ProgressProvider>
                <HomeScreen />
              </ProgressProvider>
            </CourseProvider>
          </DataContext.Provider>
        </SafeAreaProvider>,
      );
    }

    await renderScreen();

    await waitFor(() => expect(screen.getAllByText("Coordinate spaces").length).toBeGreaterThan(0));
    // Also wait for `ProgressProvider`'s own concurrent hydration (triggered by the same mount) to
    // settle, not just `CourseProvider`'s — otherwise its later, unrelated state update can land
    // after this `waitFor` has already stopped polling and produce an act() warning.
    await waitFor(() => expect(screen.queryByText("Loading progress…")).toBeNull());

    courseRepository.failNextRead(new Error("curriculum refresh failed"));

    courseRepository.emit();

    await waitFor(() => expect(screen.getByText("Could not refresh curriculum")).toBeTruthy());
    expect(screen.getByText("curriculum refresh failed")).toBeTruthy();
    // The hydrated view must stay up: stale content plus a visible error, not a swap back to the
    // pre-hydration loading branch.
    expect(screen.getAllByText("Coordinate spaces").length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    });

    await waitFor(() => expect(screen.queryByText("Could not refresh curriculum")).toBeNull());
    expect(screen.getAllByText("Coordinate spaces").length).toBeGreaterThan(0);
  });
});
