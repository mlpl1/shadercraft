// The real SafeAreaProvider waits for a native inset event that Jest never sends.
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

jest.mock("@react-native-community/slider", () => "Slider");

// Route tests keep the GL boundary mocked, but expose every editor-to-sandbox input and the compile
// callback so the screen's integration contract remains observable.
jest.mock("../../components/shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text, View } = require("react-native") as typeof import("react-native");
  const SandboxView = View as unknown as React.ComponentType<Record<string, unknown>>;

  return {
    ShaderSandbox: ({
      source,
      parameters = [],
      paused,
      restartToken,
      onCompileResult,
    }: {
      source: string;
      parameters?: unknown[];
      paused?: boolean;
      restartToken?: number;
      onCompileResult?: (result: unknown) => void;
    }) =>
      React.createElement(
        SandboxView,
        { onCompileResult, testID: "sandbox" },
        React.createElement(Text, { testID: "sandbox-source" }, source),
        React.createElement(Text, { testID: "sandbox-parameters" }, JSON.stringify(parameters)),
        React.createElement(Text, { testID: "sandbox-paused" }, String(Boolean(paused))),
        React.createElement(Text, { testID: "sandbox-restart" }, String(restartToken ?? 0)),
      ),
  };
});

const mockRouteParams = { current: {} as { sketchId?: string | string[] } };
const mockRouter = {
  back: jest.fn(),
  push: jest.fn(),
  replace: jest.fn(),
};

type MockBeforeRemoveEvent = {
  data: { action: { type: string } };
  preventDefault: jest.Mock;
};

let mockBeforeRemoveHandler: ((event: MockBeforeRemoveEvent) => void) | null = null;
const mockNavigation = {
  addListener: jest.fn(
    (_event: string, handler: (event: MockBeforeRemoveEvent) => void) => {
      mockBeforeRemoveHandler = handler;
      return jest.fn();
    },
  ),
  dispatch: jest.fn(),
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockRouteParams.current,
  useNavigation: () => mockNavigation,
  useRouter: () => mockRouter,
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, BackHandler } from "react-native";

import EditorScreen from "../editor";
import {
  DEFAULT_SKETCH_METADATA,
  type ShaderParameterDefinition,
} from "../../data/sketches/sketch-metadata";
import type { Sketch, SketchRepository } from "../../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE } from "../../data/sketches/starter-sketch";

function deferredWrite() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = () => done();
    reject = fail;
  });
  return { promise, reject, resolve };
}

const GAIN: ShaderParameterDefinition = {
  key: "u_gain",
  label: "Gain",
  min: 0,
  max: 2,
  step: 0.1,
  defaultValue: 1,
  value: 1.2,
};

function makeSketch(
  id: string,
  title: string,
  source: string,
  overrides: Partial<Sketch> = {},
): Sketch {
  return {
    id,
    title,
    source,
    metadata: { ...DEFAULT_SKETCH_METADATA, parameters: [] },
    metadataWarning: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides,
  };
}

let sketches: Sketch[] = [];

const repository: jest.Mocked<SketchRepository> = {
  list: jest.fn(),
  get: jest.fn(),
  create: jest.fn(),
  updateSource: jest.fn(),
  updateMetadata: jest.fn(),
  rename: jest.fn(),
  delete: jest.fn(),
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

const mockRepositoryRef = { current: repository };

function configureRepository() {
  repository.list.mockImplementation(async () => sketches);
  repository.get.mockImplementation(
    async (_profileId, id) => sketches.find((sketch) => sketch.id === id) ?? null,
  );
  repository.create.mockImplementation(async (_profileId, title, source) => {
    const created = makeSketch("sketch-" + (sketches.length + 1), title, source);
    sketches = [created, ...sketches];
    return created;
  });
  repository.updateSource.mockImplementation(async (_profileId, id, source) => {
    sketches = sketches.map((sketch) => (sketch.id === id ? { ...sketch, source } : sketch));
  });
  repository.updateMetadata.mockImplementation(async (_profileId, id, metadata) => {
    sketches = sketches.map((sketch) => (sketch.id === id ? { ...sketch, metadata } : sketch));
  });
  repository.rename.mockImplementation(async (_profileId, id, title) => {
    sketches = sketches.map((sketch) => (sketch.id === id ? { ...sketch, title } : sketch));
  });
  repository.delete.mockImplementation(async (_profileId, id) => {
    sketches = sketches.filter((sketch) => sketch.id !== id);
  });
}

async function openEditor() {
  await render(<EditorScreen />);
  await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());
}

async function openParameters() {
  await fireEvent.press(screen.getByLabelText("Open shader parameters"));
  expect(screen.getByText("Parameters")).toBeTruthy();
}

async function confirmDelete(title: string) {
  await fireEvent.press(screen.getByLabelText("Delete " + title));
  const calls = jest.mocked(Alert.alert).mock.calls;
  const actions = calls[calls.length - 1]?.[2] ?? [];
  await act(async () => {
    actions.find((action) => action.text === "Delete")?.onPress?.();
  });
}

describe("EditorScreen", () => {
  let hardwareBackHandler: Parameters<typeof BackHandler.addEventListener>[1] | null;
  const removeBackHandler = jest.fn();

  beforeEach(() => {
    sketches = [];
    mockRouteParams.current = {};
    jest.clearAllMocks();
    configureRepository();
    jest.useFakeTimers();
    hardwareBackHandler = null;
    mockBeforeRemoveHandler = null;
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, handler) => {
      hardwareBackHandler = handler;
      return { remove: removeBackHandler };
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("opens the sketch requested by the route instead of the most recent sketch", async () => {
    sketches = [
      makeSketch("recent", "Recent", "fragColor = vec4(0.9);"),
      makeSketch("requested", "Requested", "fragColor = vec4(0.2);"),
    ];
    mockRouteParams.current = { sketchId: "requested" };

    await openEditor();

    expect(repository.get).toHaveBeenCalledWith("profile-a", "requested");
    expect(screen.getByTestId("sandbox-source")).toHaveTextContent("fragColor = vec4(0.2);");
    expect(screen.getByText("Requested")).toBeTruthy();
  });

  it("falls back to the most recent sketch when no route ID is present", async () => {
    sketches = [
      makeSketch("recent", "Recent", "fragColor = vec4(0.9);"),
      makeSketch("older", "Older", "fragColor = vec4(0.2);"),
    ];

    await openEditor();

    expect(screen.getByTestId("sandbox-source")).toHaveTextContent("fragColor = vec4(0.9);");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("creates and opens a starter sketch with default metadata on first run", async () => {
    await openEditor();

    expect(repository.create).toHaveBeenCalledWith(
      "profile-a",
      expect.any(String),
      STARTER_SKETCH_SOURCE,
    );
    expect(screen.getByTestId("sandbox-source")).toHaveTextContent(/smoothstep/);
    expect(screen.getByTestId("sandbox-parameters")).toHaveTextContent("[]");
  });

  it("renders the compact Stitch workspace hierarchy", async () => {
    sketches = [makeSketch("one", "plasma_core.frag", "fragColor = vec4(1.0);")];

    await openEditor();

    expect(screen.getByTestId("editor-header")).toBeTruthy();
    expect(screen.getByTestId("preview-workspace")).toBeTruthy();
    expect(screen.getByTestId("workspace-divider")).toBeTruthy();
    expect(screen.getByLabelText("Open shader files")).toBeTruthy();
    expect(screen.getByLabelText("Open shader parameters")).toBeTruthy();
  });

  it("opens the file drawer from the header menu", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(1.0);")];
    await openEditor();

    await fireEvent.press(screen.getByLabelText("Open shader files"));

    expect(screen.getByText("Shadercraft Files")).toBeTruthy();
  });

  it("flushes pending source and metadata in order before selecting another sketch", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);", {
        metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
      }),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.7);");
    await openParameters();
    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.8);
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await fireEvent.press(screen.getByTestId("sketch-row-two"));
    await waitFor(() =>
      expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);"),
    );

    expect(repository.updateSource).toHaveBeenCalledWith(
      "profile-a",
      "one",
      "fragColor = vec4(0.7);",
    );
    expect(repository.updateMetadata).toHaveBeenCalledWith(
      "profile-a",
      "one",
      expect.objectContaining({
        parameters: [expect.objectContaining({ key: "u_gain", value: 1.8 })],
      }),
    );
    expect(repository.updateSource.mock.invocationCallOrder[0]).toBeLessThan(
      repository.updateMetadata.mock.invocationCallOrder[0],
    );
    expect(repository.updateMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      repository.get.mock.invocationCallOrder[0],
    );
  });

  it("waits for in-flight source and metadata writes before selecting another sketch", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);", {
        metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
      }),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    const sourceWrite = deferredWrite();
    const metadataWrite = deferredWrite();
    repository.updateSource.mockImplementationOnce(() => sourceWrite.promise);
    repository.updateMetadata.mockImplementationOnce(() => metadataWrite.promise);
    await openEditor();

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.7);");
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    await openParameters();
    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.8);
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await fireEvent.press(screen.getByTestId("sketch-row-two"));

    expect(repository.updateSource).toHaveBeenCalledTimes(1);
    expect(repository.updateMetadata).not.toHaveBeenCalled();
    expect(repository.get).not.toHaveBeenCalledWith("profile-a", "two");

    await act(async () => {
      sourceWrite.resolve();
      await sourceWrite.promise;
    });
    await waitFor(() => expect(repository.updateMetadata).toHaveBeenCalledTimes(1));
    expect(repository.get).not.toHaveBeenCalledWith("profile-a", "two");

    await act(async () => {
      metadataWrite.resolve();
      await metadataWrite.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);"),
    );
    expect(repository.get).toHaveBeenCalledWith("profile-a", "two");
  });

  it("blocks selection when an in-flight source write fails and retries only the outgoing sketch", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    const sourceWrite = deferredWrite();
    repository.updateSource.mockImplementationOnce(() => sourceWrite.promise);
    await openEditor();

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.7);");
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await fireEvent.press(screen.getByTestId("sketch-row-two"));

    await act(async () => {
      sourceWrite.reject(new Error("disk full"));
      await sourceWrite.promise.catch(() => undefined);
    });

    await waitFor(() =>
      expect(screen.getByText("Could not save. Your code is still here.")).toBeTruthy(),
    );
    expect(screen.getByTestId("sketch-row-one").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.7);");
    expect(repository.get).not.toHaveBeenCalledWith("profile-a", "two");

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.8);");
    await fireEvent.press(screen.getByTestId("sketch-row-two"));
    await waitFor(() =>
      expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);"),
    );

    expect(repository.updateSource).toHaveBeenLastCalledWith(
      "profile-a",
      "one",
      "fragColor = vec4(0.8);",
    );
    expect(repository.updateSource.mock.calls.every((call) => call[1] === "one")).toBe(true);
  });

  it("flushes edits made while a replacement route is loading before activation", async () => {
    const current = makeSketch("one", "One", "fragColor = vec4(0.1);");
    const requested = makeSketch("two", "Two", "fragColor = vec4(0.2);");
    sketches = [current, requested];
    let resolveRequested!: (sketch: Sketch | null) => void;
    const requestedLoad = new Promise<Sketch | null>((resolve) => {
      resolveRequested = resolve;
    });
    repository.get.mockImplementationOnce(() => requestedLoad);
    const mounted = await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());

    mockRouteParams.current = { sketchId: "two" };
    await act(async () => {
      mounted.rerender(<EditorScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(repository.get).toHaveBeenCalledWith("profile-a", "two"));
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.7);");

    await act(async () => {
      resolveRequested(requested);
      await requestedLoad;
    });

    await waitFor(() =>
      expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);"),
    );
    expect(repository.updateSource).toHaveBeenCalledWith(
      "profile-a",
      "one",
      "fragColor = vec4(0.7);",
    );
  });
  it("keeps the current editor usable when a route change cannot flush the outgoing sketch", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    repository.updateSource.mockRejectedValueOnce(new Error("disk full"));
    const mounted = await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.7);");

    mockRouteParams.current = { sketchId: "two" };
    await act(async () => {
      mounted.rerender(<EditorScreen />);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(screen.getByText("Could not save. Your code is still here.")).toBeTruthy(),
    );
    expect(screen.queryByText(/Opening editor/)).toBeNull();
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.7);");
    expect(repository.get).not.toHaveBeenCalledWith("profile-a", "two");
  });
  it("replaces the parameter panel with the file drawer instead of stacking native overlays", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(1.0);")];
    await openEditor();
    await openParameters();

    await fireEvent.press(screen.getByLabelText("Open shader files"));

    expect(screen.queryByText("Parameters")).toBeNull();
    expect(screen.getByText("Shadercraft Files")).toBeTruthy();
  });
  it("handles parameter and drawer back before leaving normal route back to Expo Router", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(1.0);")];
    await openEditor();
    await openParameters();

    expect(hardwareBackHandler).not.toBeNull();
    await act(async () => {
      expect(hardwareBackHandler?.({} as never)).toBe(true);
    });
    expect(screen.queryByText("Parameters")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Open shader files"));
    expect(screen.getByText("Shadercraft Files")).toBeTruthy();
    await act(async () => {
      expect(hardwareBackHandler?.({} as never)).toBe(true);
    });

    expect(screen.queryByText("Shadercraft Files")).toBeNull();
    expect(mockRouter.back).not.toHaveBeenCalled();
    expect(removeBackHandler).toHaveBeenCalled();
  });

  it("waits for source then metadata before bottom-tab navigation", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(u_gain);", {
        metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
      }),
    ];
    const sourceWrite = deferredWrite();
    const laterSourceWrite = deferredWrite();
    const metadataWrite = deferredWrite();
    repository.updateSource
      .mockImplementationOnce(() => sourceWrite.promise)
      .mockImplementationOnce(() => laterSourceWrite.promise);
    repository.updateMetadata.mockImplementationOnce(() => metadataWrite.promise);
    await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(u_gain * 0.5);");
    await openParameters();
    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.9);

    await fireEvent.press(screen.getByText("Home"));

    expect(repository.updateSource).toHaveBeenCalledTimes(1);
    expect(repository.updateMetadata).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(u_gain * 0.75);");
    await act(async () => {
      sourceWrite.resolve();
      await sourceWrite.promise;
    });
    await waitFor(() => expect(repository.updateSource).toHaveBeenCalledTimes(2));
    expect(repository.updateMetadata).not.toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await act(async () => {
      laterSourceWrite.resolve();
      await laterSourceWrite.promise;
    });
    await waitFor(() => expect(repository.updateMetadata).toHaveBeenCalledTimes(1));
    expect(repository.updateSource).toHaveBeenLastCalledWith(
      "profile-a",
      "one",
      "fragColor = vec4(u_gain * 0.75);",
    );
    expect(mockRouter.replace).not.toHaveBeenCalled();

    await act(async () => {
      metadataWrite.resolve();
      await metadataWrite.promise;
    });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/"));
  });

  it("guards route back until source and metadata finish, then leaves later back events alone", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(u_gain);", {
        metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
      }),
    ];
    const sourceWrite = deferredWrite();
    const metadataWrite = deferredWrite();
    repository.updateSource.mockImplementationOnce(() => sourceWrite.promise);
    repository.updateMetadata.mockImplementationOnce(() => metadataWrite.promise);
    await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(u_gain * 0.5);");
    await openParameters();
    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.9);

    const handler = mockBeforeRemoveHandler;
    if (!handler) throw new Error("beforeRemove listener was not registered");
    const action = { type: "GO_BACK" };
    const event: MockBeforeRemoveEvent = { data: { action }, preventDefault: jest.fn() };
    await act(async () => {
      handler(event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(repository.updateSource).toHaveBeenCalledTimes(1);
    expect(repository.updateMetadata).not.toHaveBeenCalled();
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();

    await act(async () => {
      sourceWrite.resolve();
      await sourceWrite.promise;
    });
    await waitFor(() => expect(repository.updateMetadata).toHaveBeenCalledTimes(1));
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();

    await act(async () => {
      metadataWrite.resolve();
      await metadataWrite.promise;
    });
    await waitFor(() => expect(mockNavigation.dispatch).toHaveBeenCalledWith(action));

    const laterEvent: MockBeforeRemoveEvent = {
      data: { action: { type: "GO_BACK" } },
      preventDefault: jest.fn(),
    };
    await act(async () => {
      handler(laterEvent);
    });
    expect(laterEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("does not intercept route back when there is no save work", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(1.0);")];
    await openEditor();

    const handler = mockBeforeRemoveHandler;
    if (!handler) throw new Error("beforeRemove listener was not registered");
    const event: MockBeforeRemoveEvent = {
      data: { action: { type: "GO_BACK" } },
      preventDefault: jest.fn(),
    };
    await act(async () => {
      handler(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  });
  it("opens the next recent sketch after deleting the active sketch", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    await openEditor();
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await confirmDelete("One");
    await waitFor(() =>
      expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);"),
    );

    expect(repository.list).toHaveBeenCalled();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it("returns to the library when deleting the active sketch leaves no replacement", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    repository.delete.mockImplementationOnce(async () => {
      sketches = [];
    });
    await openEditor();
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await confirmDelete("One");
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/library"));
  });

  it("passes saved parameter definitions to the sandbox", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(u_gain);", {
        metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
      }),
    ];

    await openEditor();

    expect(screen.getByTestId("sandbox-parameters").props.children).toContain('"key":"u_gain"');
    expect(screen.getByTestId("sandbox-parameters").props.children).toContain('"value":1.2');
  });

  it("updates parameter values live and autosaves metadata on its own debounce", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(u_gain);", {
        metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
      }),
    ];
    await openEditor();
    await openParameters();

    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.8);

    expect(screen.getByTestId("sandbox-parameters").props.children).toContain('"value":1.8');
    expect(repository.updateMetadata).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(repository.updateMetadata).toHaveBeenCalledWith(
      "profile-a",
      "one",
      expect.objectContaining({
        parameters: [expect.objectContaining({ key: "u_gain", value: 1.8 })],
      }),
    );
  });

  it("forwards a newly managed definition to the sandbox immediately", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(u_speed);")];
    await openEditor();
    await openParameters();
    await fireEvent.press(screen.getByLabelText("Manage shader parameters"));
    await fireEvent.press(screen.getByLabelText("Add shader parameter"));
    await fireEvent.changeText(screen.getByLabelText("Parameter key"), "u_speed");
    await fireEvent.changeText(screen.getByLabelText("Parameter label"), "Speed");
    await fireEvent.changeText(screen.getByLabelText("Minimum value"), "0");
    await fireEvent.changeText(screen.getByLabelText("Maximum value"), "3");
    await fireEvent.changeText(screen.getByLabelText("Step value"), "0.1");
    await fireEvent.changeText(screen.getByLabelText("Default value"), "1");

    await fireEvent.press(screen.getByRole("button", { name: "Add parameter" }));

    expect(screen.getByTestId("sandbox-parameters").props.children).toContain('"key":"u_speed"');
  });

  it("keeps changed parameters in memory and warns when metadata autosave fails", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(u_gain);", {
        metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
      }),
    ];
    repository.updateMetadata.mockRejectedValueOnce(new Error("disk full"));
    await openEditor();
    await openParameters();

    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.7);
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    expect(screen.getByText("Could not save parameters. Your values are still here.")).toBeTruthy();
    expect(screen.getByTestId("sandbox-parameters").props.children).toContain('"value":1.7');
  });

  it("renders a stored metadata warning without blocking source editing", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);", {
        metadataWarning: "Saved shader parameters were invalid and have been reset.",
      }),
    ];
    await openEditor();

    expect(
      screen.getByText("Saved shader parameters were invalid and have been reset."),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.6);");
    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.6);");
  });

  it("recompiles before source autosave and saves only after the longer debounce", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    await openEditor();

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.75);");
    await act(async () => {
      jest.advanceTimersByTime(350);
    });

    expect(screen.getByTestId("sandbox-source")).toHaveTextContent("fragColor = vec4(0.75);");
    expect(repository.updateSource).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(650);
    });
    expect(repository.updateSource).toHaveBeenCalledWith(
      "profile-a",
      "one",
      "fragColor = vec4(0.75);",
    );
  });

  it("shows the last-working badge and mapped compile errors after a failed compile", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    await openEditor();

    await fireEvent(screen.getByTestId("sandbox"), "compileResult", {
      ok: false,
      errors: [{ line: 3, message: "syntax error", raw: "ERROR: 0:3: syntax error" }],
      showingLastWorking: true,
    });

    expect(screen.getByText("Showing the last version that compiled")).toBeTruthy();
    expect(screen.getByText("syntax error")).toBeTruthy();
  });

  it("preserves pause, restart, and collapse/unmount controls", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    await openEditor();

    await fireEvent.press(screen.getByLabelText("Pause preview"));
    expect(screen.getByTestId("sandbox-paused")).toHaveTextContent("true");
    expect(screen.getByLabelText("Resume preview")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Restart preview"));
    expect(screen.getByTestId("sandbox-restart")).toHaveTextContent("1");

    await fireEvent.press(screen.getByLabelText("Hide preview"));
    expect(screen.queryByTestId("sandbox")).toBeNull();
    expect(screen.getByTestId("glsl-input")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Show preview"));
    expect(screen.getByTestId("sandbox")).toBeTruthy();
  });

  it("remounts the controlled input with the selected sketch source", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "unsaved local source");
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await fireEvent.press(screen.getByTestId("sketch-row-two"));
    await waitFor(() =>
      expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);"),
    );
  });

  it("flushes pending source then the latest metadata when the editor unmounts", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(u_gain);", {
        metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
      }),
    ];
    const mounted = await render(<EditorScreen />);
    await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(u_gain * 0.5);");
    await openParameters();
    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.9);

    await act(async () => {
      mounted.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(repository.updateSource).toHaveBeenCalledWith(
      "profile-a",
      "one",
      "fragColor = vec4(u_gain * 0.5);",
    );
    expect(repository.updateMetadata).toHaveBeenCalledWith(
      "profile-a",
      "one",
      expect.objectContaining({
        parameters: [expect.objectContaining({ key: "u_gain", value: 1.9 })],
      }),
    );
    expect(repository.updateSource.mock.invocationCallOrder[0]).toBeLessThan(
      repository.updateMetadata.mock.invocationCallOrder[0],
    );
  });
  it("surfaces a source-save failure without discarding the controlled buffer", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    repository.updateSource.mockRejectedValueOnce(new Error("disk full"));
    await openEditor();

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.75);");
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    expect(screen.getByText("Could not save. Your code is still here.")).toBeTruthy();
    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.75);");
  });
});
