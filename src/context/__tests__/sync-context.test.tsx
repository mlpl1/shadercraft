// The mirror image of `disabled-cloud-sync.test.tsx`: this suite is the *enabled* path, which that one
// deliberately never reaches. `data-context` imports AsyncStorage at module scope, so the package's own
// documented mock has to be in place before anything requires it transitively.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Cloud sync on, but with nothing real behind it: `getSupabaseClient()` hands back a token the fake
// remote factory below ignores, so no network client is ever constructed.
jest.mock("../../data/supabase/client", () => ({
  isCloudSyncEnabled: () => true,
  getSupabaseClient: () => ({}),
}));
jest.mock("../../data/sync/supabase-progress-remote", () => ({
  createSupabaseProgressRemote: () => ({}),
}));

// The engine is replaced rather than driven through a fake remote: every assertion here is about what
// `SyncProvider` does *around* a pass — when one starts and what the screen is told meanwhile — and the
// pass's own algorithm has its own suite. `mockEnginePasses` is only ever dereferenced when the scheduler
// calls `sync()`, which is long after this factory runs.
jest.mock("../../data/sync/progress-sync-engine", () => ({
  ProgressSyncEngine: jest.fn().mockImplementation(() => ({
    sync: (profileId: string, supabaseUserId: string) => mockEnginePasses.sync(profileId, supabaseUserId),
  })),
}));

// Curriculum sync's own remote and engine, stubbed for the same reason: every assertion here is about
// what `SyncProvider` does *around* a check — when one starts, and what it may and may not tell the
// screen — while the decision logic has its own suite (`course-sync-engine.test.ts`).
jest.mock("../../data/sync/supabase-course-remote", () => ({
  createSupabaseCourseRemote: () => ({}),
}));
jest.mock("../../data/sync/course-sync-engine", () => ({
  ...jest.requireActual("../../data/sync/course-sync-engine"),
  CourseSyncEngine: jest.fn().mockImplementation(() => ({
    checkForUpdate: () => mockCourseChecks.checkForUpdate(),
  })),
}));

// `SyncProvider` reads `useAuth()` for the activated session only; `AuthProvider` itself (and the
// Supabase auth client under it) is exercised by its own suite, so the hook is mocked here the same way
// `src/app/__tests__/account.test.tsx` mocks it.
jest.mock("../auth-context", () => ({ useAuth: jest.fn() }));

// The one native module in play. `addNetworkStateListener` is the seam every connectivity test below
// drives: the listener registered through it *is* the device's network as far as this suite is concerned.
jest.mock("expo-network", () => ({
  NetworkStateType: { NONE: "NONE", WIFI: "WIFI", UNKNOWN: "UNKNOWN" },
  getNetworkStateAsync: jest.fn(),
  addNetworkStateListener: jest.fn(),
}));

import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import * as Network from "expo-network";

import type { CourseRepository } from "../../data/course/course-repository";
import type {
  ProgressMutation,
  ProgressRepository,
} from "../../data/progress/progress-repository";
import type { CourseSyncResult } from "../../data/sync/course-sync-engine";
import type { SyncResult } from "../../data/sync/progress-sync-engine";
import { useAuth } from "../auth-context";
import { DataContext, type DataContextValue } from "../data-context";
import { SyncProvider, useSyncStatus } from "../sync-context";
import { createFakeSketchRepository } from "../../data/sketches/testing/fake-sketch-repository";
import {
  STUB_BUNDLED_RELEASE_ID,
  STUB_RELEASE_INSTALLER,
} from "../../data/course/testing/stub-release-installer";

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockAddNetworkStateListener = Network.addNetworkStateListener as jest.MockedFunction<
  typeof Network.addNetworkStateListener
>;
const mockGetNetworkStateAsync = Network.getNetworkStateAsync as jest.MockedFunction<
  typeof Network.getNetworkStateAsync
>;

const CONNECTED: Network.NetworkState = {
  isConnected: true,
  isInternetReachable: true,
  type: Network.NetworkStateType.WIFI,
};
const DISCONNECTED: Network.NetworkState = {
  isConnected: false,
  isInternetReachable: false,
  type: Network.NetworkStateType.NONE,
};

/**
 * Stands in for the device's network. `emit` calls whatever listener `SyncProvider` registered — so a
 * provider that registered none, or that ignored the callback, fails rather than quietly passing.
 */
function createFakeNetwork() {
  const listeners: ((state: Network.NetworkState) => void)[] = [];
  let removed = 0;

  mockAddNetworkStateListener.mockImplementation((listener) => {
    listeners.push(listener as (state: Network.NetworkState) => void);
    return {
      remove: () => {
        removed += 1;
      },
    } as ReturnType<typeof Network.addNetworkStateListener>;
  });
  mockGetNetworkStateAsync.mockResolvedValue(CONNECTED);

  return {
    listenerCount: () => listeners.length,
    removeCount: () => removed,
    async emit(state: Network.NetworkState): Promise<void> {
      if (listeners.length === 0) throw new Error("SyncProvider registered no network listener");
      await act(async () => {
        for (const listener of listeners) listener(state);
      });
    },
  };
}

const PROFILE_ID = "profile-1";
const SUPABASE_USER_ID = "user-1";

function makeResult(pending = 0, blocked = 0): SyncResult {
  return { pushed: 0, pulled: 0, pending, blocked, lastCursor: 0 };
}

/**
 * A stand-in for `ProgressSyncEngine.sync` whose every pass is settled explicitly by the test, so a
 * status like `syncing` is observable rather than something that has already come and gone by the time
 * `await render(...)` returns.
 */
function createEnginePasses() {
  const settlers: { resolve: (result: SyncResult) => void; reject: (error: unknown) => void }[] = [];
  const calls: string[] = [];

  return {
    calls,
    sync(profileId: string, _supabaseUserId: string): Promise<SyncResult> {
      calls.push(profileId);
      return new Promise<SyncResult>((resolve, reject) => {
        settlers.push({ resolve, reject });
      });
    },
    reset(): void {
      settlers.length = 0;
      calls.length = 0;
    },
    /** Settles the oldest unsettled pass, inside `act` so React sees the resulting state update. */
    async resolveNext(result: SyncResult = makeResult()): Promise<void> {
      const next = settlers.shift();
      if (!next) throw new Error("No pending sync() call to resolve");
      await act(async () => {
        next.resolve(result);
      });
    },
  };
}

const mockEnginePasses = createEnginePasses();

/** The same explicit-settlement stand-in, for `CourseSyncEngine.checkForUpdate`. */
function createCourseChecks() {
  const settlers: { resolve: (result: CourseSyncResult) => void }[] = [];
  let calls = 0;

  return {
    callCount: () => calls,
    checkForUpdate(): Promise<CourseSyncResult> {
      calls += 1;
      return new Promise<CourseSyncResult>((resolve) => {
        settlers.push({ resolve });
      });
    },
    reset(): void {
      settlers.length = 0;
      calls = 0;
    },
    async resolveNext(result: CourseSyncResult): Promise<void> {
      const next = settlers.shift();
      if (!next) throw new Error("No pending checkForUpdate() call to resolve");
      await act(async () => {
        next.resolve(result);
      });
    },
  };
}

const mockCourseChecks = createCourseChecks();

function mutation(mutationId: string): ProgressMutation {
  return {
    profileId: PROFILE_ID,
    mutationId,
    lessonId: "color-mixing",
    completed: true,
    baseRevision: 0,
    attempts: 0,
    createdAt: "2026-08-04T09:00:00.000Z",
  };
}

/**
 * Implements the `ProgressRepository` surface `SyncProvider` reads plus the `ProgressSyncRepository`
 * facet it reaches through the same documented cast the real provider uses — the shape
 * `SqliteProgressRepository` really has.
 */
function createFakeRepository() {
  const listeners = new Set<() => void>();

  return {
    getActiveProfileId: jest.fn().mockResolvedValue(PROFILE_ID),
    getCompletedLessonIds: jest.fn().mockResolvedValue([]),
    isLessonCompleted: jest.fn().mockResolvedValue(false),
    setLessonCompleted: jest.fn().mockResolvedValue(undefined),
    getPendingMutations: jest.fn().mockResolvedValue([] as ProgressMutation[]),
    getLastSyncSuccessAt: jest.fn().mockResolvedValue(null as string | null),
    importLegacyCompletions: jest.fn().mockResolvedValue(undefined),
    subscribe: jest.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    /** Fires the repository's own change notification, as a local write does. */
    async notifyChange(): Promise<void> {
      await act(async () => {
        for (const listener of listeners) listener();
      });
    },
  };
}

type FakeRepository = ReturnType<typeof createFakeRepository>;

function buildDataValue(repository: FakeRepository): DataContextValue {
  return {
    status: "ready",
    releaseInstaller: STUB_RELEASE_INSTALLER,
    bundledReleaseId: STUB_BUNDLED_RELEASE_ID,
    progressRepository: repository as unknown as ProgressRepository,
    sketchRepository: createFakeSketchRepository(),
    courseRepository: {} as unknown as CourseRepository,
    retry: jest.fn(),
  };
}

function SyncProbe() {
  const sync = useSyncStatus();
  return (
    <>
      <Text testID="status">{sync.status}</Text>
      <Text testID="pending">{String(sync.pending)}</Text>
      <Text testID="last-success">{String(sync.lastSuccessAt)}</Text>
      <Text testID="course-status">{sync.courseUpdate.status}</Text>
      <Text testID="course-release">{String(sync.courseUpdate.updatedReleaseId)}</Text>
      <Text testID="course-required-version">
        {String(sync.courseUpdate.requiredAppVersion)}
      </Text>
    </>
  );
}

async function renderProvider(repository: FakeRepository) {
  return render(
    <DataContext.Provider value={buildDataValue(repository)}>
      <SyncProvider>
        <SyncProbe />
      </SyncProvider>
    </DataContext.Provider>,
  );
}

describe("SyncProvider with cloud sync enabled", () => {
  let repository: FakeRepository;
  let network: ReturnType<typeof createFakeNetwork>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnginePasses.reset();
    mockCourseChecks.reset();
    network = createFakeNetwork();
    repository = createFakeRepository();
    mockUseAuth.mockReturnValue({
      session: { userId: SUPABASE_USER_ID, email: "learner@example.com" },
      profileId: PROFILE_ID,
      isHydrated: true,
      error: null,
      signUpWithPassword: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    });
  });

  test("counts queued changes from the outbox, not from whatever the last pass reported", async () => {
    repository.getPendingMutations.mockResolvedValue([mutation("m-1"), mutation("m-2")]);

    await renderProvider(repository);

    // The pass itself reports an empty queue — it read the outbox before these two were written, which
    // is exactly the case the screen used to get wrong.
    await mockEnginePasses.resolveNext(makeResult(0));

    await waitFor(() => expect(screen.getByTestId("pending")).toHaveTextContent("2"));
  });

  test("reports the durable last successful sync, without waiting for a pass to complete", async () => {
    repository.getLastSyncSuccessAt.mockResolvedValue("2026-08-04T09:30:00.000Z");

    await renderProvider(repository);

    // Still mid-pass: the timestamp is a stored fact about earlier passes, including ones from before
    // this launch, so it must not depend on observing a transition now.
    await waitFor(() =>
      expect(screen.getByTestId("last-success")).toHaveTextContent("2026-08-04T09:30:00.000Z"),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("syncing");
    expect(repository.getLastSyncSuccessAt).toHaveBeenCalledWith(PROFILE_ID);
  });

  test("re-reads both durable facts on a local write, with no status change to prompt it", async () => {
    // Left mid-pass on purpose: a local write during a pass is dropped by the scheduler (the pass will
    // read the outbox again itself), so the status never moves — the repository's own change
    // notification is the only thing that can bring the count up to date.
    await renderProvider(repository);
    await waitFor(() => expect(screen.getByTestId("pending")).toHaveTextContent("0"));

    repository.getPendingMutations.mockResolvedValue([mutation("m-1")]);
    repository.getLastSyncSuccessAt.mockResolvedValue("2026-08-04T09:45:00.000Z");
    await repository.notifyChange();

    await waitFor(() => expect(screen.getByTestId("pending")).toHaveTextContent("1"));
    expect(screen.getByTestId("last-success")).toHaveTextContent("2026-08-04T09:45:00.000Z");
    expect(screen.getByTestId("status")).toHaveTextContent("syncing");
  });

  test("reads no durable sync facts at all while no account is signed in", async () => {
    mockUseAuth.mockReturnValue({
      session: null,
      profileId: PROFILE_ID,
      isHydrated: true,
      error: null,
      signUpWithPassword: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    });
    repository.getPendingMutations.mockResolvedValue([mutation("m-1")]);
    repository.getLastSyncSuccessAt.mockResolvedValue("2026-08-04T09:30:00.000Z");

    await renderProvider(repository);

    // A guest's queue belongs to a profile no sync will ever push, and there is no account to report a
    // last sync for; both must stay empty rather than showing another profile's leftovers.
    expect(screen.getByTestId("pending")).toHaveTextContent("0");
    expect(screen.getByTestId("last-success")).toHaveTextContent("null");
    expect(repository.getLastSyncSuccessAt).not.toHaveBeenCalled();
    expect(mockEnginePasses.calls).toEqual([]);
  });

  test("turns a lost network into the offline status", async () => {
    await renderProvider(repository);
    await mockEnginePasses.resolveNext(makeResult(0));
    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("up-to-date"));

    await network.emit(DISCONNECTED);

    expect(screen.getByTestId("status")).toHaveTextContent("offline");
  });

  test("syncs the moment the network returns, without waiting on any timer", async () => {
    await renderProvider(repository);
    await mockEnginePasses.resolveNext(makeResult(0));
    await network.emit(DISCONNECTED);
    expect(mockEnginePasses.calls).toHaveLength(1);

    await network.emit(CONNECTED);

    // Synchronously after the listener fired, with real timers untouched: the shortest backoff step is
    // two seconds, so a scheduler that waited on one could not possibly have got here yet.
    expect(mockEnginePasses.calls).toHaveLength(2);
    expect(screen.getByTestId("status")).toHaveTextContent("syncing");
  });

  test("keeps the queued count truthful while offline, which is when it matters most", async () => {
    await renderProvider(repository);
    await mockEnginePasses.resolveNext(makeResult(0));
    await network.emit(DISCONNECTED);

    // Airplane mode, three lessons completed: each is queued locally and none can be sent.
    repository.getPendingMutations.mockResolvedValue([
      mutation("m-1"),
      mutation("m-2"),
      mutation("m-3"),
    ]);
    await repository.notifyChange();

    await waitFor(() => expect(screen.getByTestId("pending")).toHaveTextContent("3"));
    expect(screen.getByTestId("status")).toHaveTextContent("offline");
    // Still nothing sent — the outbox is what changed, not the network.
    expect(mockEnginePasses.calls).toHaveLength(1);
  });

  test("treats an unknown reachability as reachable rather than as offline", async () => {
    await renderProvider(repository);
    await mockEnginePasses.resolveNext(makeResult(0));

    // Android can report a connection whose internet reachability it has not established, and every
    // field of `NetworkState` is optional. Refusing to sync on that would strand such a device forever.
    await network.emit({
      isConnected: true,
      isInternetReachable: undefined,
      type: Network.NetworkStateType.UNKNOWN,
    });

    expect(screen.getByTestId("status")).toHaveTextContent("up-to-date");

    // And it is genuinely treated as online, not merely left alone: a foreground-style trigger still
    // reaches the engine.
    await network.emit(DISCONNECTED);
    await network.emit({ isConnected: true, type: Network.NetworkStateType.UNKNOWN });
    expect(mockEnginePasses.calls).toHaveLength(2);
  });

  test("registers exactly one network listener and removes it on unmount", async () => {
    const view = await renderProvider(repository);
    await mockEnginePasses.resolveNext(makeResult(0));

    expect(network.listenerCount()).toBe(1);
    expect(mockGetNetworkStateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      view.unmount();
    });

    expect(network.removeCount()).toBe(1);
  });

  describe("curriculum checks alongside progress sync", () => {
    test("checks for a course update once the local database is ready", async () => {
      await renderProvider(repository);

      expect(mockCourseChecks.callCount()).toBe(1);
      expect(screen.getByTestId("course-status")).toHaveTextContent("checking");

      await mockCourseChecks.resolveNext({ kind: "updated", releaseId: "remote-7" });

      expect(screen.getByTestId("course-status")).toHaveTextContent("up-to-date");
      expect(screen.getByTestId("course-release")).toHaveTextContent("remote-7");
    });

    test("a failed curriculum check never moves the progress-sync status", async () => {
      await renderProvider(repository);
      await mockEnginePasses.resolveNext(makeResult(0));
      expect(screen.getByTestId("status")).toHaveTextContent("up-to-date");

      await mockCourseChecks.resolveNext({ kind: "failed", category: "network" });

      // The curriculum check says so, loudly, in its own state...
      expect(screen.getByTestId("course-status")).toHaveTextContent("retrying");
      // ...and progress sync, which succeeded and is untouched by any of it, still says so.
      expect(screen.getByTestId("status")).toHaveTextContent("up-to-date");
      expect(screen.getByTestId("pending")).toHaveTextContent("0");
    });

    test("a progress pass needing attention never moves the curriculum status", async () => {
      await renderProvider(repository);
      await mockCourseChecks.resolveNext({ kind: "updated", releaseId: "remote-7" });
      expect(screen.getByTestId("course-status")).toHaveTextContent("up-to-date");

      // A mutation the server keeps refusing: progress sync's `attention` state.
      await mockEnginePasses.resolveNext(makeResult(0, 1));

      expect(screen.getByTestId("status")).toHaveTextContent("attention");
      // The curriculum is still the newest published one, and still says so.
      expect(screen.getByTestId("course-status")).toHaveTextContent("up-to-date");
      expect(screen.getByTestId("course-release")).toHaveTextContent("remote-7");
    });

    test("reports the app version a published release demands, without blocking anything", async () => {
      await renderProvider(repository);
      await mockEnginePasses.resolveNext(makeResult(0));

      await mockCourseChecks.resolveNext({
        kind: "requires-app-update",
        minimumAppVersion: "2.4.0",
      });

      expect(screen.getByTestId("course-status")).toHaveTextContent("requires-app-update");
      expect(screen.getByTestId("course-required-version")).toHaveTextContent("2.4.0");
      // Progress sync — the thing a learner's own work depends on — is entirely unaffected.
      expect(screen.getByTestId("status")).toHaveTextContent("up-to-date");
    });

    test("a local write prompts a progress pass but never a curriculum check", async () => {
      await renderProvider(repository);
      await mockEnginePasses.resolveNext(makeResult(0));
      await mockCourseChecks.resolveNext({ kind: "current" });

      await repository.notifyChange();

      expect(mockEnginePasses.calls).toHaveLength(2);
      // Completing a lesson says nothing about whether new curriculum was published.
      expect(mockCourseChecks.callCount()).toBe(1);
    });
  });
});
