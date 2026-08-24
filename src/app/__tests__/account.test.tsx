jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// The real `SafeAreaProvider` only renders its children after a native `onInsetsChange` event that
// never fires under Jest, so children would never mount. Swap in the package's own documented test
// mock, which provides insets synchronously instead — same precedent as `course.test.tsx`.
jest.mock("react-native-safe-area-context", () =>
  require("react-native-safe-area-context/jest/mock").default,
);

// `AccountScreen` consumes `useAuth()`/`useSyncStatus()` only through their public hook surface (per
// the task brief), so the whole provider tree — `DataProvider`, SQLite, Supabase — is replaced with a
// direct mock of the hooks themselves. That tree is already exercised by
// `src/context/__tests__/disabled-cloud-sync.test.tsx` and the sync-scheduler suite; this file is only
// responsible for what the screen renders and calls given a hook result.
jest.mock("../../context/auth-context", () => ({ useAuth: jest.fn() }));
jest.mock("../../context/sync-context", () => ({ useSyncStatus: jest.fn() }));
// Mocked for the same reason `disabled-cloud-sync.test.tsx` mocks it: importing the real module pulls
// in `react-native-url-polyfill/auto` and `expo-sqlite/localStorage/install` side effects that this
// suite has no need to exercise, and the screen must gate on this flag directly (not on session state)
// per the brief's "hide the Course account button ... local-only informational state" requirement.
jest.mock("../../data/supabase/client", () => ({ isCloudSyncEnabled: jest.fn() }));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { initialWindowMetrics, SafeAreaProvider } from "react-native-safe-area-context";

import AccountScreen from "../account";
import { useAuth } from "../../context/auth-context";
import { useSyncStatus } from "../../context/sync-context";
import { isCloudSyncEnabled } from "../../data/supabase/client";

const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
jest.mock("expo-router", () => ({
  // Behaves like an ordinary mount effect rather than a no-op, so the focus-driven reloads these
  // screens use are actually exercised instead of silently skipped.
  useFocusEffect: (callback: () => void) => require("react").useEffect(callback, [callback]),
  useRouter: () => mockRouter,
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseSyncStatus = useSyncStatus as jest.MockedFunction<typeof useSyncStatus>;
const mockIsCloudSyncEnabled = isCloudSyncEnabled as jest.MockedFunction<typeof isCloudSyncEnabled>;

type AuthOverrides = Partial<ReturnType<typeof useAuth>>;
type SyncOverrides = Partial<ReturnType<typeof useSyncStatus>>;

function buildAuth(overrides: AuthOverrides = {}): ReturnType<typeof useAuth> {
  return {
    session: null,
    profileId: "local-profile",
    isHydrated: true,
    error: null,
    signUpWithPassword: jest.fn(),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(),
    ...overrides,
  };
}

function buildSync(overrides: SyncOverrides = {}): ReturnType<typeof useSyncStatus> {
  return {
    status: "up-to-date",
    pending: 0,
    errorKind: null,
    lastSuccessAt: null,
    retrySync: jest.fn(),
    // Curriculum sync is a separate concern with a separate state (see `sync-context.tsx`); this
    // screen reports progress sync, so the default is simply "nothing has been checked".
    courseUpdate: { status: "idle", updatedReleaseId: null, requiredAppVersion: null },
    checkForCourseUpdate: jest.fn(),
    ...overrides,
  };
}

async function renderAccountScreen() {
  return render(
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <AccountScreen />
    </SafeAreaProvider>,
  );
}

async function pressAlertAction(alertSpy: jest.SpiedFunction<typeof Alert.alert>, index: number) {
  const buttons = alertSpy.mock.calls[0][2];
  await act(async () => {
    buttons?.[index]?.onPress?.();
  });
}

describe("AccountScreen", () => {
  beforeEach(() => {
    mockIsCloudSyncEnabled.mockReturnValue(true);
    mockUseAuth.mockReturnValue(buildAuth());
    mockUseSyncStatus.mockReturnValue(buildSync());
    mockRouter.back.mockClear();
    mockRouter.push.mockClear();
  });

  test("shows a local-only informational state and no sign-in affordance when cloud sync is disabled", async () => {
    mockIsCloudSyncEnabled.mockReturnValue(false);

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("Cloud sync is off")).toBeTruthy());
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
  });

  test("shows the sign-in and create-account form for an anonymous learner", async () => {
    await renderAccountScreen();

    await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy());
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
  });

  test("hides sign-in affordances while the session is still hydrating", async () => {
    mockUseAuth.mockReturnValue(buildAuth({ session: undefined }));

    await renderAccountScreen();

    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  test("shows a validation error and never calls the auth service for an invalid email", async () => {
    const auth = buildAuth();
    mockUseAuth.mockReturnValue(auth);

    await renderAccountScreen();

    await fireEvent.changeText(screen.getByLabelText("Email"), "not-an-email");
    await fireEvent.changeText(screen.getByLabelText("Password"), "correct-horse");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("Enter a valid email address.")).toBeTruthy());
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  test("shows a validation error for a too-short password", async () => {
    const auth = buildAuth();
    mockUseAuth.mockReturnValue(auth);

    await renderAccountScreen();

    await fireEvent.changeText(screen.getByLabelText("Email"), "learner@example.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "abc");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getByText("Password must be at least 6 characters.")).toBeTruthy(),
    );
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  test("disables both submit buttons and shows a submitting label while sign-in is in flight", async () => {
    let resolveSignIn!: () => void;
    const auth = buildAuth({
      signInWithPassword: jest.fn().mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSignIn = resolve;
        }),
      ),
    });
    mockUseAuth.mockReturnValue(auth);

    await renderAccountScreen();

    await fireEvent.changeText(screen.getByLabelText("Email"), "learner@example.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "correct-horse");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("Signing in…")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();

    // A second tap while in flight must not queue a duplicate submission.
    await fireEvent.press(screen.getByRole("button", { name: "Signing in…" }));
    expect(auth.signInWithPassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSignIn();
    });
  });

  test("surfaces the sign-in error message as-is, without an error screen", async () => {
    const auth = buildAuth({
      signInWithPassword: jest.fn().mockRejectedValue(new Error("Invalid login credentials")),
    });
    mockUseAuth.mockReturnValue(auth);

    await renderAccountScreen();

    await fireEvent.changeText(screen.getByLabelText("Email"), "learner@example.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "correct-horse");
    await fireEvent.press(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByText("Invalid login credentials")).toBeTruthy());
    // The form remains usable — this is not a full-screen error state.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  test("treats a sign-up awaiting email confirmation as success, not an error", async () => {
    const auth = buildAuth({
      signUpWithPassword: jest.fn().mockResolvedValue({
        kind: "confirm-email",
        email: "learner@example.com",
      }),
    });
    mockUseAuth.mockReturnValue(auth);

    await renderAccountScreen();

    await fireEvent.changeText(screen.getByLabelText("Email"), "learner@example.com");
    await fireEvent.changeText(screen.getByLabelText("Password"), "correct-horse");
    await fireEvent.press(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(screen.getByText("Check your email")).toBeTruthy());
    expect(screen.getByText(/learner@example\.com/)).toBeTruthy();
    expect(screen.queryByText("Invalid login credentials")).toBeNull();
  });

  test("shows the signed-in email, queued count, and no sign-in fields once authenticated", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "up-to-date", pending: 3 }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("learner@example.com")).toBeTruthy());
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry sync" })).toBeNull();
  });

  test("reads the last successful sync from the durable timestamp rather than a status transition", async () => {
    const lastSuccessAt = "2026-08-04T09:30:00.000Z";
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    // Mid-pass, and nothing has transitioned while this screen has been open: the stored timestamp is
    // still the answer, because it describes every earlier pass including ones from before this launch.
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "syncing", pending: 1, lastSuccessAt }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("Syncing…")).toBeTruthy());
    expect(screen.getByText(new Date(lastSuccessAt).toLocaleString())).toBeTruthy();
    expect(screen.queryByText("Not yet")).toBeNull();
  });

  test("says a sync has never happened when nothing has ever been synced", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "up-to-date", lastSuccessAt: null }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("Not yet")).toBeTruthy());
  });

  test("does not claim to be up to date while local changes are still queued", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "up-to-date", pending: 2 }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("2 changes waiting to sync")).toBeTruthy());
    expect(screen.queryByText("Up to date")).toBeNull();
  });

  test("says it is up to date only once nothing is queued", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "up-to-date", pending: 0 }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("Up to date")).toBeTruthy());
  });

  test("shows a syncing indicator with no retry affordance while a pass is in flight", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "syncing", pending: 1 }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("Syncing…")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Retry sync" })).toBeNull();
  });

  test("shows a Retry sync action only in the attention state, and pressing it calls retrySync", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    const sync = buildSync({ status: "attention", pending: 2, errorKind: "transport" });
    mockUseSyncStatus.mockReturnValue(sync);

    await renderAccountScreen();

    const retryButton = await screen.findByRole("button", { name: "Retry sync" });
    await fireEvent.press(retryButton);

    expect(sync.retrySync).toHaveBeenCalledTimes(1);
  });

  test("does not show a Retry sync action for a single failure that is already retrying", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "retrying", pending: 1 }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("Waiting to retry")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Retry sync" })).toBeNull();
  });

  test("says how many changes are waiting while signed in with no network", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "offline", pending: 3 }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("Offline — 3 changes waiting")).toBeTruthy());
    // Nothing is wrong and nothing is lost, so there is no failure notice and nothing to retry.
    expect(screen.queryByRole("button", { name: "Retry sync" })).toBeNull();
  });

  test("reads correctly for a single waiting change", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "offline", pending: 1 }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("Offline — 1 change waiting")).toBeTruthy());
  });

  test("says something coherent when offline with nothing queued at all", async () => {
    mockUseAuth.mockReturnValue(
      buildAuth({ session: { userId: "user-1", email: "learner@example.com" } }),
    );
    mockUseSyncStatus.mockReturnValue(buildSync({ status: "offline", pending: 0 }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText("Offline — nothing waiting")).toBeTruthy());
    expect(screen.queryByText("Offline — 0 changes waiting")).toBeNull();
  });

  test("confirms before signing out, mentioning offline progress stays available, and only signs out after confirming", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const auth = buildAuth({ session: { userId: "user-1", email: "learner@example.com" } });
    mockUseAuth.mockReturnValue(auth);

    await renderAccountScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    expect(auth.signOut).not.toHaveBeenCalled();
    const [, message] = alertSpy.mock.calls[0];
    expect(message).toMatch(/offline progress/i);

    await pressAlertAction(alertSpy, 1);

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    alertSpy.mockRestore();
  });

  test("surfaces a sign-out failure without crashing", async () => {
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    const auth = buildAuth({
      session: { userId: "user-1", email: "learner@example.com" },
      signOut: jest.fn().mockRejectedValue(new Error("network unreachable")),
    });
    mockUseAuth.mockReturnValue(auth);

    await renderAccountScreen();

    await fireEvent.press(screen.getByRole("button", { name: "Sign out" }));
    await pressAlertAction(alertSpy, 1);

    await waitFor(() => expect(screen.getByText("network unreachable")).toBeTruthy());
    alertSpy.mockRestore();
  });

  test("shows a non-blocking notice for a profile activation error without hiding the rest of the screen", async () => {
    mockUseAuth.mockReturnValue(buildAuth({ error: new Error("profile activation failed") }));

    await renderAccountScreen();

    await waitFor(() => expect(screen.getByText(/profile activation failed/)).toBeTruthy());
    // Still fully usable — a non-blocking notice, not an error screen replacing the form.
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });
});
