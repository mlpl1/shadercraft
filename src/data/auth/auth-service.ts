/**
 * A signed-in learner, reduced to what the app is allowed to hold.
 *
 * Deliberately carries no token material: access and refresh tokens stay inside the Supabase client,
 * so nothing above this boundary can log or persist them by accident.
 */
export type AuthSession = {
  userId: string;
  email: string;
};

/**
 * Signing up either signs the learner straight in, or — when the project has email confirmations
 * enabled — succeeds while waiting for them to confirm. The second case is a successful sign-up
 * needing a further step, so it must not be presented as a failure.
 */
export type SignUpResult = { kind: "signed-in" } | { kind: "confirm-email"; email: string };

export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  subscribe(listener: (session: AuthSession | null) => void): () => void;
  signUpWithPassword(email: string, password: string): Promise<SignUpResult>;
  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const DISABLED_MESSAGE =
  "Cloud sync is disabled in this build, so accounts are unavailable. Progress is still saved on this device.";

/**
 * The auth service used when cloud sync is switched off.
 *
 * Reads report "no account" so every screen renders its signed-out state normally, and no Supabase
 * client is ever constructed. Account actions reject with an explanation rather than failing
 * obscurely — the UI should not offer them at all in this configuration, so reaching one is a bug
 * worth surfacing.
 */
export function createDisabledAuthService(): AuthService {
  return {
    async getSession() {
      return null;
    },
    subscribe() {
      return () => undefined;
    },
    async signUpWithPassword() {
      throw new Error(DISABLED_MESSAGE);
    },
    async signInWithPassword() {
      throw new Error(DISABLED_MESSAGE);
    },
    async signOut() {
      throw new Error(DISABLED_MESSAGE);
    },
  };
}
