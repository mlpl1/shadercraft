import type { SupabaseClient } from "@supabase/supabase-js";

import type { AuthService, AuthSession, SignUpResult } from "./auth-service";

type SupabaseUserLike = { id: string; email?: string | null };
type SupabaseSessionLike = { user: SupabaseUserLike };
type SupabaseErrorLike = { message: string };

/**
 * The slice of Supabase's auth client this service actually uses.
 *
 * Narrowed on purpose: the real client satisfies it structurally, while tests can supply a plain
 * object instead of impersonating GoTrue internals, and the compiler still catches drift if a call
 * site here stops matching the real shape.
 */
export type SupabaseAuthLike = {
  getSession(): Promise<{
    data: { session: SupabaseSessionLike | null };
    error: SupabaseErrorLike | null;
  }>;
  onAuthStateChange(
    callback: (event: string, session: SupabaseSessionLike | null) => void,
  ): { data: { subscription: { unsubscribe(): void } } };
  signUp(credentials: { email: string; password: string }): Promise<{
    data: { session: SupabaseSessionLike | null; user: SupabaseUserLike | null };
    error: SupabaseErrorLike | null;
  }>;
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    data: { session: SupabaseSessionLike | null; user: SupabaseUserLike | null };
    error: SupabaseErrorLike | null;
  }>;
  signOut(): Promise<{ error: SupabaseErrorLike | null }>;
};

function toSession(session: SupabaseSessionLike | null): AuthSession | null {
  if (!session) return null;
  return { email: session.user.email ?? "", userId: session.user.id };
}

/**
 * Supabase-backed accounts.
 *
 * Errors are re-thrown as plain `Error`s carrying only Supabase's own message, so nothing downstream
 * can accidentally surface or persist the token material attached to the original response.
 */
export class SupabaseAuthService implements AuthService {
  constructor(private readonly auth: SupabaseAuthLike) {}

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.auth.getSession();
    if (error) throw toSafeError(error);
    return toSession(data.session);
  }

  subscribe(listener: (session: AuthSession | null) => void): () => void {
    const { data } = this.auth.onAuthStateChange((_event, session) => {
      listener(toSession(session));
    });
    return () => data.subscription.unsubscribe();
  }

  async signUpWithPassword(email: string, password: string): Promise<SignUpResult> {
    const { data, error } = await this.auth.signUp({ email, password });
    if (error) throw toSafeError(error);

    if (data.session) return { kind: "signed-in" };

    // Fall back to the address they typed: Supabase can omit it on the returned user.
    return { email: data.user?.email ?? email, kind: "confirm-email" };
  }

  async signInWithPassword(email: string, password: string): Promise<void> {
    const { error } = await this.auth.signInWithPassword({ email, password });
    if (error) throw toSafeError(error);
  }

  async signOut(): Promise<void> {
    const { error } = await this.auth.signOut();
    if (error) throw toSafeError(error);
  }
}

function toSafeError(error: SupabaseErrorLike): Error {
  return new Error(error.message || "Supabase rejected the request.");
}

/**
 * Builds the service from a real client.
 *
 * This exists as much for the type check as for convenience: it is the one place the compiler
 * confirms a real Supabase client still satisfies {@link SupabaseAuthLike}. Without it the narrow
 * type could drift from the library and only fail at runtime. Type-only import, so no client code is
 * pulled in for builds with cloud sync switched off.
 */
export function createSupabaseAuthService(client: SupabaseClient): SupabaseAuthService {
  return new SupabaseAuthService(client.auth);
}
