jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

jest.mock("../../components/glsl-input", () => {
  const React = require("react") as typeof import("react");
  const { Text } = require("react-native") as typeof import("react-native");
  return {
    GlslInput: jest.fn((props: Record<string, unknown>) =>
      React.createElement(Text, { testID: "tutorial-glsl-input" }, String(props.initialValue ?? "")),
    ),
  };
});

jest.mock("../../components/shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text } = require("react-native") as typeof import("react-native");
  return {
    ShaderSandbox: ({ source }: { source: string }) =>
      React.createElement(Text, { testID: "sandbox-source" }, source),
  };
});

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockRouteParams = { current: { tutorialId: "pulse", stepId: "pulse-s1" } };

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockRouteParams.current,
  useRouter: () => mockRouter,
}));

jest.mock("../../context/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../context/course-context", () => ({ useCourse: jest.fn() }));
jest.mock("../../context/data-context", () => ({ useData: jest.fn() }));
jest.mock("../../context/settings-context", () => ({ useSettings: jest.fn() }));

import { render, screen, waitFor } from "@testing-library/react-native";

import TutorialScreen from "../tutorial";
import { GlslInput } from "../../components/glsl-input";
import { useAuth } from "../../context/auth-context";
import { useCourse } from "../../context/course-context";
import { useData } from "../../context/data-context";
import { useSettings } from "../../context/settings-context";
import type { CourseModule } from "../../data/course/types";

const mockGlslInput = GlslInput as jest.MockedFunction<typeof GlslInput>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseCourse = useCourse as jest.MockedFunction<typeof useCourse>;
const mockUseData = useData as jest.MockedFunction<typeof useData>;
const mockUseSettings = useSettings as jest.MockedFunction<typeof useSettings>;
const mockUpdateSettings = jest.fn(async () => undefined);

const modules: CourseModule[] = [
  {
    id: "m1",
    position: 1,
    status: "published",
    title: "Fragments",
    description: "d",
    plannedLessonCount: 0,
    plannedTopics: [],
    lessons: [],
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
            brief: "Change the shader.",
            starterSource: "fragColor = vec4(0.0);",
            solutionSource: "fragColor = vec4(1.0);",
          },
        ],
      },
    ],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockRouteParams.current = { tutorialId: "pulse", stepId: "pulse-s1" };
  mockUseAuth.mockReturnValue({ profileId: "profile-a" } as ReturnType<typeof useAuth>);
  mockUseCourse.mockReturnValue({ modules } as ReturnType<typeof useCourse>);
  mockUseData.mockReturnValue({
    status: "ready",
    tutorialProgressRepository: {
      getStates: jest.fn(async () => new Map()),
      saveDraft: jest.fn(async () => undefined),
      setCompleted: jest.fn(async () => undefined),
    },
  } as unknown as ReturnType<typeof useData>);
  mockUseSettings.mockReturnValue({
    settings: {
      version: 1,
      editorFontSize: 16,
      showEditorLineNumbers: false,
      previewPerformance: "full-speed",
      editorPreviewMode: "responsive",
    },
    hydrated: true,
    error: null,
    retry: jest.fn(),
    update: mockUpdateSettings,
  });
});

test("passes editor typography preferences to the tutorial GLSL input", async () => {
  await render(<TutorialScreen />);

  await waitFor(() => expect(screen.getByText("Step one")).toBeTruthy());
  expect(mockGlslInput).toHaveBeenCalledWith(
    expect.objectContaining({ fontSize: 16, showLineNumbers: false }),
    undefined,
  );
});