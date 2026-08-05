import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState } from "react-native";
import Constants from "expo-constants";
import * as Network from "expo-network";

import type { ProgressSyncRepository } from "../data/progress/progress-repository";
import { CourseSyncEngine } from "../data/sync/course-sync-engine";
import {
  CourseSyncScheduler,
  type CourseSyncSchedulerState,
  type CourseSyncStatus,
} from "../data/sync/course-sync-scheduler";
import { createSupabaseCourseRemote } from "../data/sync/supabase-course-remote";
import type { ProgressRemoteErrorKind } from "../data/sync/progress-remote";
import { ProgressSyncEngine } from "../data/sync/progress-sync-engine";
import { createSupabaseProgressRemote } from "../data/sync/supabase-progress-remote";
import {
  SyncScheduler,
  type SyncConnectivityMonitor,
  type SyncSchedulerState,
  type SyncStatus,
} from "../data/sync/sync-scheduler";
import { getSupabaseClient, isCloudSyncEnabled } from "../data/supabase/client";
import { useAuth } from "./auth-context";
import { useData } from "./data-context";

export type { SyncStatus, ProgressRemoteErrorKind, CourseSyncStatus };

/**
 * What the UI may render about background *curriculum* checks, kept in its own object with its own
 * vocabulary.
 *
 * The separation is the point. Progress sync is about a learner's own work reaching their account;
 * curriculum sync is about whether the installed course is the newest published one. A curriculum
 * check that fails must never move `status`, `errorKind`, or `pending` — a learner whose progress is
 * perfectly synced would otherwise be told something is wrong with it because a content manifest was
 * unreachable.
 */
export type CourseUpdateState = {
  status: CourseSyncStatus;
  /** The release id the most recent activation installed, or `null` if none has. */
  updatedReleaseId: string | null;
  /** The app version the published curriculum demands, while `status` is `requires-app-update`. */
  requiredAppVersion: string | null;
};

type SyncContextValue = {
  status: SyncStatus;
  /** The safe classification of the most recent failure, or `null` when nothing has failed. */
  errorKind: ProgressRemoteErrorKind | null;
  /**
   * How many of this profile's local changes are still queued for the server, read from the outbox in
   * SQLite rather than taken from the last pass's `SyncResult`. It has to be the durable count: the
   * states where the number matters most — a device with no network, or one that queued a change while
   * a pass was already reading the outbox — are exactly the ones where no pass has reported since.
   */
  pending: number;
  /**
   * When a pass last moved this profile's progress (ISO), or `null` if none ever has. Read from
   * `sync_state.last_success_at`, so it survives relaunches instead of describing only what this
   * screen happened to watch happen. `null` is "nothing has been synced yet", never "sync is broken" —
   * see `ProgressSyncRepository.getLastSyncSuccessAt`.
   */
  lastSuccessAt: string | null;
  /** An explicit, learner-initiated retry. Bypasses any backoff wait in progress. No-op when there is
   *  nothing to sync (cloud sync disabled, or no authenticated session). */
  retrySync: () => void;
  /** See {@link CourseUpdateState}. Never affected by, and never affecting, progress sync. */
  courseUpdate: CourseUpdateState;
  /**
   * An explicit, learner-initiated curriculum check. Ignores the six-hour recheck interval and any
   * backoff wait. No-op when cloud sync is disabled or the local database is not ready.
   */
  checkForCourseUpdate: () => void;
};

const INITIAL_STATE: SyncSchedulerState = { status: "signed-out", errorKind: null };

const INITIAL_COURSE_STATE: CourseSyncSchedulerState = {
  status: "idle",
  updatedReleaseId: null,
  requiredAppVersion: null,
  failureCategory: null,
};

/** What {@link SyncProvider} reads out of SQLite rather than out of the scheduler's own state. */
type DurableSyncFacts = { pending: number; lastSuccessAt: string | null };

const NO_DURABLE_FACTS: DurableSyncFacts = { pending: 0, lastSuccessAt: null };

/**
 * Whether a reported network state is worth attempting a sync over.
 *
 * Every field of `NetworkState` is optional, and `isInternetReachable` is `undefined` on platforms that
 * do not probe — so only an explicit negative counts as offline. Treating "unknown" as offline would
 * stop syncing outright on any device with an ambiguous state, which is far worse than making one
 * request that fails and reports itself.
 */
function isConsideredOnline(state: Network.NetworkState): boolean {
  if (state.type === Network.NetworkStateType.NONE) return false;
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

const SyncContext = createContext<SyncContextValue | null>(null);

/**
 * Runs `ProgressSyncEngine` on a schedule (`SyncScheduler`) and exposes what the UI can render about
 * it, without ever making local learning wait on any of it.
 *
 * Nothing here runs when `isCloudSyncEnabled()` is false, or before `DataProvider` is `ready`: no
 * Supabase client, no `AppState` listener, no `expo-network` listener, no scheduler, no timer — every
 * effect below is gated on both. `AuthProvider`'s *activated* session (not the raw one) drives the
 * scheduler, so a profile switch here always trails the matching switch in `auth-context.tsx`, never
 * races it.
 *
 * `AppState`, `expo-network`, and the local progress repository's own change notifications are read here
 * and turned into scheduler input; `SyncScheduler` itself never imports any of them, which is what makes
 * it testable without React Native at all (see `src/data/sync/__tests__/sync-scheduler.test.ts`).
 */
export function SyncProvider({ children }: PropsWithChildren) {
  const data = useData();
  const auth = useAuth();
  const progressRepository = data.status === "ready" ? data.progressRepository : null;
  const courseRepository = data.status === "ready" ? data.courseRepository : null;
  const releaseInstaller = data.status === "ready" ? data.releaseInstaller : null;
  const bundledReleaseId = data.status === "ready" ? data.bundledReleaseId : null;
  const enabled = isCloudSyncEnabled();

  const [state, setState] = useState<SyncSchedulerState>(INITIAL_STATE);
  const [courseState, setCourseState] =
    useState<CourseSyncSchedulerState>(INITIAL_COURSE_STATE);
  const [durableFacts, setDurableFacts] = useState<DurableSyncFacts>(NO_DURABLE_FACTS);
  const schedulerRef = useRef<SyncScheduler | null>(null);
  const courseSchedulerRef = useRef<CourseSyncScheduler | null>(null);
  const connectivity = useConnectivityMonitor(enabled);

  // Builds the engine and scheduler once cloud sync is enabled and a repository exists, and rebuilds
  // them if the repository is ever replaced (e.g. `DataProvider.retry()` after a startup failure),
  // so a stale scheduler can never keep running against a closed driver.
  useEffect(() => {
    if (!enabled || !progressRepository) return undefined;

    const remote = createSupabaseProgressRemote(getSupabaseClient());
    const engine = new ProgressSyncEngine(
      remote,
      progressRepository as unknown as ProgressSyncRepository,
    );
    const scheduler = new SyncScheduler(engine, { connectivity });
    schedulerRef.current = scheduler;

    // A freshly constructed scheduler's state always matches `INITIAL_STATE` (below), which is what
    // this component is already seeded with, so there is nothing to reconcile here — only future
    // transitions, delivered through this subscription, ever need to reach `setState`.
    const unsubscribe = scheduler.subscribe(setState);

    return () => {
      unsubscribe();
      scheduler.dispose();
      schedulerRef.current = null;
      setState(INITIAL_STATE);
    };
    // `connectivity` is a stable object for this provider's whole life (see `useConnectivityMonitor`),
    // so it never causes a rebuild here.
  }, [enabled, progressRepository, connectivity]);

  // Builds the curriculum engine and its scheduler, and starts the schedule.
  //
  // Gated on `data.status === "ready"`, which is the whole of "after local database readiness": that
  // status is only set once SQLite is open and migrated, the bundled release is installed, and the
  // repositories exist (see `data-context.tsx`). Nothing here can run earlier, so no release check
  // ever stands between launch and first paint — this effect fires after the first committed render
  // of the app's children, and every call it makes is asynchronous.
  //
  // Deliberately independent of `auth`: both curriculum RPCs are readable by `anon`, so published
  // course content reaches a signed-out learner exactly as it reaches a signed-in one.
  useEffect(() => {
    if (!enabled || !courseRepository || !releaseInstaller || bundledReleaseId === null) {
      return undefined;
    }

    const engine = new CourseSyncEngine(
      createSupabaseCourseRemote(getSupabaseClient()),
      releaseInstaller,
      courseRepository,
      bundledReleaseId,
      // The one place the running app's version is read; the engine itself stays free of native
      // modules, the same way `SyncScheduler` stays free of `expo-network`. A build that does not
      // state a version installs nothing rather than guessing (see `CourseSyncEngine`).
      { appVersion: Constants.expoConfig?.version ?? null },
    );
    const scheduler = new CourseSyncScheduler(engine, { connectivity });
    courseSchedulerRef.current = scheduler;

    const unsubscribe = scheduler.subscribe(setCourseState);
    scheduler.start();

    return () => {
      unsubscribe();
      scheduler.dispose();
      courseSchedulerRef.current = null;
      setCourseState(INITIAL_COURSE_STATE);
    };
  }, [enabled, courseRepository, releaseInstaller, bundledReleaseId, connectivity]);

  // Drives the authenticated profile into the scheduler. `auth.session` is the *activated* session —
  // see `auth-context.tsx` — so this never fires ahead of the profile switch it depends on.
  //
  // The Supabase user id travels with the profile id, and both come from the same activated session,
  // so the pair can never be mismatched here. That pair is what every request the pass makes is
  // checked against, which is how an account switch mid-pass stops rather than writing one account's
  // work into another's (see `ProgressRemote`).
  useEffect(() => {
    if (!enabled) return;
    const profileId = auth.profileId;
    const supabaseUserId = auth.session?.userId;
    schedulerRef.current?.setSession(
      profileId && supabaseUserId ? { profileId, supabaseUserId } : null,
    );
  }, [enabled, auth.session, auth.profileId]);

  // The one place `AppState` is read: turned into a single scheduler call, never imported by the
  // scheduler itself.
  useEffect(() => {
    if (!enabled) return undefined;

    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        schedulerRef.current?.notifyAppForeground();
        // Each scheduler decides for itself whether this is worth an attempt: progress sync always
        // tries, curriculum sync only once its recheck interval has elapsed.
        courseSchedulerRef.current?.notifyAppForeground();
      }
    });

    return () => subscription.remove();
  }, [enabled]);

  // A local write (a lesson completed/uncompleted) queues a fresh outbox mutation; let the scheduler
  // decide whether that is worth an immediate attempt.
  useEffect(() => {
    if (!enabled || !progressRepository) return undefined;

    return progressRepository.subscribe(() => {
      schedulerRef.current?.notifyLocalMutation();
    });
  }, [enabled, progressRepository]);

  // Reads the two facts the screen needs that no scheduler state can carry truthfully: how many
  // changes are queued right now, and when a pass last moved anything. Both come from SQLite, and both
  // are re-read on every scheduler transition (a pass just settled, so the outbox may be shorter and
  // the stamp newer) and on every local write (a lesson just queued one). Purely informational: a
  // failed read leaves the last values in place and never surfaces as an error, because nothing about
  // learning depends on it.
  useEffect(() => {
    const profileId = auth.session ? auth.profileId : null;
    if (!enabled || !progressRepository || !profileId) {
      // A guest's queue belongs to a profile no pass will ever push, and there is no account to report
      // a last sync for.
      setDurableFacts(NO_DURABLE_FACTS);
      return undefined;
    }

    const syncRepository = progressRepository as unknown as ProgressSyncRepository;
    let cancelled = false;
    const refresh = () => {
      void Promise.all([
        progressRepository.getPendingMutations(),
        syncRepository.getLastSyncSuccessAt(profileId),
      ]).then(
        ([mutations, lastSuccessAt]) => {
          if (cancelled) return;
          setDurableFacts({ pending: mutations.length, lastSuccessAt });
        },
        () => {
          // Deliberately silent — see above.
        },
      );
    };

    refresh();
    const unsubscribe = progressRepository.subscribe(refresh);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, progressRepository, auth.session, auth.profileId, state.status]);

  const retrySync = useCallback(() => {
    schedulerRef.current?.retry();
  }, []);

  const checkForCourseUpdate = useCallback(() => {
    courseSchedulerRef.current?.retry();
  }, []);

  // `failureCategory` is deliberately not exposed: it exists so the scheduler can decide whether to
  // retry, and nothing a learner can act on follows from which of the four categories it was.
  const courseUpdate = useMemo<CourseUpdateState>(
    () => ({
      status: courseState.status,
      updatedReleaseId: courseState.updatedReleaseId,
      requiredAppVersion: courseState.requiredAppVersion,
    }),
    [courseState.status, courseState.updatedReleaseId, courseState.requiredAppVersion],
  );

  const value = useMemo<SyncContextValue>(
    () => ({
      status: state.status,
      errorKind: state.errorKind,
      pending: durableFacts.pending,
      lastSuccessAt: durableFacts.lastSuccessAt,
      retrySync,
      courseUpdate,
      checkForCourseUpdate,
    }),
    [state.status, state.errorKind, durableFacts, retrySync, courseUpdate, checkForCourseUpdate],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/**
 * The one place `expo-network` is read, turned into the framework-free {@link SyncConnectivityMonitor}
 * the scheduler takes — the same shape as the `AppState` listener above, and for the same reason.
 *
 * The monitor object is stable for the provider's whole life, and the *value* behind it lives in a ref,
 * so `isOnline()` always answers with the newest reading without a re-render standing between the
 * network changing and the scheduler being able to see it.
 *
 * Nothing is registered or queried when `enabled` is false: a local-only build must not so much as ask
 * the platform about the network. Until the first reading lands the answer is "online", because an
 * unknown network has to be tried rather than assumed away (see {@link isConsideredOnline}).
 */
function useConnectivityMonitor(enabled: boolean): SyncConnectivityMonitor {
  const onlineRef = useRef(true);
  const listenersRef = useRef(new Set<(online: boolean) => void>());

  const monitor = useMemo<SyncConnectivityMonitor>(
    () => ({
      isOnline: () => onlineRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    [],
  );

  useEffect(() => {
    if (!enabled) return undefined;

    let cancelled = false;
    const apply = (networkState: Network.NetworkState) => {
      const online = isConsideredOnline(networkState);
      // Only real transitions are published: a listener that fired for a change the scheduler does not
      // care about (a Wi-Fi-to-cellular hop, say) must not read as the network having come back and
      // trigger a pass.
      if (cancelled || online === onlineRef.current) return;
      onlineRef.current = online;
      for (const listener of [...listenersRef.current]) listener(online);
    };

    const subscription = Network.addNetworkStateListener(apply);
    // Subscribed first, then read: a change arriving between the two is seen either way, where the
    // reverse order could miss one entirely.
    void Network.getNetworkStateAsync().then(apply, () => {
      // A platform that will not answer is not a platform that is offline; leave the assumption alone
      // and let the next attempt find out.
    });

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [enabled]);

  return monitor;
}

export function useSyncStatus(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSyncStatus must be used inside SyncProvider");
  }
  return context;
}
