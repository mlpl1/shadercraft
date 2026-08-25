
// The real SafeAreaProvider waits for a native inset event that Jest never sends.
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

jest.mock("@react-native-community/slider", () => "Slider");

jest.mock("../../components/glsl-input", () => {
  const actual = jest.requireActual("../../components/glsl-input");
  return {
    ...actual,
    GlslInput: jest.fn((props) => actual.GlslInput(props)),
  };
});

jest.mock("../../context/settings-context", () => ({ useSettings: jest.fn() }));

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
  canGoBack: jest.fn(() => true),
  push: jest.fn(),
  replace: jest.fn(),
  setParams: jest.fn(),
};

type MockPreventRemoveEvent = {
  data: { action: { type: string } };
};

let mockPreventRemoveEnabled = false;
let mockPreventRemoveCallback: ((event: MockPreventRemoveEvent) => void) | null = null;
const mockNavigation = {
  dispatch: jest.fn(),
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockRouteParams.current,
  useNavigation: () => mockNavigation,
  useRouter: () => mockRouter,
}));

jest.mock("expo-router/react-navigation", () => ({
  usePreventRemove: (
    enabled: boolean,
    callback: (event: MockPreventRemoveEvent) => void,
  ) => {
    mockPreventRemoveEnabled = enabled;
    mockPreventRemoveCallback = callback;
  },
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert, AppState, BackHandler, type AppStateStatus } from "react-native";

import EditorScreen from "../editor";
import { GlslInput } from "../../components/glsl-input";
import {
  DEFAULT_SKETCH_METADATA,
  type ShaderParameterDefinition,
} from "../../data/sketches/sketch-metadata";
import type { Sketch, SketchRepository } from "../../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE } from "../../data/sketches/starter-sketch";
import { useSettings } from "../../context/settings-context";

import { Colors } from '../../constants/theme';

const mockGlslInput = GlslInput as jest.MockedFunction<typeof GlslInput>;
const mockUseSettings = useSettings as jest.MockedFunction<typeof useSettings>;
const mockUpdateSettings = jest.fn(async () => undefined);

function deferredWrite() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((done, fail) => {
    resolve = () => done();
    reject = fail;
  });
  return { promise, reject, resolve };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
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
  useAuth: () => ({ profileId: mockProfileRef.current }),
}));

const mockRepositoryRef = { current: repository };
const mockProfileRef = { current: "profile-a" };

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
  const rendered = await render(<EditorScreen />);
  await waitFor(() => expect(screen.getByTestId("glsl-input")).toBeTruthy());
  return rendered;
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
  let appStateHandler: ((state: AppStateStatus) => void) | null;
  let hardwareBackHandler: Parameters<typeof BackHandler.addEventListener>[1] | null;
  const removeAppStateListener = jest.fn();
  const removeBackHandler = jest.fn();

  beforeEach(() => {
    sketches = [];
    mockProfileRef.current = "profile-a";
    mockRouteParams.current = {};
    jest.clearAllMocks();
    mockUpdateSettings.mockResolvedValue(undefined);
    mockUseSettings.mockReturnValue({
      settings: {
        version: 1,
        editorFontSize: 14,
        showEditorLineNumbers: true,
        previewPerformance: "full-speed",
        editorPreviewMode: "responsive",
      },
      hydrated: true,
      error: null,
      retry: jest.fn(),
      update: mockUpdateSettings,
    });
    mockRouter.canGoBack.mockReturnValue(true);
    configureRepository();
    jest.useFakeTimers();
    appStateHandler = null;
    hardwareBackHandler = null;
    mockPreventRemoveEnabled = false;
    mockPreventRemoveCallback = null;
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    jest.spyOn(AppState, "addEventListener").mockImplementation((event, handler) => {
      if (event === "change") appStateHandler = handler as (state: AppStateStatus) => void;
      return { remove: removeAppStateListener };
    });
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, handler) => {
      hardwareBackHandler = handler;
      return { remove: removeBackHandler };
    });
  });

  it('uses the provider preview mode when the editor mounts', async () => {
    sketches = [makeSketch('one', 'One', 'fragColor = vec4(1.0);')];
    mockUseSettings.mockReturnValue({
      settings: {
        version: 1,
        editorFontSize: 14,
        showEditorLineNumbers: true,
        previewPerformance: "full-speed",
        editorPreviewMode: "wide",
      },
      hydrated: true,
      error: null,
      retry: jest.fn(),
      update: mockUpdateSettings,
    });

    await openEditor();
    let workspace = screen.getByTestId('preview-workspace').parent;
    while (workspace && typeof workspace.props.onLayout !== 'function') {
      workspace = workspace.parent;
    }
    if (!workspace) throw new Error('expected editor workspace layout handler');

    await fireEvent(workspace, 'layout', {
      nativeEvent: { layout: { height: 600, width: 320, x: 0, y: 0 } },
    });
    await fireEvent.press(screen.getByLabelText('Open shader files'));

    expect(screen.getByText('16:9').props.style.color).toBe(Colors.accent);
    expect(screen.getByTestId('preview-workspace').props.style[1].height).toBe(180);
  });

  it('does not overwrite a new preview choice when the provider hydrates later', async () => {
    sketches = [makeSketch('one', 'One', 'fragColor = vec4(1.0);')];

    const rendered = await openEditor();
    await fireEvent.press(screen.getByLabelText('Open shader files'));
    await fireEvent.press(screen.getByText('16:9'));

    mockUseSettings.mockReturnValue({
      settings: {
        version: 1,
        editorFontSize: 14,
        showEditorLineNumbers: true,
        previewPerformance: "full-speed",
        editorPreviewMode: "square",
      },
      hydrated: true,
      error: null,
      retry: jest.fn(),
      update: mockUpdateSettings,
    });
    await rendered.rerender(<EditorScreen />);

    expect(screen.getByText('16:9').props.style.color).toBe(Colors.accent);
    expect(mockUpdateSettings).toHaveBeenCalledWith({ editorPreviewMode: 'wide' });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("passes editor typography preferences to the GLSL input", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
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

    await openEditor();

    expect(mockGlslInput).toHaveBeenCalledWith(
      expect.objectContaining({ fontSize: 16, showLineNumbers: false }),
      undefined,
    );
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

  it("hides profile A immediately and shows profile B only after its deferred load succeeds", async () => {
    const fromA = makeSketch("from-a", "Profile A shader", "fragColor = vec4(0.1);");
    const fromB = makeSketch("from-b", "Profile B shader", "fragColor = vec4(0.2);");
    const profileBLoad = deferred<Sketch[]>();
    repository.list.mockImplementation((profileId) =>
      profileId === "profile-a" ? Promise.resolve([fromA]) : profileBLoad.promise,
    );
    const rendered = await openEditor();

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);

    expect(screen.queryByText("Profile A shader")).toBeNull();
    expect(screen.getByText(/Opening editor/)).toBeTruthy();

    await act(async () => {
      profileBLoad.resolve([fromB]);
      await profileBLoad.promise;
    });
    expect(await screen.findByText("Profile B shader")).toBeTruthy();
    expect(screen.queryByText("Profile A shader")).toBeNull();
  });

  it("does not let a failed profile A cleanup save block profile B activation", async () => {
    const fromA = makeSketch("from-a", "Profile A shader", "fragColor = vec4(0.1);");
    const fromB = makeSketch("from-b", "Profile B shader", "fragColor = vec4(0.2);");
    const profileASave = deferredWrite();
    repository.list.mockImplementation((profileId) =>
      Promise.resolve(profileId === "profile-a" ? [fromA] : [fromB]),
    );
    repository.updateSource.mockImplementationOnce(() => profileASave.promise);
    const rendered = await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "profile A unsaved edit");

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    await waitFor(() => expect(repository.updateSource).toHaveBeenCalledWith(
      "profile-a",
      "from-a",
      "profile A unsaved edit",
    ));
    await act(async () => {
      profileASave.reject(new Error("profile A storage unavailable"));
      await profileASave.promise.catch(() => undefined);
    });

    expect(await screen.findByText("Profile B shader")).toBeTruthy();
    expect(screen.queryByText("Profile A shader")).toBeNull();
  });

  it("starts profile B autosaves while a profile A cleanup write is still pending", async () => {
    const fromA = makeSketch("from-a", "Profile A shader", "fragColor = vec4(0.1);");
    const fromB = makeSketch("from-b", "Profile B shader", "fragColor = vec4(0.2);");
    const profileASave = deferredWrite();
    repository.list.mockImplementation((profileId) =>
      Promise.resolve(profileId === "profile-a" ? [fromA] : [fromB]),
    );
    repository.updateSource.mockImplementation((profileId) =>
      profileId === "profile-a" ? profileASave.promise : Promise.resolve(),
    );
    const rendered = await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "profile A unsaved edit");

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    await waitFor(() =>
      expect(repository.updateSource).toHaveBeenCalledWith(
        "profile-a",
        "from-a",
        "profile A unsaved edit",
      ),
    );
    expect(await screen.findByText("Profile B shader")).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "profile B independent edit");
    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
    });
    const profileBWriteStarted = repository.updateSource.mock.calls.some(
      ([profileId, id, source]) =>
        profileId === "profile-b" &&
        id === "from-b" &&
        source === "profile B independent edit",
    );

    await act(async () => {
      profileASave.resolve();
      await profileASave.promise;
    });
    expect(profileBWriteStarted).toBe(true);
  });

  it("keeps profile A metadata pending while profile B saves metadata independently", async () => {
    const fromA = makeSketch("from-a", "Profile A shader", "fragColor = vec4(u_gain);", {
      metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
    });
    const fromB = makeSketch("from-b", "Profile B shader", "fragColor = vec4(u_gain);", {
      metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
    });
    const profileASourceSave = deferredWrite();
    repository.list.mockImplementation((profileId) =>
      Promise.resolve(profileId === "profile-a" ? [fromA] : [fromB]),
    );
    repository.updateSource.mockImplementation((profileId) =>
      profileId === "profile-a" ? profileASourceSave.promise : Promise.resolve(),
    );
    repository.updateMetadata.mockResolvedValue();
    const rendered = await openEditor();
    await openParameters();
    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.7);
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "profile A source edit");

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    await waitFor(() =>
      expect(repository.updateSource).toHaveBeenCalledWith(
        "profile-a",
        "from-a",
        "profile A source edit",
      ),
    );
    expect(await screen.findByText("Profile B shader")).toBeTruthy();

    await openParameters();
    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.9);
    await act(async () => {
      jest.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(repository.updateMetadata).toHaveBeenCalledWith(
      "profile-b",
      "from-b",
      expect.objectContaining({
        parameters: [expect.objectContaining({ key: "u_gain", value: 1.9 })],
      }),
    );

    await act(async () => {
      profileASourceSave.resolve();
      await profileASourceSave.promise;
    });
    await waitFor(() =>
      expect(repository.updateMetadata).toHaveBeenCalledWith(
        "profile-a",
        "from-a",
        expect.objectContaining({
          parameters: [expect.objectContaining({ key: "u_gain", value: 1.7 })],
        }),
      ),
    );
  });

  it("restores failed inactive profile payloads and clears their errors after retrying on return", async () => {
    let fromA = makeSketch("from-a", "Profile A shader", "profile A original", {
      metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
    });
    const fromB = makeSketch("from-b", "Profile B shader", "profile B original", {
      metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
    });
    const sourceRetry = deferredWrite();
    const metadataRetry = deferredWrite();
    repository.list.mockImplementation((profileId) =>
      Promise.resolve(profileId === "profile-a" ? [fromA] : [fromB]),
    );
    repository.updateSource
      .mockRejectedValueOnce(new Error("profile A source unavailable"))
      .mockImplementationOnce(async (profileId, id, source) => {
        await sourceRetry.promise;
        if (profileId === "profile-a" && id === "from-a") {
          fromA = { ...fromA, source };
        }
      });
    repository.updateMetadata
      .mockRejectedValueOnce(new Error("profile A metadata unavailable"))
      .mockImplementationOnce(async (profileId, id, metadata) => {
        await metadataRetry.promise;
        if (profileId === "profile-a" && id === "from-a") {
          fromA = { ...fromA, metadata };
        }
      });
    const rendered = await openEditor();
    await openParameters();
    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.7);
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "profile A latest source");

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    expect(await screen.findByText("Profile B shader")).toBeTruthy();
    await waitFor(() => expect(repository.updateMetadata).toHaveBeenCalledTimes(1));

    mockProfileRef.current = "profile-a";
    await rendered.rerender(<EditorScreen />);
    expect(await screen.findByText("Profile A shader")).toBeTruthy();
    expect(screen.getByTestId("glsl-input")).toHaveProp(
      "value",
      "profile A latest source",
    );
    expect(screen.getByText("Could not save. Your code is still here.")).toBeTruthy();
    expect(
      screen.getByText("Could not save parameters. Your values are still here."),
    ).toBeTruthy();
    expect(repository.updateSource).toHaveBeenCalledTimes(2);
    expect(repository.updateMetadata).toHaveBeenCalledTimes(1);

    await act(async () => {
      sourceRetry.resolve();
      await sourceRetry.promise;
    });
    await waitFor(() => expect(repository.updateMetadata).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Could not save. Your code is still here.")).toBeNull();
    expect(
      screen.getByText("Could not save parameters. Your values are still here."),
    ).toBeTruthy();

    await act(async () => {
      metadataRetry.resolve();
      await metadataRetry.promise;
    });
    await waitFor(() =>
      expect(
        screen.queryByText("Could not save parameters. Your values are still here."),
      ).toBeNull(),
    );
    expect(fromA.source).toBe("profile A latest source");
    expect(fromA.metadata.parameters).toEqual([
      expect.objectContaining({ key: "u_gain", value: 1.7 }),
    ]);
  });

  it("serializes a later same-profile write behind its earlier write across A to B to A", async () => {
    const fromA = makeSketch("from-a", "Profile A shader", "profile A original");
    const fromB = makeSketch("from-b", "Profile B shader", "profile B original");
    const firstAWrite = deferredWrite();
    const writeOrder: string[] = [];
    repository.list.mockImplementation((profileId) =>
      Promise.resolve(profileId === "profile-a" ? [fromA] : [fromB]),
    );
    repository.updateSource.mockImplementation((profileId, _id, source) => {
      writeOrder.push(`${profileId}:${source}:started`);
      if (profileId === "profile-a" && source === "profile A first edit") {
        return firstAWrite.promise.then(() => {
          writeOrder.push("profile-a:profile A first edit:finished");
        });
      }
      writeOrder.push(`${profileId}:${source}:finished`);
      return Promise.resolve();
    });
    const rendered = await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "profile A first edit");

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    await waitFor(() =>
      expect(writeOrder).toContain("profile-a:profile A first edit:started"),
    );
    expect(await screen.findByText("Profile B shader")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "profile B independent edit");
    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
    });
    expect(writeOrder).toContain("profile-b:profile B independent edit:finished");

    mockProfileRef.current = "profile-a";
    await rendered.rerender(<EditorScreen />);
    expect(await screen.findByText("Profile A shader")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "profile A later edit");
    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
    });
    expect(writeOrder).not.toContain("profile-a:profile A later edit:started");

    await act(async () => {
      firstAWrite.resolve();
      await firstAWrite.promise;
    });
    await waitFor(() =>
      expect(writeOrder).toContain("profile-a:profile A later edit:finished"),
    );
    expect(writeOrder.indexOf("profile-a:profile A first edit:finished")).toBeLessThan(
      writeOrder.indexOf("profile-a:profile A later edit:started"),
    );
  });

  it("never renders profile A content when profile B loading fails", async () => {
    const fromA = makeSketch("from-a", "Profile A shader", "fragColor = vec4(0.1);");
    repository.list.mockImplementation((profileId) =>
      profileId === "profile-a"
        ? Promise.resolve([fromA])
        : Promise.reject(new Error("read failed")),
    );
    const rendered = await openEditor();

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);

    expect(await screen.findByText("Could not load the editor. Try again.")).toBeTruthy();
    expect(screen.queryByText("Profile A shader")).toBeNull();
    expect(screen.queryByTestId("glsl-input")).toBeNull();
  });

  it("ignores a deferred profile A load that completes after profile B becomes active", async () => {
    const fromA = makeSketch("from-a", "Profile A shader", "fragColor = vec4(0.1);");
    const fromB = makeSketch("from-b", "Profile B shader", "fragColor = vec4(0.2);");
    const profileALoad = deferred<Sketch[]>();
    repository.list.mockImplementation((profileId) =>
      profileId === "profile-a" ? profileALoad.promise : Promise.resolve([fromB]),
    );
    const rendered = await render(<EditorScreen />);
    await waitFor(() => expect(repository.list).toHaveBeenCalledWith("profile-a"));

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    expect(await screen.findByText("Profile B shader")).toBeTruthy();

    await act(async () => {
      profileALoad.resolve([fromA]);
      await profileALoad.promise;
    });

    expect(screen.getByText("Profile B shader")).toBeTruthy();
    expect(screen.queryByText("Profile A shader")).toBeNull();
  });

  it("falls back to the most recent sketch when no route ID is present", async () => {
    sketches = [
      makeSketch("recent", "Recent", "fragColor = vec4(0.9);"),
      makeSketch("older", "Older", "fragColor = vec4(0.2);"),
    ];

    await openEditor();

    expect(screen.getByTestId("sandbox-source")).toHaveTextContent("fragColor = vec4(0.9);");
    expect(repository.create).not.toHaveBeenCalled();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ sketchId: "recent" });
  });

  it("falls back from a stale route ID and replaces it with the activated sketch ID", async () => {
    sketches = [makeSketch("recent", "Recent", "fragColor = vec4(0.9);")];
    mockRouteParams.current = { sketchId: "missing" };

    await openEditor();

    expect(repository.get).toHaveBeenCalledWith("profile-a", "missing");
    expect(screen.getByText("Recent")).toBeTruthy();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ sketchId: "recent" });
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
    expect(mockRouter.setParams).toHaveBeenCalledWith({ sketchId: "sketch-1" });
  });

  it("keeps the activated route ID as the source of truth without reloading it", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    const rendered = await openEditor();
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await fireEvent.press(screen.getByTestId("sketch-row-two"));
    await waitFor(() => expect(screen.getByText("Two")).toBeTruthy());

    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ sketchId: "two" });
    const readsBeforeRouteCommit = repository.get.mock.calls.length;
    mockRouteParams.current = { sketchId: "two" };
    await rendered.rerender(<EditorScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Two")).toBeTruthy();
    expect(repository.get).toHaveBeenCalledTimes(readsBeforeRouteCommit);
  });

  it("updates the route only after a newly created sketch is activated", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    await openEditor();
    mockRouter.setParams.mockClear();
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await fireEvent.press(screen.getByText("New sketch"));
    await waitFor(() => expect(screen.getByText("First shader")).toBeTruthy());

    expect(mockRouter.setParams).toHaveBeenCalledWith({ sketchId: "sketch-2" });
    expect(repository.list.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mockRouter.setParams.mock.invocationCallOrder[0],
    );
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
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ sketchId: "two" });
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
    mockRouter.setParams.mockClear();

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
    expect(mockRouter.setParams).toHaveBeenCalledWith({ sketchId: "one" });
  });

  it("restores the active route when a route-driven repository read fails", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    const mounted = await openEditor();
    mockRouter.setParams.mockClear();
    repository.list.mockRejectedValueOnce(new Error("read failed"));

    mockRouteParams.current = { sketchId: "two" };
    await act(async () => {
      mounted.rerender(<EditorScreen />);
      await Promise.resolve();
    });

    expect(await screen.findByText("Could not load the editor. Try again.")).toBeTruthy();
    expect(screen.getByText("One")).toBeTruthy();
    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.1);");
    expect(mockRouter.setParams).toHaveBeenCalledWith({ sketchId: "one" });
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

  it("flushes and returns a direct-entry editor to the library when no back entry exists", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    mockRouter.canGoBack.mockReturnValue(false);
    await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.7);");

    await act(async () => {
      expect(hardwareBackHandler?.({} as never)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/library"));
    expect(repository.updateSource).toHaveBeenCalledWith(
      "profile-a",
      "one",
      "fragColor = vec4(0.7);",
    );
    expect(repository.updateSource.mock.invocationCallOrder[0]).toBeLessThan(
      mockRouter.replace.mock.invocationCallOrder[0],
    );
  });

  it("offers a cross-platform save-before-library action for direct entry", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    mockRouter.canGoBack.mockReturnValue(false);
    await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.6);");

    await act(async () => {
      expect(hardwareBackHandler?.({} as never)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/library"));
    expect(repository.updateSource).toHaveBeenCalledWith(
      "profile-a",
      "one",
      "fragColor = vec4(0.6);",
    );
    expect(repository.updateSource.mock.invocationCallOrder[0]).toBeLessThan(
      mockRouter.replace.mock.invocationCallOrder[0],
    );
  });

  it("commits parameters closed before direct-entry header back starts saving", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    mockRouter.canGoBack.mockReturnValue(false);
    repository.updateSource.mockImplementationOnce(async () => {
      expect(screen.queryByText("Parameters")).toBeNull();
    });
    await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.6);");
    await openParameters();

    await act(async () => {
      expect(hardwareBackHandler?.({} as never)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      expect(hardwareBackHandler?.({} as never)).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(repository.updateSource).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/library"));
    expect(screen.queryByText("Parameters")).toBeNull();
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

  it("uses the removal hook to flush source then metadata and dispatch the captured action once", async () => {
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

    expect(mockPreventRemoveEnabled).toBe(true);
    const callback = mockPreventRemoveCallback;
    if (!callback) throw new Error("usePreventRemove callback was not registered");
    const action = { type: "GO_BACK" };
    await act(async () => {
      callback({ data: { action } });
    });

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
    expect(mockNavigation.dispatch).toHaveBeenCalledTimes(1);
    expect(mockPreventRemoveEnabled).toBe(false);
  });

  it("commits the parameter overlay closed before a route-removal flush starts", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    repository.updateSource.mockImplementationOnce(async () => {
      expect(screen.queryByText("Parameters")).toBeNull();
    });
    await openEditor();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.8);");
    await openParameters();

    const callback = mockPreventRemoveCallback;
    if (!callback) throw new Error("usePreventRemove callback was not registered");
    const action = { type: "GO_BACK" };
    await act(async () => {
      callback({ data: { action } });
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(mockNavigation.dispatch).toHaveBeenCalledWith(action));
    expect(screen.queryByText("Parameters")).toBeNull();
  });

  it("keeps the removal hook active and does not dispatch when an outgoing flush fails", async () => {
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

    expect(mockPreventRemoveEnabled).toBe(true);
    const callback = mockPreventRemoveCallback;
    if (!callback) throw new Error("usePreventRemove callback was not registered");
    await act(async () => {
      callback({ data: { action: { type: "GO_BACK" } } });
      sourceWrite.reject(new Error("disk full"));
      await sourceWrite.promise.catch(() => undefined);
    });
    await waitFor(() => expect(repository.updateMetadata).toHaveBeenCalledTimes(1));
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();

    await act(async () => {
      metadataWrite.resolve();
      await metadataWrite.promise;
    });
    await waitFor(() =>
      expect(screen.getByText("Could not save. Your code is still here.")).toBeTruthy(),
    );
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
    expect(mockPreventRemoveEnabled).toBe(true);
    expect(screen.getByTestId("glsl-input").props.value).toBe(
      "fragColor = vec4(u_gain * 0.5);",
    );
    expect(screen.getByTestId("sandbox-parameters").props.children).toContain('"value":1.9');
  });

  it("leaves the removal hook disabled when there is no save work", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(1.0);")];
    await openEditor();

    expect(mockPreventRemoveCallback).not.toBeNull();
    expect(mockPreventRemoveEnabled).toBe(false);
    expect(mockNavigation.dispatch).not.toHaveBeenCalled();
  });
  it("preserves the active buffer and reports a rejected open", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    await openEditor();
    repository.get.mockRejectedValueOnce(new Error("read failed"));
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "unsaved current buffer");
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await fireEvent.press(screen.getByTestId("sketch-row-two"));

    expect(
      await screen.findByText("Could not open that shader. Your current shader is unchanged."),
    ).toBeTruthy();
    expect(screen.getAllByText("One").length).toBeGreaterThan(0);
    expect(screen.getByTestId("glsl-input").props.value).toBe("unsaved current buffer");
  });

  it("ignores a deferred open completion after a profile switch", async () => {
    const fromA = makeSketch("one", "Profile A shader", "fragColor = vec4(0.1);");
    const targetA = makeSketch("two", "Profile A target", "fragColor = vec4(0.2);");
    const fromB = makeSketch("from-b", "Profile B shader", "fragColor = vec4(0.3);");
    const openRequest = deferred<Sketch | null>();
    repository.list.mockImplementation((profileId) =>
      Promise.resolve(profileId === "profile-a" ? [fromA, targetA] : [fromB]),
    );
    const rendered = await openEditor();
    repository.get.mockImplementationOnce(() => openRequest.promise);
    mockRouter.setParams.mockClear();
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await fireEvent.press(screen.getByTestId("sketch-row-two"));
    await waitFor(() => expect(repository.get).toHaveBeenCalledWith("profile-a", "two"));

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    expect(await screen.findByText("Profile B shader")).toBeTruthy();
    await act(async () => {
      openRequest.resolve(targetA);
      await openRequest.promise;
    });

    expect(screen.getByText("Profile B shader")).toBeTruthy();
    expect(screen.queryByText("Profile A target")).toBeNull();
    expect(mockRouter.setParams).not.toHaveBeenCalledWith({ sketchId: "two" });
  });

  it("preserves the active sketch and reports a rejected create", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    await openEditor();
    repository.create.mockRejectedValueOnce(new Error("disk full"));
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await fireEvent.press(screen.getByText("New sketch"));

    expect(
      await screen.findByText("Could not create a shader. Your current shader is unchanged."),
    ).toBeTruthy();
    expect(screen.getAllByText("One").length).toBeGreaterThan(0);
  });

  it("ignores a deferred create completion after a profile switch", async () => {
    const fromA = makeSketch("one", "Profile A shader", "fragColor = vec4(0.1);");
    const fromB = makeSketch("from-b", "Profile B shader", "fragColor = vec4(0.3);");
    const createRequest = deferred<Sketch>();
    repository.list.mockImplementation((profileId) =>
      Promise.resolve(profileId === "profile-a" ? [fromA] : [fromB]),
    );
    const rendered = await openEditor();
    repository.create.mockImplementationOnce(() => createRequest.promise);
    mockRouter.setParams.mockClear();
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await fireEvent.press(screen.getByText("New sketch"));

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    expect(await screen.findByText("Profile B shader")).toBeTruthy();
    await act(async () => {
      createRequest.resolve(makeSketch("created-a", "Created for A", "fragColor = vec4(0.4);"));
      await createRequest.promise;
    });

    expect(screen.getByText("Profile B shader")).toBeTruthy();
    expect(screen.queryByText("Created for A")).toBeNull();
    expect(mockRouter.setParams).not.toHaveBeenCalledWith({ sketchId: "created-a" });
  });

  it("preserves the active title and reports a rejected rename", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    await openEditor();
    repository.rename.mockRejectedValueOnce(new Error("disk full"));
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await fireEvent.press(screen.getByTestId("sketch-rename-one"));
    await fireEvent.changeText(screen.getByTestId("sketch-title-input"), "Renamed");

    await fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(
      await screen.findByText("Could not rename that shader. Its current title is unchanged."),
    ).toBeTruthy();
    expect(screen.getAllByText("One").length).toBeGreaterThan(0);
    expect(screen.queryByText("Renamed")).toBeNull();
  });

  it("ignores a deferred rename completion after a profile switch", async () => {
    const fromA = makeSketch("one", "Profile A shader", "fragColor = vec4(0.1);");
    const extraA = makeSketch("two", "Extra A", "fragColor = vec4(0.2);");
    const fromB = makeSketch("from-b", "Profile B shader", "fragColor = vec4(0.3);");
    const renameRequest = deferredWrite();
    repository.list.mockImplementation((profileId) =>
      Promise.resolve(profileId === "profile-a" ? [fromA, extraA] : [fromB]),
    );
    const rendered = await openEditor();
    repository.rename.mockImplementationOnce(() => renameRequest.promise);
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await fireEvent.press(screen.getByTestId("sketch-rename-one"));
    await fireEvent.changeText(screen.getByTestId("sketch-title-input"), "Renamed A");
    await fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    expect(await screen.findByText("Profile B shader")).toBeTruthy();
    await act(async () => {
      renameRequest.resolve();
      await renameRequest.promise;
    });

    expect(screen.getByText("Profile B shader")).toBeTruthy();
    expect(screen.queryByText("Renamed A")).toBeNull();
  });

  it("preserves the active sketch and reports a rejected delete", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    await openEditor();
    repository.delete.mockRejectedValueOnce(new Error("disk full"));
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await confirmDelete("One");

    expect(
      await screen.findByText("Could not delete that shader. Your current shader is unchanged."),
    ).toBeTruthy();
    expect(screen.getAllByText("One").length).toBeGreaterThan(0);
    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.1);");
  });

  it("activates a created shader when ordering refresh fails and retries only the list read", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    await openEditor();
    mockRouter.setParams.mockClear();
    repository.list.mockRejectedValueOnce(new Error("ordering unavailable"));
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await fireEvent.press(screen.getByText("New sketch"));

    expect(await screen.findByText("First shader")).toBeTruthy();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ sketchId: "sketch-2" });
    expect(
      screen.getByText("The change was saved, but the file list could not refresh."),
    ).toBeTruthy();
    expect(repository.create).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByText("Retry file order"));

    await waitFor(() =>
      expect(
        screen.queryByText("The change was saved, but the file list could not refresh."),
      ).toBeNull(),
    );
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("clears an ordering warning after a later autosave refresh succeeds", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    await openEditor();
    repository.list.mockRejectedValueOnce(new Error("ordering unavailable"));
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await fireEvent.press(screen.getByText("New sketch"));
    expect(
      await screen.findByText("The change was saved, but the file list could not refresh."),
    ).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.8);");
    await act(async () => {
      jest.advanceTimersByTime(800);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(
        screen.queryByText("The change was saved, but the file list could not refresh."),
      ).toBeNull(),
    );
  });

  it("keeps a successful rename when ordering refresh fails", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    await openEditor();
    repository.list.mockRejectedValueOnce(new Error("ordering unavailable"));
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await fireEvent.press(screen.getByTestId("sketch-rename-one"));
    await fireEvent.changeText(screen.getByTestId("sketch-title-input"), "Renamed");

    await fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(await screen.findByText("The change was saved, but the file list could not refresh."))
      .toBeTruthy();
    expect(screen.getAllByText("Renamed").length).toBeGreaterThan(0);
    expect(screen.queryByText("Could not rename that shader. Its current title is unchanged."))
      .toBeNull();
    expect(repository.rename).toHaveBeenCalledTimes(1);
  });

  it("opens the local fallback after a successful delete when ordering refresh fails", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    await openEditor();
    mockRouter.setParams.mockClear();
    repository.list.mockRejectedValueOnce(new Error("ordering unavailable"));
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await confirmDelete("One");

    await waitFor(() =>
      expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);"),
    );
    expect(
      screen.getByText("The change was saved, but the file list could not refresh."),
    ).toBeTruthy();
    expect(mockRouter.setParams).toHaveBeenCalledWith({ sketchId: "two" });
    expect(screen.queryByText("Could not delete that shader. Your current shader is unchanged."))
      .toBeNull();
    expect(repository.delete).toHaveBeenCalledTimes(1);
  });

  it("ignores a deferred delete completion after a profile switch", async () => {
    const fromA = makeSketch("one", "Profile A shader", "fragColor = vec4(0.1);");
    const extraA = makeSketch("two", "Extra A", "fragColor = vec4(0.2);");
    const fromB = makeSketch("from-b", "Profile B shader", "fragColor = vec4(0.3);");
    const deleteRequest = deferredWrite();
    repository.list.mockImplementation((profileId) =>
      Promise.resolve(profileId === "profile-a" ? [fromA, extraA] : [fromB]),
    );
    const rendered = await openEditor();
    repository.delete.mockImplementationOnce(() => deleteRequest.promise);
    await fireEvent.press(screen.getByLabelText("Open shader files"));
    await confirmDelete("Profile A shader");

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<EditorScreen />);
    expect(await screen.findByText("Profile B shader")).toBeTruthy();
    await act(async () => {
      deleteRequest.resolve();
      await deleteRequest.promise;
    });

    expect(screen.getByText("Profile B shader")).toBeTruthy();
    expect(screen.queryByText("Extra A")).toBeNull();
  });

  it("locks drawer dismissal and source editing while create is pending", async () => {
    sketches = [makeSketch("one", "One", "fragColor = vec4(0.1);")];
    const createRequest = deferred<Sketch>();
    repository.create.mockImplementationOnce(() => createRequest.promise);
    await openEditor();
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await fireEvent.press(screen.getByText("New sketch"));
    await waitFor(() => expect(repository.create).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("glsl-input").props.editable).toBe(false);
    await fireEvent.press(screen.getByLabelText("Close"));
    await fireEvent.press(screen.getByTestId("shader-file-drawer-scrim"));
    expect(screen.getByText("Shadercraft Files")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "edit during create");
    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.1);");

    await act(async () => {
      createRequest.resolve(makeSketch("created", "Created", "fragColor = vec4(0.4);"));
      await createRequest.promise;
    });
    expect(await screen.findByText("Created")).toBeTruthy();
    expect(repository.updateSource).not.toHaveBeenCalledWith(
      "profile-a",
      "one",
      "edit during create",
    );
  });

  it("locks drawer dismissal and source editing while active deletion is pending", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    const deleteRequest = deferredWrite();
    repository.delete.mockImplementationOnce(() => deleteRequest.promise);
    await openEditor();
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await confirmDelete("One");
    await waitFor(() => expect(repository.delete).toHaveBeenCalledWith("profile-a", "one"));

    expect(screen.getByTestId("glsl-input").props.editable).toBe(false);
    await fireEvent.press(screen.getByLabelText("Close"));
    await fireEvent.press(screen.getByTestId("shader-file-drawer-scrim"));
    expect(screen.getByText("Shadercraft Files")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("glsl-input"), "edit during delete");
    expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.1);");

    await act(async () => {
      deleteRequest.resolve();
      await deleteRequest.promise;
    });
    await waitFor(() =>
      expect(screen.getByTestId("glsl-input").props.value).toBe("fragColor = vec4(0.2);"),
    );
    expect(repository.updateSource).not.toHaveBeenCalledWith(
      "profile-a",
      "one",
      "edit during delete",
    );
  });

  it("serializes rapid drawer actions and exposes the busy state to its controls", async () => {
    sketches = [
      makeSketch("one", "One", "fragColor = vec4(0.1);"),
      makeSketch("two", "Two", "fragColor = vec4(0.2);"),
    ];
    const openRequest = deferred<Sketch | null>();
    await openEditor();
    repository.get.mockImplementationOnce(() => openRequest.promise);
    await fireEvent.press(screen.getByLabelText("Open shader files"));

    await fireEvent.press(screen.getByTestId("sketch-row-two"));
    await fireEvent.press(screen.getByTestId("sketch-row-two"));
    await fireEvent.press(screen.getByText("New sketch"));

    expect(repository.get).toHaveBeenCalledTimes(1);
    expect(repository.create).not.toHaveBeenCalled();
    expect(screen.getByTestId("sketch-row-two").props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );

    await act(async () => {
      openRequest.resolve(sketches[1]);
      await openRequest.promise;
    });
    await waitFor(() => expect(screen.getByText("Two")).toBeTruthy());
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
    expect(mockRouter.setParams).toHaveBeenLastCalledWith({ sketchId: "two" });
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

  it.each(["inactive", "background"] as const)(
    "flushes pending source and metadata when AppState becomes %s",
    async (state) => {
      sketches = [
        makeSketch("one", "One", "fragColor = vec4(u_gain);", {
          metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
        }),
      ];
      await openEditor();
      await fireEvent.changeText(
        screen.getByTestId("glsl-input"),
        "fragColor = vec4(u_gain * 0.5);",
      );
      await openParameters();
      await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.9);

      await act(async () => {
        appStateHandler?.(state);
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() => expect(repository.updateMetadata).toHaveBeenCalledTimes(1));
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
    },
  );

  it.each(["source", "metadata"] as const)(
    "warns when an AppState flush cannot persist the pending %s channel",
    async (channel) => {
      sketches = [
        makeSketch("one", "One", "fragColor = vec4(u_gain);", {
          metadata: { version: 1, category: "Drafts", parameters: [GAIN] },
        }),
      ];
      const warning = jest.spyOn(console, "warn").mockImplementation(() => undefined);
      if (channel === "source") repository.updateSource.mockRejectedValueOnce(new Error("disk full"));
      else repository.updateMetadata.mockRejectedValueOnce(new Error("disk full"));
      await openEditor();

      if (channel === "source") {
        await fireEvent.changeText(screen.getByTestId("glsl-input"), "fragColor = vec4(0.4);");
      } else {
        await openParameters();
        await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.7);
      }
      await act(async () => {
        appStateHandler?.("background");
        await Promise.resolve();
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(warning).toHaveBeenCalledWith(
          "Could not finish saving editor changes while the app is in the background.",
        ),
      );
    },
  );

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
