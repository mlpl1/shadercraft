jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("../../context/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../context/data-context", () => ({ useData: jest.fn() }));
jest.mock("../../context/settings-context", () => ({ useSettings: jest.fn() }));
jest.mock("../../context/sync-context", () => ({ useSyncStatus: jest.fn() }));
jest.mock("../../data/supabase/client", () => ({ isCloudSyncEnabled: jest.fn() }));

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

import SettingsScreen from "../settings";
import { useAuth } from "../../context/auth-context";
import { useData } from "../../context/data-context";
import { useSettings } from "../../context/settings-context";
import { useSyncStatus } from "../../context/sync-context";
import { isCloudSyncEnabled } from "../../data/supabase/client";

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

describe("SettingsScreen", () => {
  beforeEach(() => {
    mockRouter.push.mockClear();
    mockBottomNavigation.mockClear();
    mockIsCloudSyncEnabled.mockReturnValue(true);
    mockUseData.mockReturnValue({ status: "ready" } as ReturnType<typeof useData>);
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
  test("keeps Settings selected in the root bottom navigation", async () => {
    await render(<SettingsScreen />);

    expect(mockBottomNavigation).toHaveBeenCalledWith(expect.objectContaining({ activeItem: "settings" }));
  });
});
