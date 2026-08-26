jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("../../context/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../context/data-context", () => ({ useData: jest.fn() }));
jest.mock("../../context/settings-context", () => ({ useSettings: jest.fn() }));
jest.mock("../../context/sync-context", () => ({ useSyncStatus: jest.fn() }));
jest.mock("../../data/supabase/client", () => ({ isCloudSyncEnabled: jest.fn() }));
jest.mock("../../data/settings/sketch-export", () => ({
  sketchExportAdapter: { share: jest.fn(async () => undefined) },
  exportSketch: jest.fn(
    (sketch: { title: string; source: string }, adapter: { share(filename: string, source: string): Promise<void> }) =>
      adapter.share(`${sketch.title}.frag`, sketch.source),
  ),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

import SettingsScreen from "../settings";
import { useAuth } from "../../context/auth-context";
import { useData } from "../../context/data-context";
import { useSettings } from "../../context/settings-context";
import { useSyncStatus } from "../../context/sync-context";
import { isCloudSyncEnabled } from "../../data/supabase/client";
import { sketchExportAdapter } from "../../data/settings/sketch-export";
import type { Sketch } from "../../data/sketches/sketch-repository";

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockBottomNavigation = jest.fn(({ activeItem }: { activeItem: string }) => {
  const { Text } = require("react-native");
  return <Text>{`Active tab: ${activeItem}`}</Text>;
});

jest.mock("../../components/bottom-navigation", () => ({
  BottomNavigation: (props: { activeItem: string }) => mockBottomNavigation(props),
}));
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseData = useData as jest.MockedFunction<typeof useData>;
const mockUseSettings = useSettings as jest.MockedFunction<typeof useSettings>;
const mockUseSyncStatus = useSyncStatus as jest.MockedFunction<typeof useSyncStatus>;
const mockIsCloudSyncEnabled = isCloudSyncEnabled as jest.MockedFunction<typeof isCloudSyncEnabled>;
const mockSketchExportAdapter = sketchExportAdapter as { share: jest.Mock<Promise<void>, [string, string]> };

function buildSyncStatus(overrides: Partial<ReturnType<typeof useSyncStatus>> = {}) {
  return {
    status: "up-to-date" as const,
    errorKind: null,
    pending: 0,
    lastSuccessAt: null,
    retrySync: jest.fn(),
    courseUpdate: { status: "idle" as const, updatedReleaseId: null, requiredAppVersion: null },
    checkForCourseUpdate: jest.fn(),
    ...overrides,
  };
}

function buildSketch(overrides: Partial<Sketch> = {}): Sketch {
  return {
    id: "sketch-1",
    title: "Glow",
    source: "void mainImage() {}",
    metadata: { version: 1, category: "Drafts", parameters: [] },
    metadataWarning: null,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  } as Sketch;
}

function buildReadyData(
  sketches: Sketch[] = [],
  list: jest.Mock<Promise<Sketch[]>, [string]> = jest.fn(async (_profileId: string) => sketches),
) {
  return {
    status: "ready" as const,
    sketchRepository: {
      list,
      get: jest.fn(),
      create: jest.fn(),
      updateSource: jest.fn(),
      updateMetadata: jest.fn(),
      rename: jest.fn(),
      delete: jest.fn(),
    },
  } as unknown as ReturnType<typeof useData>;
}

describe("SettingsScreen", () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockBottomNavigation.mockClear();
    mockIsCloudSyncEnabled.mockReturnValue(true);
    mockSketchExportAdapter.share.mockReset();
    mockSketchExportAdapter.share.mockResolvedValue(undefined);
    mockUseData.mockReturnValue(buildReadyData());
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
      update: jest.fn(),
    });
    mockUseAuth.mockReturnValue({
      session: null,
      profileId: null,
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });
    mockUseSyncStatus.mockReturnValue(buildSyncStatus());
  });

  test("explains local-only mode without an account action when cloud sync is disabled", async () => {
    mockIsCloudSyncEnabled.mockReturnValue(false);

    await render(<SettingsScreen />);

    expect(screen.getByText("Local-only mode")).toBeTruthy();
    expect(screen.getByText("Your data stays on this device.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Manage account" })).toBeNull();
  });

  test("opens Account for a cloud-enabled signed-out learner", async () => {
    await render(<SettingsScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Sign in or create account" }));

    expect(mockRouter.push).toHaveBeenCalledWith("/account");
  });

  test("shows signed-in account and pending progress before opening Account", async () => {
    mockUseAuth.mockReturnValue({
      session: { userId: "user-1", email: "learner@example.com" },
      profileId: "profile-1",
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });
    mockUseSyncStatus.mockReturnValue(buildSyncStatus({ pending: 3 }));

    await render(<SettingsScreen />);

    expect(screen.getByText("learner@example.com")).toBeTruthy();
    expect(screen.getByText("3 changes waiting to sync")).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Manage account" }));
    expect(mockRouter.push).toHaveBeenCalledWith("/account");
  });

  test("shows readable ASCII account loading copy", async () => {
    mockUseAuth.mockReturnValue({
      session: undefined,
      profileId: null,
      isHydrated: false,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });

    await render(<SettingsScreen />);

    expect(screen.getByText("Checking account...")).toBeTruthy();
    expect(screen.queryByText("Checking accountâ€¦")).toBeNull();
  });

  test("shows readable ASCII syncing copy", async () => {
    mockUseAuth.mockReturnValue({
      session: { userId: "user-1", email: "learner@example.com" },
      profileId: "profile-1",
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });
    mockUseSyncStatus.mockReturnValue(buildSyncStatus({ status: "syncing" }));

    await render(<SettingsScreen />);

    expect(screen.getByText("Syncing...")).toBeTruthy();
    expect(screen.queryByText("Syncingâ€¦")).toBeNull();
  });

  test("shows readable ASCII offline copy", async () => {
    mockUseAuth.mockReturnValue({
      session: { userId: "user-1", email: "learner@example.com" },
      profileId: "profile-1",
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });
    mockUseSyncStatus.mockReturnValue(buildSyncStatus({ status: "offline", pending: 2 }));

    await render(<SettingsScreen />);

    expect(screen.getByText("Offline - 2 changes waiting to sync")).toBeTruthy();
    expect(screen.queryByText("Offline â€” 2 changes waiting to sync")).toBeNull();
  });

  test("shows automatic retry status for a temporary sync failure", async () => {
    mockUseAuth.mockReturnValue({
      session: { userId: "user-1", email: "learner@example.com" },
      profileId: "profile-1",
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });
    mockUseSyncStatus.mockReturnValue(buildSyncStatus({ status: "retrying", pending: 1 }));

    await render(<SettingsScreen />);

    expect(screen.getByText("Waiting to retry")).toBeTruthy();
    expect(screen.getByText("We'll retry automatically when possible.")).toBeTruthy();
  });

  test("updates the editor font size preference", async () => {
    const update = jest.fn(async () => undefined);
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
      update,
    });

    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "16" }));

    expect(update).toHaveBeenCalledWith({ editorFontSize: 16 });
  });

  test("updates the editor line-number visibility preference", async () => {
    const update = jest.fn(async () => undefined);
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
      update,
    });

    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Show line numbers" }));

    expect(update).toHaveBeenCalledWith({ showEditorLineNumbers: false });
  });

  test("marks Full speed selected and updates Battery saver preview performance", async () => {
    const update = jest.fn(async () => undefined);
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
      update,
    });

    await render(<SettingsScreen />);

    expect(screen.getByRole("button", { name: "Full speed" }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByRole("button", { name: "Battery saver" }).props.accessibilityState).toEqual({
      selected: false,
    });

    await fireEvent.press(screen.getByRole("button", { name: "Battery saver" }));

    expect(update).toHaveBeenCalledWith({ previewPerformance: "battery-saver" });
  });

  test("marks Battery saver selected and updates Full speed preview performance", async () => {
    const update = jest.fn(async () => undefined);
    mockUseSettings.mockReturnValue({
      settings: {
        version: 1,
        editorFontSize: 14,
        showEditorLineNumbers: true,
        previewPerformance: "battery-saver",
        editorPreviewMode: "responsive",
      },
      hydrated: true,
      error: null,
      retry: jest.fn(),
      update,
    });

    await render(<SettingsScreen />);

    expect(screen.getByRole("button", { name: "Battery saver" }).props.accessibilityState).toEqual({
      selected: true,
    });
    expect(screen.getByRole("button", { name: "Full speed" }).props.accessibilityState).toEqual({
      selected: false,
    });

    await fireEvent.press(screen.getByRole("button", { name: "Full speed" }));

    expect(update).toHaveBeenCalledWith({ previewPerformance: "full-speed" });
  });

  test("keeps the retryable settings error visible after a preference update rejects", async () => {
    const retry = jest.fn(async () => undefined);
    const update = jest.fn(async () => {
      throw new Error("storage full");
    });
    mockUseSettings.mockReturnValue({
      settings: {
        version: 1,
        editorFontSize: 14,
        showEditorLineNumbers: true,
        previewPerformance: "full-speed",
        editorPreviewMode: "responsive",
      },
      hydrated: true,
      error: new Error("storage full"),
      retry,
      update,
    });

    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "16" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith({ editorFontSize: 16 }));
    expect(screen.getByText("Could not save settings: storage full")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("explains that editor changes save automatically without offering an autosave toggle", async () => {
    await render(<SettingsScreen />);

    expect(screen.getByText("Changes save automatically")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Changes save automatically" })).toBeNull();
  });

  test("loads export choices from only the active profile", async () => {
    const list = jest.fn(async (_profileId: string) => [buildSketch({ title: "Glow" })]);
    mockUseData.mockReturnValue(buildReadyData([], list));
    mockUseAuth.mockReturnValue({
      session: null,
      profileId: "profile-1",
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });

    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Export saved sketch" }));

    await waitFor(() => expect(list).toHaveBeenCalledWith("profile-1"));
    expect(list).toHaveBeenCalledTimes(1);
  });

  test("shows an empty export chooser when the active profile has no sketches", async () => {
    mockUseData.mockReturnValue(buildReadyData([]));
    mockUseAuth.mockReturnValue({
      session: null,
      profileId: "profile-1",
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });

    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Export saved sketch" }));

    expect(await screen.findByText("No sketches to export")).toBeTruthy();
  });

  test("exports the selected sketch source exactly and closes the chooser", async () => {
    const exactSource = "void mainImage() {\n  fragColor = vec4(0.25);\n}\n";
    mockUseData.mockReturnValue(buildReadyData([buildSketch({ title: "Glow", source: exactSource })]));
    mockUseAuth.mockReturnValue({
      session: null,
      profileId: "profile-1",
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });

    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Export saved sketch" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Glow" }));

    await waitFor(() => expect(mockSketchExportAdapter.share).toHaveBeenCalledWith("Glow.frag", exactSource));
    expect(screen.queryByRole("button", { name: "Glow" })).toBeNull();
  });

  test("closes the export chooser without an alert when the learner cancels", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    mockUseData.mockReturnValue(buildReadyData([buildSketch({ title: "Glow" })]));
    mockUseAuth.mockReturnValue({
      session: null,
      profileId: "profile-1",
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });

    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Export saved sketch" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Close export chooser" }));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Glow" })).toBeNull();
    alertSpy.mockRestore();
  });

  test("surfaces export failures as a retryable alert", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    mockSketchExportAdapter.share.mockRejectedValueOnce(new Error("disk full"));
    mockUseData.mockReturnValue(buildReadyData([buildSketch({ title: "Glow" })]));
    mockUseAuth.mockReturnValue({
      session: null,
      profileId: "profile-1",
      isHydrated: true,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });

    await render(<SettingsScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Export saved sketch" }));
    await fireEvent.press(await screen.findByRole("button", { name: "Glow" }));

    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toBe("Export failed");
    expect(alertSpy.mock.calls[0][1]).toContain("disk full");
    expect(alertSpy.mock.calls[0][2]?.some((button) => button.text === "Retry")).toBe(true);
    alertSpy.mockRestore();
  });

  test("disables sketch export until profile hydration provides a profile id", async () => {
    mockUseAuth.mockReturnValue({
      session: undefined,
      profileId: null,
      isHydrated: false,
      error: null,
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
      signUpWithPassword: jest.fn(),
    });

    await render(<SettingsScreen />);

    expect(screen.getByRole("button", { name: "Export saved sketch" })).toBeDisabled();
  });

  test("explains that sketches and tutorials remain local-only", async () => {
    await render(<SettingsScreen />);

    expect(screen.getByText("Sketches and tutorials remain local-only. Lesson progress can sync when you sign in."))
      .toBeTruthy();
  });
  test("keeps Settings selected in the root bottom navigation", async () => {
    await render(<SettingsScreen />);

    expect(mockBottomNavigation).toHaveBeenCalledWith(expect.objectContaining({ activeItem: "settings" }));
  });
});
