// The real `SafeAreaProvider` only renders children after a native `onInsetsChange` event, which
// never fires under Jest. Swap in the package's own documented test mock.
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

// The sandbox compiles GLSL through an `expo-gl` context, which no Jest environment provides. Stand
// in a view reporting the source it was handed, so the screen's contract stays observable — the same
// approach `lesson-workspace.test.tsx` takes with the preview.
jest.mock("../../components/shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text, View } = require("react-native") as typeof import("react-native");

  return {
    ShaderSandbox: ({ source }: { source: string }) =>
      React.createElement(View, { testID: "sandbox" }, React.createElement(Text, null, source)),
  };
});

jest.mock("expo-router", () => ({
  // Behaves like an ordinary mount effect rather than a no-op, so the focus-driven reloads these
  // screens use are actually exercised instead of silently skipped.
  useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]),
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import EditorScreen from "../editor";
import type { Sketch, SketchRepository } from "../../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE } from "../../data/sketches/starter-sketch";

let sketches: Sketch[] = [];

// Parameter lists are spelled out even where unused: `jest.Mocked<SketchRepository>` is invariant in
// them, so a zero-argument factory does not satisfy a three-argument method.
const repository: jest.Mocked<SketchRepository> = {
  list: jest.fn(async (_profileId: string) => sketches),
  get: jest.fn(
    async (_profileId: string, id: string) => sketches.find((sketch) => sketch.id === id) ?? null,
  ),
  create: jest.fn(async (_profileId: string, title: string, source: string) => {
    const sketch: Sketch = {
      id: `sketch-${sketches.length + 1}`,
      title,
      source,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z",
    };
    sketches = [sketch, ...sketches];
    return sketch;
  }),
  updateSource: jest.fn(async (_profileId: string, _id: string, _source: string): Promise<void> => {}),
  rename: jest.fn(async (_profileId: string, _id: string, _title: string): Promise<void> => {}),
  delete: jest.fn(async (_profileId: string, _id: string): Promise<void> => {}),
};

jest.mock("../../context/data-context", () => ({
  useData: () => ({
    status: "ready",
    sketchRepository: mockRepositoryRef.current,
    retry: jest.fn(),
  }),
}));

jest.mock("../../context/auth-context", () => ({
  useAuth: () => ({ profileId: "profile-a" }),
}));

// `jest.mock` factories may only close over `mock`-prefixed bindings, so the repository reaches the
// mocked context through this indirection rather than directly.
const mockRepositoryRef = { current: repository };

describe("EditorScreen", () => {
  beforeEach(() => {
    sketches = [];
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("creates and opens a starter sketch on first run", async () => {
    await render(<EditorScreen />);

    await waitFor(() => {
      expect(repository.create).toHaveBeenCalledWith(
        "profile-a",
        expect.any(String),
        STARTER_SKETCH_SOURCE,
      );
    });
    // A regex, not a string: `toHaveTextContent` matches strings exactly, and the starter shader is
    // many lines long.
    expect(screen.getByTestId("sandbox")).toHaveTextContent(/smoothstep/);
  });

  it("opens the most recently updated existing sketch", async () => {
    sketches = [
      {
        id: "sketch-9",
        title: "Recent",
        source: "fragColor = vec4(0.5);",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:10:00.000Z",
      },
    ];

    await render(<EditorScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("sandbox")).toHaveTextContent("fragColor = vec4(0.5);");
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("shows the open sketch's title", async () => {
    await render(<EditorScreen />);

    await waitFor(() => expect(screen.getByText("First shader")).toBeTruthy());
  });

  it("autosaves an edit after the debounce elapses", async () => {
    await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.25);");
    expect(repository.updateSource).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(repository.updateSource).toHaveBeenCalledWith(
      "profile-a",
      "sketch-1",
      "fragColor = vec4(0.25);",
    );
  });

  it("does not autosave before the debounce elapses", async () => {
    await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "a");
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(repository.updateSource).not.toHaveBeenCalled();
  });

  it("recompiles on its own shorter debounce, before autosave fires", async () => {
    await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.75);");
    await act(async () => {
      jest.advanceTimersByTime(350);
    });

    expect(screen.getByTestId("sandbox")).toHaveTextContent("fragColor = vec4(0.75);");
    expect(repository.updateSource).not.toHaveBeenCalled();
  });

  it("switches to another sketch and shows its source", async () => {
    sketches = [
      {
        id: "sketch-1",
        title: "One",
        source: "fragColor = vec4(0.1);",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:02:00.000Z",
      },
      {
        id: "sketch-2",
        title: "Two",
        source: "fragColor = vec4(0.2);",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:01:00.000Z",
      },
    ];

    await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("open-sketch-list")).toBeTruthy());

    await fireEvent.press(screen.getByTestId("open-sketch-list"));
    await act(async () => {
      await fireEvent.press(screen.getByText("Two"));
    });

    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);");
  });

  it("opens a replacement after the open sketch is deleted", async () => {
    sketches = [
      {
        id: "sketch-1",
        title: "One",
        source: "fragColor = vec4(0.1);",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:02:00.000Z",
      },
      {
        id: "sketch-2",
        title: "Two",
        source: "fragColor = vec4(0.2);",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:01:00.000Z",
      },
    ];
    repository.delete.mockImplementation(async (_profileId: string, id: string) => {
      sketches = sketches.filter((sketch) => sketch.id !== id);
    });

    await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("open-sketch-list")).toBeTruthy());

    await fireEvent.press(screen.getByTestId("open-sketch-list"));
    await act(async () => {
      await fireEvent.press(screen.getByLabelText("Delete One"));
    });

    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);");
  });

  it("unmounts the preview when collapsed and restores it on demand", async () => {
    await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("sandbox")).toBeTruthy());

    await fireEvent.press(screen.getByLabelText("Hide preview"));
    expect(screen.queryByTestId("sandbox")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Show preview"));
    expect(screen.getByTestId("sandbox")).toBeTruthy();
  });

  it("keeps the editor usable while the preview is collapsed", async () => {
    await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());

    await fireEvent.press(screen.getByLabelText("Hide preview"));

    expect(screen.getByTestId("glsl-input")).toBeTruthy();
  });

  it("surfaces a save failure without discarding the buffer", async () => {
    repository.updateSource.mockRejectedValueOnce(new Error("disk full"));
    await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.75);");
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("Could not save. Your code is still here.")).toBeTruthy();
    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.75);");
  });
});
