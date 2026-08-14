jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

const mockViewabilityRef: { current: null | ((info: unknown) => void) } = { current: null };
type MockFocusCallback = () => void | (() => void);
const mockFocusRef: {
  current: { callback: MockFocusCallback | null; cleanup: (() => void) | null };
} = { current: { callback: null, cleanup: null } };

jest.mock("react-native/Libraries/Lists/FlatList", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");

  return {
    __esModule: true,
    default: ({ data, keyExtractor, ListEmptyComponent, onViewableItemsChanged, renderItem }: any) => {
      mockViewabilityRef.current = onViewableItemsChanged;
      return React.createElement(
        View,
        { testID: "shader-library-list" },
        data.length > 0
          ? data.map((item: unknown, index: number) =>
              React.createElement(
                React.Fragment,
                { key: keyExtractor(item) },
                renderItem({ item, index }),
              ),
            )
          : ListEmptyComponent,
      );
    },
  };
});
const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useFocusEffect: (callback: MockFocusCallback) => {
    const React = require("react") as typeof import("react");
    React.useEffect(() => {
      mockFocusRef.current.callback = callback;
      const cleanup = callback();
      mockFocusRef.current.cleanup = cleanup ?? null;
      return () => {
        const currentCleanup = mockFocusRef.current.cleanup;
        mockFocusRef.current.cleanup = null;
        currentCleanup?.();
      };
    }, [callback]);
  },
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

const mockSandbox = jest.fn();

jest.mock("../../components/shader-sandbox", () => ({
  ShaderSandbox: (props: { active: boolean; source: string }) => {
    mockSandbox(props);
    const { View } = require("react-native") as typeof import("react-native");
    return <View testID={`sandbox-${props.source}`} />;
  },
}));

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

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import LibraryScreen from "../library";
import { DEFAULT_SKETCH_METADATA } from "../../data/sketches/sketch-metadata";
import type { Sketch, SketchRepository } from "../../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE, STARTER_SKETCH_TITLE } from "../../data/sketches/starter-sketch";

let sketches: Sketch[] = [];
let nextId = 10;

function makeSketch(
  id: string,
  title: string,
  category = "Drafts",
  source = `source-${id}`,
  updatedAt = "2026-08-14T10:00:00.000Z",
): Sketch {
  return {
    id,
    title,
    source,
    metadata: { ...DEFAULT_SKETCH_METADATA, category },
    metadataWarning: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt,
  };
}

const repository: jest.Mocked<SketchRepository> = {
  list: jest.fn(async (_profileId: string) => sketches),
  get: jest.fn(
    async (_profileId: string, id: string) => sketches.find((sketch) => sketch.id === id) ?? null,
  ),
  create: jest.fn(async (_profileId: string, title: string, source: string) => {
    nextId += 1;
    const created = makeSketch(`sketch-${nextId}`, title, "Drafts", source);
    sketches = [created, ...sketches];
    return created;
  }),
  updateSource: jest.fn(async (_profileId: string, _id: string, _source: string) => undefined),
  updateMetadata: jest.fn(
    async (_profileId: string, _id: string, _metadata: Sketch["metadata"]) => undefined,
  ),
  rename: jest.fn(async (_profileId: string, _id: string, _title: string) => undefined),
  delete: jest.fn(async (_profileId: string, _id: string) => undefined),
};

const mockRepositoryRef = { current: repository };
const mockProfileRef = { current: "profile-a" };

describe("LibraryScreen", () => {
  beforeEach(() => {
    sketches = [];
    nextId = 10;
    mockProfileRef.current = "profile-a";
    jest.clearAllMocks();
    mockFocusRef.current = { callback: null, cleanup: null };
    repository.list.mockImplementation(async (_profileId: string) => sketches);
    repository.create.mockImplementation(async (_profileId: string, title: string, source: string) => {
      nextId += 1;
      const created = makeSketch(`sketch-${nextId}`, title, "Drafts", source);
      sketches = [created, ...sketches];
      return created;
    });
  });

  it("creates and lists the starter shader for an empty profile", async () => {
    await render(<LibraryScreen />);

    await waitFor(() => {
      expect(repository.create).toHaveBeenCalledWith(
        "profile-a",
        STARTER_SKETCH_TITLE,
        STARTER_SKETCH_SOURCE,
      );
    });
    expect(await screen.findByText(STARTER_SKETCH_TITLE)).toBeTruthy();
  });

  it("shows every sketch in repository order", async () => {
    sketches = [
      makeSketch("recent", "Most recent", "Drafts", "source-recent", "2026-08-14T12:00:00.000Z"),
      makeSketch("older", "Older shader", "Experiments", "source-older", "2026-08-13T12:00:00.000Z"),
    ];

    await render(<LibraryScreen />);

    const cards = await screen.findAllByTestId(/shader-library-card-/);
    expect(cards.map((card) => card.props.testID)).toEqual([
      "shader-library-card-recent",
      "shader-library-card-older",
    ]);
  });

  it("filters titles case-insensitively", async () => {
    sketches = [makeSketch("noise", "Noise Wave"), makeSketch("grid", "Grid")];
    await render(<LibraryScreen />);
    await screen.findByText("Noise Wave");

    await fireEvent.changeText(screen.getByPlaceholderText("Search .frag files..."), "nOiSe");

    expect(screen.getByText("Noise Wave")).toBeTruthy();
    expect(screen.queryByText("Grid")).toBeNull();
  });

  it("filters by metadata category", async () => {
    sketches = [
      makeSketch("draft", "Draft shader"),
      makeSketch("experiment", "Lab", "Experiments"),
    ];
    await render(<LibraryScreen />);
    await screen.findByText("Draft shader");

    await fireEvent.press(screen.getByRole("button", { name: "Experiments" }));

    expect(screen.getByText("Lab")).toBeTruthy();
    expect(screen.queryByText("Draft shader")).toBeNull();
  });

  it("resets search and category when filters have no results", async () => {
    sketches = [
      makeSketch("draft", "Draft shader"),
      makeSketch("experiment", "Lab", "Experiments"),
    ];
    await render(<LibraryScreen />);
    await screen.findByText("Draft shader");

    await fireEvent.press(screen.getByRole("button", { name: "Experiments" }));
    await fireEvent.changeText(screen.getByPlaceholderText("Search .frag files..."), "missing");
    await fireEvent.press(screen.getByText("Clear filters"));

    expect(screen.getByPlaceholderText("Search .frag files...").props.value).toBe("");
    expect(screen.getByText("Draft shader")).toBeTruthy();
    expect(screen.getByText("Lab")).toBeTruthy();
  });

  it("creates and opens a new shader", async () => {
    sketches = [makeSketch("existing", "Existing")];
    await render(<LibraryScreen />);
    await screen.findByText("Existing");

    await fireEvent.press(screen.getByRole("button", { name: /New Shader/ }));

    await waitFor(() => expect(repository.create).toHaveBeenCalled());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/editor",
      params: { sketchId: "sketch-11" },
    });
  });

  it("opens a card in the editor with its sketch ID", async () => {
    sketches = [makeSketch("open-me", "Open me")];
    await render(<LibraryScreen />);
    await screen.findByText("Open me");

    await fireEvent.press(screen.getByTestId("shader-library-card-open-me"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/editor",
      params: { sketchId: "open-me" },
    });
  });

  it("surfaces a failed create without navigating", async () => {
    sketches = [makeSketch("existing", "Existing")];
    repository.create.mockRejectedValueOnce(new Error("disk full"));
    await render(<LibraryScreen />);
    await screen.findByText("Existing");

    await fireEvent.press(screen.getByRole("button", { name: /New Shader/ }));

    expect(await screen.findByText("Could not create a shader. Try again.")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("clears another profile's shaders when the new profile cannot load", async () => {
    const previous = makeSketch("previous", "Previous profile shader");
    repository.list.mockImplementation(async (profileId: string) => {
      if (profileId === "profile-a") return [previous];
      throw new Error("read failed");
    });
    const rendered = await render(<LibraryScreen />);
    await screen.findByText("Previous profile shader");

    mockProfileRef.current = "profile-b";
    await rendered.rerender(<LibraryScreen />);

    expect(await screen.findByText("Could not load your shaders.")).toBeTruthy();
    expect(screen.queryByText("Previous profile shader")).toBeNull();
  });

  it("ignores a retry result from a profile that is no longer active", async () => {
    const fromA = makeSketch("from-a", "Profile A shader");
    const fromB = makeSketch("from-b", "Profile B shader");
    let resolveRetry: ((value: Sketch[]) => void) | null = null;
    let profileAReads = 0;
    repository.list.mockImplementation(async (profileId: string) => {
      if (profileId === "profile-b") return [fromB];
      profileAReads += 1;
      if (profileAReads === 1) throw new Error("read failed");
      return new Promise<Sketch[]>((resolve) => {
        resolveRetry = resolve;
      });
    });
    const rendered = await render(<LibraryScreen />);
    await screen.findByText("Could not load your shaders.");

    await fireEvent.press(screen.getByText("Retry"));
    mockProfileRef.current = "profile-b";
    await rendered.rerender(<LibraryScreen />);
    await screen.findByText("Profile B shader");
    await act(async () => {
      resolveRetry?.([fromA]);
    });

    expect(screen.getByText("Profile B shader")).toBeTruthy();
    expect(screen.queryByText("Profile A shader")).toBeNull();
  });

  it("does not navigate when creation finishes after a profile switch", async () => {
    const fromA = makeSketch("from-a", "Profile A shader");
    const fromB = makeSketch("from-b", "Profile B shader");
    repository.list.mockImplementation(async (profileId: string) =>
      profileId === "profile-a" ? [fromA] : [fromB],
    );
    let resolveCreate: ((value: Sketch) => void) | null = null;
    repository.create.mockImplementationOnce(
      async () =>
        new Promise<Sketch>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const rendered = await render(<LibraryScreen />);
    await screen.findByText("Profile A shader");

    await fireEvent.press(screen.getByRole("button", { name: /New Shader/ }));
    mockProfileRef.current = "profile-b";
    await rendered.rerender(<LibraryScreen />);
    await screen.findByText("Profile B shader");
    await act(async () => {
      resolveCreate?.(makeSketch("created-a", "Created for A"));
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("does not navigate when creation finishes after the library unmounts", async () => {
    sketches = [makeSketch("existing", "Existing")];
    let resolveCreate: ((value: Sketch) => void) | null = null;
    repository.create.mockImplementationOnce(
      async () =>
        new Promise<Sketch>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const rendered = await render(<LibraryScreen />);
    await screen.findByText("Existing");

    await fireEvent.press(screen.getByRole("button", { name: /New Shader/ }));
    await rendered.unmount();
    await act(async () => {
      resolveCreate?.(makeSketch("created", "Created"));
    });

    expect(mockPush).not.toHaveBeenCalled();
  });

  it("reserves All for the category filter sentinel", async () => {
    sketches = [makeSketch("sentinel", "Sentinel", "All")];
    await render(<LibraryScreen />);
    await screen.findByText("Sentinel");

    expect(screen.getAllByRole("button", { name: "All" })).toHaveLength(1);
  });

  it("deactivates visible previews on blur and restores only visible previews on focus", async () => {
    sketches = [makeSketch("visible", "Visible"), makeSketch("hidden", "Hidden")];
    await render(<LibraryScreen />);
    await screen.findByText("Visible");

    await act(async () => {
      mockViewabilityRef.current?.({
        changed: [],
        viewableItems: [{ item: sketches[0], key: "visible", index: 0, isViewable: true }],
      });
    });
    expect(mockSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, source: "source-visible" }),
    );

    mockSandbox.mockClear();
    await act(async () => {
      mockFocusRef.current.cleanup?.();
      mockFocusRef.current.cleanup = null;
    });
    expect(mockSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, source: "source-visible" }),
    );

    mockSandbox.mockClear();
    await act(async () => {
      const cleanup = mockFocusRef.current.callback?.();
      mockFocusRef.current.cleanup = cleanup ?? null;
    });
    expect(mockSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, source: "source-visible" }),
    );
    expect(mockSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, source: "source-hidden" }),
    );
  });

  it("keeps off-screen previews inactive and activates visible cards", async () => {
    sketches = [makeSketch("visible", "Visible"), makeSketch("hidden", "Hidden")];
    await render(<LibraryScreen />);
    await screen.findByText("Visible");

    expect(mockSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, source: "source-hidden" }),
    );

    mockSandbox.mockClear();
    await act(async () => {
      mockViewabilityRef.current?.({
        changed: [],
        viewableItems: [{ item: sketches[0], key: "visible", index: 0, isViewable: true }],
      });
    });

    expect(mockSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ active: true, source: "source-visible" }),
    );
    expect(mockSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ active: false, source: "source-hidden" }),
    );
  });
});
