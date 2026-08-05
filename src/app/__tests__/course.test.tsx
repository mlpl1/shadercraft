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

// `CourseScreen` now reads `isCloudSyncEnabled()` directly to decide whether to show the account
// entry point. Mocked for the same reason `disabled-cloud-sync.test.tsx` and `account.test.tsx` mock
// it: importing the real module pulls in `react-native-url-polyfill/auto` and
// `expo-sqlite/localStorage/install` side effects this suite has no need to exercise, and this makes
// the button's visibility a behavioural assertion rather than a side effect of the test environment.
jest.mock("../../data/supabase/client", () => ({ isCloudSyncEnabled: jest.fn() }));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import CourseScreen from "../course";
import { CourseProvider } from "../../context/course-context";
import { DataContext, type DataContextValue } from "../../context/data-context";
import { ProgressProvider } from "../../context/progress-context";
import type { CourseRepository } from "../../data/course/course-repository";
import type { CourseLesson, CourseModule, CourseRelease } from "../../data/course/types";
import type { ProgressRepository } from "../../data/progress/progress-repository";
import { isCloudSyncEnabled } from "../../data/supabase/client";
import {
  STUB_BUNDLED_RELEASE_ID,
  STUB_RELEASE_INSTALLER,
} from "../../data/course/testing/stub-release-installer";

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}));

const mockIsCloudSyncEnabled = isCloudSyncEnabled as jest.MockedFunction<typeof isCloudSyncEnabled>;

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
  lessons: [
    buildLesson("lesson-1a", "module-1", 0, "Coordinate spaces"),
    buildLesson("lesson-1b", "module-1", 1, "Aspect ratio correction"),
  ],
};

const module2: CourseModule = {
  id: "module-2",
  position: 1,
  status: "published",
  title: "Color mixing",
  description: "Module two",
  plannedLessonCount: 0,
  plannedTopics: [],
  lessons: [buildLesson("lesson-2a", "module-2", 0, "Blending colors")],
};

const modules: CourseModule[] = [module1, module2];

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
  private readonly completed: Set<string>;

  constructor(completedLessonIds: readonly string[]) {
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

function buildDataValue(
  completedLessonIds: readonly string[],
  courseReadError?: Error,
): DataContextValue {
  return {
    status: "ready",
    releaseInstaller: STUB_RELEASE_INSTALLER,
    bundledReleaseId: STUB_BUNDLED_RELEASE_ID,
    courseRepository: new FakeCourseRepository(courseReadError),
    progressRepository: new FakeProgressRepository(completedLessonIds),
    retry: jest.fn(),
  };
}

async function renderCourseScreen(
  completedLessonIds: readonly string[],
  courseReadError?: Error,
) {
  const dataValue = buildDataValue(completedLessonIds, courseReadError);

  return render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <DataContext.Provider value={dataValue}>
        <CourseProvider>
          <ProgressProvider>
            <CourseScreen />
          </ProgressProvider>
        </CourseProvider>
      </DataContext.Provider>
    </SafeAreaProvider>,
  );
}

describe("CourseScreen", () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockIsCloudSyncEnabled.mockReturnValue(true);
  });

  test("shows an account button that navigates to /account when cloud sync is enabled", async () => {
    await renderCourseScreen(["lesson-1a"]);

    await waitFor(() => expect(screen.getByText("Coordinate systems")).toBeTruthy());

    const accountButton = screen.getByRole("button", { name: "Account" });
    fireEvent.press(accountButton);

    expect(mockRouter.push).toHaveBeenCalledWith("/account");
  });

  test("hides the account button when cloud sync is disabled", async () => {
    mockIsCloudSyncEnabled.mockReturnValue(false);

    await renderCourseScreen(["lesson-1a"]);

    await waitFor(() => expect(screen.getByText("Coordinate systems")).toBeTruthy());

    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  });

  test("tapping a fully complete module's card navigates to its last lesson", async () => {
    // Module one is fully complete: both of its lessons are in `completedLessonIds`. Before Fix 1,
    // `currentLessonIndex` was -1 for a complete module, so the card rendered no press target and
    // this tap was unreachable — the fallback in `openModule` was dead code.
    await renderCourseScreen(["lesson-1a", "lesson-1b"]);

    await waitFor(() => expect(screen.getByText("Coordinate systems")).toBeTruthy());

    const continueButton = screen.getByRole("button", { name: "Continue Aspect ratio correction" });
    fireEvent.press(continueButton);

    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: "/lesson",
      params: { lessonId: "lesson-1b" },
    });
  });

  test("shows a retry affordance instead of hanging on 'Loading curriculum…' when the course read fails", async () => {
    // Before Fix 2, `refresh()` in CourseProvider was invoked with a bare `void` and no `catch`,
    // so a rejecting read left `isHydrated` false forever with nothing on screen but the spinner
    // text — no error, no way to recover short of restarting the app.
    await renderCourseScreen([], new Error("curriculum read failed"));

    await waitFor(() => expect(screen.getByText("Could not load curriculum")).toBeTruthy());
    expect(screen.getByText("curriculum read failed")).toBeTruthy();
    expect(screen.queryByText("Loading curriculum…")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    });

    await waitFor(() => expect(screen.getByText("Coordinate systems")).toBeTruthy());
    expect(screen.queryByText("Could not load curriculum")).toBeNull();
  });

  test("surfaces a retry affordance for a post-hydration course refresh failure without hiding hydrated content, and recovers via retry", async () => {
    // `courseError` was previously only read inside the `!isCourseHydrated` branch. Once hydrated,
    // `isHydrated` never flips back to `false` (see `course-context.tsx`'s catch block), so a later
    // rejection — e.g. from `courseRepository.subscribe(...)` firing after a release
    // re-activation — set `error` with no affordance rendered anywhere. This first read succeeds
    // (unlike the sibling test above, which injects the rejection on the very first read) so the
    // screen actually hydrates before the second, post-hydration rejection is injected.
    const dataValue = buildDataValue(["lesson-1a"]);
    if (dataValue.status !== "ready") throw new Error("expected a ready DataContextValue");
    const courseRepository = dataValue.courseRepository as FakeCourseRepository;

    async function renderScreen() {
      return render(
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <DataContext.Provider value={dataValue}>
            <CourseProvider>
              <ProgressProvider>
                <CourseScreen />
              </ProgressProvider>
            </CourseProvider>
          </DataContext.Provider>
        </SafeAreaProvider>,
      );
    }

    await renderScreen();

    await waitFor(() => expect(screen.getByText("Coordinate systems")).toBeTruthy());
    // Also wait for `ProgressProvider`'s own concurrent hydration (triggered by the same mount) to
    // settle, not just `CourseProvider`'s — otherwise its later, unrelated state update can land
    // after this `waitFor` has already stopped polling and produce an act() warning.
    await waitFor(() => expect(screen.queryByText("—")).toBeNull());

    courseRepository.failNextRead(new Error("curriculum refresh failed"));

    courseRepository.emit();

    await waitFor(() => expect(screen.getByText("Could not refresh curriculum")).toBeTruthy());
    expect(screen.getByText("curriculum refresh failed")).toBeTruthy();
    // The hydrated view must stay up: stale content plus a visible error, not a swap back to the
    // pre-hydration loading branch.
    expect(screen.getByText("Coordinate systems")).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    });

    await waitFor(() => expect(screen.queryByText("Could not refresh curriculum")).toBeNull());
    expect(screen.getByText("Coordinate systems")).toBeTruthy();
  });
});
