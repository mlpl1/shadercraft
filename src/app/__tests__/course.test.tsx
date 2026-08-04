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

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import CourseScreen from "../course";
import { CourseProvider } from "../../context/course-context";
import { DataContext, type DataContextValue } from "../../context/data-context";
import { ProgressProvider } from "../../context/progress-context";
import type { CourseRepository } from "../../data/course/course-repository";
import type { CourseLesson, CourseModule, CourseRelease } from "../../data/course/types";
import type { ProgressRepository } from "../../data/progress/progress-repository";

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
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

  async getActiveRelease(): Promise<CourseRelease> {
    return activeRelease;
  }

  async getModules(): Promise<CourseModule[]> {
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

function buildDataValue(completedLessonIds: readonly string[]): DataContextValue {
  return {
    status: "ready",
    courseRepository: new FakeCourseRepository(),
    progressRepository: new FakeProgressRepository(completedLessonIds),
    retry: jest.fn(),
  };
}

async function renderCourseScreen(completedLessonIds: readonly string[]) {
  const dataValue = buildDataValue(completedLessonIds);

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
});
