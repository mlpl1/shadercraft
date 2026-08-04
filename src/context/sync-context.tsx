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

import type { ProgressSyncRepository } from "../data/progress/progress-repository";
import type { ProgressRemoteErrorKind } from "../data/sync/progress-remote";
import { ProgressSyncEngine } from "../data/sync/progress-sync-engine";
import { createSupabaseProgressRemote } from "../data/sync/supabase-progress-remote";
import { SyncScheduler, type SyncSchedulerState, type SyncStatus } from "../data/sync/sync-scheduler";
import { getSupabaseClient, isCloudSyncEnabled } from "../data/supabase/client";
import { useAuth } from "./auth-context";
import { useData } from "./data-context";

export type { SyncStatus, ProgressRemoteErrorKind };

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
};

const INITIAL_STATE: SyncSchedulerState = { status: "offline", pending: 0, errorKind: null };

/** What {@link SyncProvider} reads out of SQLite rather than out of the scheduler's own state. */
type DurableSyncFacts = { pending: number; lastSuccessAt: string | null };

const NO_DURABLE_FACTS: DurableSyncFacts = { pending: 0, lastSuccessAt: null };

const SyncContext = createContext<SyncContextValue | null>(null);

/**
 * Runs `ProgressSyncEngine` on a schedule (`SyncScheduler`) and exposes what the UI can render about
 * it, without ever making local learning wait on any of it.
 *
 * Nothing here runs when `isCloudSyncEnabled()` is false, or before `DataProvider` is `ready`: no
 * Supabase client, no `AppState` listener, no scheduler, no timer — every effect below is gated on
 * both. `AuthProvider`'s *activated* session (not the raw one) drives the scheduler, so a profile
 * switch here always trails the matching switch in `auth-context.tsx`, never races it.
 *
 * `AppState` and the local progress repository's own change notifications are read here and turned
 * into scheduler calls; `SyncScheduler` itself never imports either, which is what makes it testable
 * without React Native at all (see `src/data/sync/__tests__/sync-scheduler.test.ts`).
 */
export function SyncProvider({ children }: PropsWithChildren) {
  const data = useData();
  const auth = useAuth();
  const progressRepository = data.status === "ready" ? data.progressRepository : null;
  const enabled = isCloudSyncEnabled();

  const [state, setState] = useState<SyncSchedulerState>(INITIAL_STATE);
  const [durableFacts, setDurableFacts] = useState<DurableSyncFacts>(NO_DURABLE_FACTS);
  const schedulerRef = useRef<SyncScheduler | null>(null);

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
    const scheduler = new SyncScheduler(engine);
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
  }, [enabled, progressRepository]);

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

  const value = useMemo<SyncContextValue>(
    () => ({
      status: state.status,
      errorKind: state.errorKind,
      pending: durableFacts.pending,
      lastSuccessAt: durableFacts.lastSuccessAt,
      retrySync,
    }),
    [state.status, state.errorKind, durableFacts, retrySync],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncStatus(): SyncContextValue {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error("useSyncStatus must be used inside SyncProvider");
  }
  return context;
}
