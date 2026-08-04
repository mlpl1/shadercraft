// `auth-context.tsx` imports `useData` from `./data-context`, which imports the AsyncStorage native
// module at module scope (used only by `DataProvider`'s real initialization path, not exercised here
// since this suite injects a fake repository directly through `DataContext.Provider`). That native
// module isn't available under plain Jest, so it needs the package's own documented mock swapped in
// before anything requires it transitively — see `course-context.test.tsx` for the same precedent.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// `EXPO_PUBLIC_SUPABASE_ENABLED` defaults to unset/false, so this is the path every default checkout
// and every current build actually runs. `AuthProvider` and `SyncProvider` sit unconditionally in
// `src/app/_layout.tsx`, so a regression here does not degrade sync — it breaks app startup for
// everyone, including learners who never wanted accounts. Mocking `../../data/supabase/client` (rather
// than relying on the real env var) makes the assertions about behaviour, not about how the test
// process happens to be configured.
jest.mock("../../data/supabase/client", () => ({
  isCloudSyncEnabled: jest.fn(),
  getSupabaseClient: jest.fn(),
}));

// `getSupabaseClient()` throws when cloud sync is disabled (see the real implementation), so any
// regression that calls it while disabled is a startup crash, not a silent no-op. Standing in for the
// whole `SyncScheduler` class the same way — asserting it is never constructed is a direct proxy for
// "no timer is ever scheduled", since only a constructed scheduler ever reaches `setTimeout`.
jest.mock("../../data/sync/sync-scheduler", () => {
  const actual = jest.requireActual("../../data/sync/sync-scheduler");
  return { ...actual, SyncScheduler: jest.fn() };
});

import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { AppState } from "react-native";

import type { CourseRepository } from "../../data/course/course-repository";
import type { LearnerProfile, ProgressRepository } from "../../data/progress/progress-repository";
import { getSupabaseClient, isCloudSyncEnabled } from "../../data/supabase/client";
import { SyncScheduler } from "../../data/sync/sync-scheduler";
import { AuthProvider, useAuth } from "../auth-context";
import { DataContext, type DataContextValue } from "../data-context";
import { SyncProvider, useSyncStatus } from "../sync-context";

const mockIsCloudSyncEnabled = isCloudSyncEnabled as jest.MockedFunction<typeof isCloudSyncEnabled>;
const mockGetSupabaseClient = getSupabaseClient as jest.MockedFunction<typeof getSupabaseClient>;
const MockSyncScheduler = SyncScheduler as jest.MockedClass<typeof SyncScheduler>;

/** A promise whose settlement is controlled from outside, so no microtask is scheduled until
 * `resolve`/`reject` is called explicitly. Used to make the pre-hydration window deterministically
 * observable, matching `course-context.test.tsx`'s helper of the same name: a `mockResolvedValue(...)`
 * settles on the microtask queue immediately, so it would already be resolved by the time an
 * `await render(...)` returns, making a "before hydration" assertion pass vacuously. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ANONYMOUS_PROFILE: LearnerProfile = {
  id: "anon-1",
  kind: "anonymous",
  supabaseUserId: null,
  mergedIntoProfileId: null,
};

/**
 * Implements both `ProgressRepository` (what `DataContextValue` is typed as) and the five
 * `ProfileStore` methods `AuthProvider` reaches for through its documented cast — the same shape the
 * real `SqliteProgressRepository` has, just faked, matching the pattern in
 * `course-context.test.tsx`'s `FakeProgressRepository`.
 */
function createFakeRepository() {
  const listeners = new Set<() => void>();

  return {
    // ProgressRepository
    getActiveProfileId: jest.fn().mockResolvedValue(ANONYMOUS_PROFILE.id),
    getCompletedLessonIds: jest.fn().mockResolvedValue([]),
    isLessonCompleted: jest.fn().mockResolvedValue(false),
    setLessonCompleted: jest.fn().mockResolvedValue(undefined),
    getPendingMutations: jest.fn().mockResolvedValue([]),
    importLegacyCompletions: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    // ProfileStore
    getActiveProfile: jest.fn().mockResolvedValue(ANONYMOUS_PROFILE),
    createAuthenticatedProfile: jest.fn(),
    activateEmptyAnonymousProfile: jest.fn().mockResolvedValue(ANONYMOUS_PROFILE),
    setActiveProfile: jest.fn().mockResolvedValue(undefined),
    mergeAnonymousProfile: jest.fn().mockResolvedValue(undefined),
  };
}

type FakeRepository = ReturnType<typeof createFakeRepository>;

function buildDataValue(repository: FakeRepository): DataContextValue {
  return {
    status: "ready",
    // `AuthProvider`/`SyncProvider` only ever see this through `ProgressRepository`; the wider
    // `ProfileStore`/`ProgressSyncRepository` facets are reached via the same cast the real providers
    // use, exactly like `SqliteProgressRepository` really implements every one of them at once.
    progressRepository: repository as unknown as ProgressRepository,
    // Neither `AuthProvider` nor `SyncProvider` ever reads this; only `ProgressRepository` matters
    // for this suite.
    courseRepository: {} as unknown as CourseRepository,
    retry: jest.fn(),
  };
}

function AuthProbe() {
  const auth = useAuth();
  return <Text testID="auth-hydrated">{String(auth.isHydrated)}</Text>;
}

function SyncProbe() {
  const sync = useSyncStatus();
  return <Text testID="sync-status">{`${sync.status}:${sync.pending}:${sync.errorKind}`}</Text>;
}

describe("AuthProvider/SyncProvider with cloud sync disabled", () => {
  let fakeRepository: FakeRepository;
  let dataValue: DataContextValue;
  let addEventListenerSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsCloudSyncEnabled.mockReturnValue(false);
    mockGetSupabaseClient.mockImplementation(() => {
      throw new Error("getSupabaseClient() must not be called when cloud sync is disabled");
    });

    fakeRepository = createFakeRepository();
    dataValue = buildDataValue(fakeRepository);
    addEventListenerSpy = jest.spyOn(AppState, "addEventListener");
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
  });

  test("constructs no Supabase client", async () => {
    await render(
      <DataContext.Provider value={dataValue}>
        <AuthProvider>
          <SyncProvider>
            <AuthProbe />
            <SyncProbe />
          </SyncProvider>
        </AuthProvider>
      </DataContext.Provider>,
    );

    await waitFor(() => expect(screen.getByTestId("auth-hydrated")).toHaveTextContent("true"));

    expect(mockGetSupabaseClient).not.toHaveBeenCalled();
  });

  test("schedules no timer and registers no AppState listener", async () => {
    await render(
      <DataContext.Provider value={dataValue}>
        <AuthProvider>
          <SyncProvider>
            <AuthProbe />
            <SyncProbe />
          </SyncProvider>
        </AuthProvider>
      </DataContext.Provider>,
    );

    await waitFor(() => expect(screen.getByTestId("auth-hydrated")).toHaveTextContent("true"));

    // No scheduler was ever constructed, which is a direct proxy for "no timer was ever requested":
    // the only place this codebase calls `setTimeout` for sync is inside `SyncScheduler` itself.
    expect(MockSyncScheduler).not.toHaveBeenCalled();
    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  test("renders children immediately, never gating local content on auth or sync hydration", async () => {
    // Holds the local profile activation deterministically mid-flight (a `mockResolvedValue` would
    // already be settled by the time `await render(...)` returns, making the "before hydration"
    // assertion below pass even if children *were* gated on it).
    const activeProfileDeferred = createDeferred<LearnerProfile>();
    fakeRepository.getActiveProfile.mockReturnValue(activeProfileDeferred.promise);

    await render(
      <DataContext.Provider value={dataValue}>
        <AuthProvider>
          <SyncProvider>
            <Text testID="local-screen">Lesson content</Text>
            <AuthProbe />
          </SyncProvider>
        </AuthProvider>
      </DataContext.Provider>,
    );

    // Not yet hydrated — the profile activation is still pending — and local content is present
    // anyway, proving it is never blocked, delayed, or gated on it.
    expect(screen.getByTestId("auth-hydrated")).toHaveTextContent("false");
    expect(screen.getByTestId("local-screen")).toBeTruthy();

    await act(async () => {
      activeProfileDeferred.resolve(ANONYMOUS_PROFILE);
    });

    await waitFor(() => expect(screen.getByTestId("auth-hydrated")).toHaveTextContent("true"));
  });

  test("useSyncStatus() reports a coherent disabled state, not a false attention", async () => {
    await render(
      <DataContext.Provider value={dataValue}>
        <AuthProvider>
          <SyncProvider>
            <SyncProbe />
          </SyncProvider>
        </AuthProvider>
      </DataContext.Provider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("sync-status")).toHaveTextContent("offline:0:null"),
    );
  });
});
