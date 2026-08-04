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

// `SyncProvider` reads `useAuth()` for the activated session only; `AuthProvider` itself (and the
// Supabase auth client under it) is exercised by its own suite, so the hook is mocked here the same way
// `src/app/__tests__/account.test.tsx` mocks it.
jest.mock("../auth-context", () => ({ useAuth: jest.fn() }));

import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import type { CourseRepository } from "../../data/course/course-repository";
import type {
  ProgressMutation,
  ProgressRepository,
} from "../../data/progress/progress-repository";
import type { SyncResult } from "../../data/sync/progress-sync-engine";
import { useAuth } from "../auth-context";
import { DataContext, type DataContextValue } from "../data-context";
import { SyncProvider, useSyncStatus } from "../sync-context";

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

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
    progressRepository: repository as unknown as ProgressRepository,
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockEnginePasses.reset();
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
});
