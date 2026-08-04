import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import {
  createDisabledAuthService,
  type AuthService,
  type AuthSession,
  type SignUpResult,
} from "../data/auth/auth-service";
import { createProfileService, type ProfileStore } from "../data/auth/profile-service";
import { createSupabaseAuthService } from "../data/auth/supabase-auth-service";
import { getSupabaseClient, isCloudSyncEnabled } from "../data/supabase/client";
import { useData } from "./data-context";

type AuthContextValue = {
  /**
   * The activated session. Only ever updated once the matching local learner profile switch (see
   * `ProfileService`) has actually finished — never the instant Supabase reports a change — so a
   * consumer keyed off this (in particular `SyncProvider`) can never read or push under the wrong
   * profile. `undefined` before the very first session read has resolved.
   */
  session: AuthSession | null | undefined;
  /** The local learner profile currently active, kept in step with `session` for the same reason. */
  profileId: string | null;
  /** True once the first session read and its profile activation (success or failure) have settled. */
  isHydrated: boolean;
  /**
   * Set when a profile activation failed. Never blocking: the previously exposed `session`/`profileId`
   * are left in place, so local reads and writes keep working against whichever profile they already
   * had. Worth a caller surfacing non-intrusively (Task 7), not worth an error screen.
   */
  error: Error | null;
  signUpWithPassword: (email: string, password: string) => Promise<SignUpResult>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Bridges Supabase's optional accounts to the local learner profile they map to.
 *
 * Two rules carried forward from Task 3's review, enforced here rather than left to callers:
 * `ProfileService.activateAuthenticated` runs whenever a session is present, and leaving an account
 * goes through `ProfileService.signOut()` — never `activateAnonymous()`, which now refuses to demote
 * an authenticated profile. Telling those two cases apart needs to know what the *currently active*
 * profile actually is, not just whether this component thinks it saw a sign-in: a relaunch can find
 * the session gone (an unrefreshable token) while disk still holds an authenticated profile from
 * before, and that must still resolve through `signOut()`, not a doomed `activateAnonymous()` call.
 *
 * `session`/`profileId` are exposed only once that switch has actually finished, which is what keeps
 * `SyncProvider` from ever reading a session ahead of the profile it scopes.
 */
export function AuthProvider({ children }: PropsWithChildren) {
  const data = useData();
  // `LearnerProfileRepository` (here narrowed to `ProfileStore`) is deliberately not part of
  // `ProgressRepository` — see `src/data/progress/progress-repository.ts` — because progress screens
  // and profile management have different consumers. The concrete `SqliteProgressRepository`
  // implements both, and `DataProvider` is intentionally left unchanged by this task, so widening the
  // type here is how that split is surfaced to a consumer that legitimately needs both facets.
  const profileStore = (data.status === "ready" ? data.progressRepository : null) as unknown as
    | ProfileStore
    | null;

  const authService = useMemo<AuthService>(
    () =>
      isCloudSyncEnabled()
        ? createSupabaseAuthService(getSupabaseClient())
        : createDisabledAuthService(),
    [],
  );
  const profileService = useMemo(
    () => (profileStore ? createProfileService(profileStore) : null),
    [profileStore],
  );

  const [rawSession, setRawSession] = useState<AuthSession | null | undefined>(undefined);
  const [session, setSession] = useState<AuthSession | null | undefined>(undefined);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // 1. Track the raw Supabase session, independent of whether a local profile exists yet.
  useEffect(() => {
    let cancelled = false;

    authService
      .getSession()
      .then((initial) => {
        if (!cancelled) setRawSession(initial);
      })
      .catch((caughtError: unknown) => {
        if (!cancelled) {
          setError(
            caughtError instanceof Error ? caughtError : new Error("Failed to read the auth session"),
          );
          setRawSession(null);
        }
      });

    const unsubscribe = authService.subscribe((next) => {
      if (!cancelled) setRawSession(next);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [authService]);

  // 2. Switch the local learner profile to match, then — only once that settles — expose the new
  // session. Waits for `profileStore` (i.e. `DataProvider` becoming ready) rather than racing it.
  useEffect(() => {
    if (rawSession === undefined || !profileService || !profileStore) return;

    let cancelled = false;

    (async () => {
      try {
        let activeProfileId: string;
        if (rawSession) {
          const profile = await profileService.activateAuthenticated(rawSession.userId);
          activeProfileId = profile.id;
        } else {
          const active = await profileStore.getActiveProfile();
          const profile =
            active.kind === "authenticated"
              ? await profileService.signOut()
              : await profileService.activateAnonymous();
          activeProfileId = profile.id;
        }

        if (!cancelled) {
          setSession(rawSession);
          setProfileId(activeProfileId);
          setError(null);
          setIsHydrated(true);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(
            caughtError instanceof Error
              ? caughtError
              : new Error("Failed to activate the learner profile"),
          );
          setIsHydrated(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [rawSession, profileService, profileStore]);

  const signUpWithPassword = useCallback(
    (email: string, password: string) => authService.signUpWithPassword(email, password),
    [authService],
  );
  const signInWithPassword = useCallback(
    (email: string, password: string) => authService.signInWithPassword(email, password),
    [authService],
  );
  const signOut = useCallback(() => authService.signOut(), [authService]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profileId,
      isHydrated,
      error,
      signUpWithPassword,
      signInWithPassword,
      signOut,
    }),
    [session, profileId, isHydrated, error, signUpWithPassword, signInWithPassword, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
