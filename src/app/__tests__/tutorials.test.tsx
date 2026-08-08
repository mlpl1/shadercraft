jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  // Behaves like an ordinary mount effect rather than a no-op, so the focus-driven reload this
  // screen depends on is actually exercised.
  useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock("../../context/auth-context", () => ({
  useAuth: () => ({ profileId: "profile-a" }),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import TutorialsScreen from "../tutorials";
import { CourseProvider } from "../../context/course-context";
import { DataContext, type DataContextValue } from "../../context/data-context";
import { ProgressProvider } from "../../context/progress-context";
import type { CourseRepository } from "../../data/course/course-repository";
import type { CourseLesson, CourseModule, CourseRelease } from "../../data/course/types";
import type { ProgressRepository } from "../../data/progress/progress-repository";
import { createFakeSketchRepository } from "../../data/sketches/testing/fake-sketch-repository";
import { createFakeTutorialProgressRepository } from "../../data/tutorials/testing/fake-tutorial-progress-repository";
import {
  STUB_BUNDLED_RELEASE_ID,
  STUB_RELEASE_INSTALLER,
} from "../../data/course/testing/stub-release-installer";

const MODULES: CourseModule[] = [
  {
    id: "m1",
    position: 1,
    status: "published",
    title: "Fragments",
    description: "d",
    plannedLessonCount: 0,
    plannedTopics: [],
    lessons: [
      {
        id: "m1-l1",
        moduleId: "m1",
        position: 1,
        title: "L1",
        shortTitle: "L1",
        intro: "i",
        takeaway: "t",
        stages: [],
      },
    ],
    tutorials: [
      {
        id: "pulse",
        moduleId: "m1",
        position: 1,
        title: "Make it pulse",
        summary: "Drive a radius from time.",
        steps: [
          {
            id: "pulse-s1",
            position: 1,
            title: "Step one",
            brief: "b",
            starterSource: "a",
            solutionSource: "b",
          },
          {
            id: "pulse-s2",
            position: 2,
            title: "Step two",
            brief: "b",
            starterSource: "a",
            solutionSource: "b",
          },
        ],
      },
    ],
  },
  {
    id: "m2",
    position: 2,
    status: "published",
    title: "Shaping",
    description: "d",
    plannedLessonCount: 0,
    plannedTopics: [],
    lessons: [
      {
        id: "m2-l1",
        moduleId: "m2",
        position: 1,
        title: "L1",
        shortTitle: "L1",
        intro: "i",
        takeaway: "t",
        stages: [],
      },
    ],
    tutorials: [
      {
        id: "bands",
        moduleId: "m2",
        position: 1,
        title: "Banding",
        summary: "Split a gradient.",
        steps: [
          {
            id: "bands-s1",
            position: 1,
            title: "Step one",
            brief: "b",
            starterSource: "a",
            solutionSource: "b",
          },
        ],
      },
    ],
  },
];

const RELEASE: CourseRelease = {
  id: "r1",
  schemaVersion: 1,
  minimumAppVersion: "1.0.0",
  checksum: "c",
  modules: MODULES,
};

class FakeCourseRepository implements CourseRepository {
  async getActiveRelease(): Promise<CourseRelease> {
    return RELEASE;
  }
  async getModules(): Promise<CourseModule[]> {
    return MODULES;
  }
  async getLesson(lessonId: string): Promise<CourseLesson | null> {
    return MODULES.flatMap(({ lessons }) => lessons).find(({ id }) => id === lessonId) ?? null;
  }
  async getPublishedLessonIds(): Promise<string[]> {
    return MODULES.flatMap(({ lessons }) => lessons.map(({ id }) => id));
  }
  subscribe(): () => void {
    return () => {};
  }
}

class FakeProgressRepository implements ProgressRepository {
  constructor(private readonly completed: readonly string[]) {}
  async getActiveProfileId() {
    return "profile-a";
  }
  async getCompletedLessonIds() {
    return [...this.completed];
  }
  async isLessonCompleted(lessonId: string) {
    return this.completed.includes(lessonId);
  }
  async setLessonCompleted() {}
  async importLegacyCompletions() {}
  async getPendingMutations() {
    return [];
  }
  subscribe(): () => void {
    return () => {};
  }
}

const renderScreen = async (completedLessonIds: string[], completedStepIds: string[] = []) => {
  const dataValue: DataContextValue = {
    status: "ready",
    releaseInstaller: STUB_RELEASE_INSTALLER,
    bundledReleaseId: STUB_BUNDLED_RELEASE_ID,
    courseRepository: new FakeCourseRepository(),
    progressRepository: new FakeProgressRepository(completedLessonIds),
    sketchRepository: createFakeSketchRepository(),
    tutorialProgressRepository: createFakeTutorialProgressRepository(
      completedStepIds.map((stepId) => ({
        profileId: "profile-a",
        stepId,
        state: { completed: true },
      })),
    ),
    retry: jest.fn(),
  };

  await render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <DataContext.Provider value={dataValue}>
        <CourseProvider>
          <ProgressProvider>
            <TutorialsScreen />
          </ProgressProvider>
        </CourseProvider>
      </DataContext.Provider>
    </SafeAreaProvider>,
  );
};

beforeEach(() => {
  mockPush.mockClear();
});

it("locks every exercise until its own module is finished", async () => {
  await renderScreen([]);

  await waitFor(() => expect(screen.getByText("Make it pulse")).toBeTruthy());

  // Both are locked, and the copy says what to do about it rather than only that they are shut.
  expect(screen.getAllByText("Locked")).toHaveLength(2);
  expect(screen.getByText("Finish Fragments to unlock this.")).toBeTruthy();
});

it("unlocks only the exercise whose module is complete", async () => {
  await renderScreen(["m1-l1"]);

  await waitFor(() => expect(screen.getByText("Make it pulse")).toBeTruthy());

  expect(screen.getAllByText("Locked")).toHaveLength(1);
  expect(screen.getByText("0/2")).toBeTruthy();
});

it("shows how far into an exercise the learner is", async () => {
  await renderScreen(["m1-l1"], ["pulse-s1"]);

  await waitFor(() => expect(screen.getByText("1/2")).toBeTruthy());
});

it("opens an unlocked exercise on the step the learner stopped at", async () => {
  await renderScreen(["m1-l1"], ["pulse-s1"]);

  await waitFor(() => expect(screen.getByText("1/2")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("tutorial-card-pulse"));

  // Step one is done, so the learner resumes on step two rather than the start.
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/tutorial",
    params: { tutorialId: "pulse", stepId: "pulse-s2" },
  });
});

it("does not open a locked exercise", async () => {
  await renderScreen([]);

  await waitFor(() => expect(screen.getByText("Banding")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("tutorial-card-bands"));

  expect(mockPush).not.toHaveBeenCalled();
});
