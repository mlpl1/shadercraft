// The Supabase client needs a WHATWG-compliant URL and a synchronous storage API, neither of which
// React Native provides. Both shims must be installed before the client is constructed, so they are
// imported for side effects at module scope.
import "react-native-url-polyfill/auto";
import "expo-sqlite/localStorage/install";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ENABLED = process.env.EXPO_PUBLIC_SUPABASE_ENABLED === "true";
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * Whether this build talks to Supabase at all.
 *
 * Accounts and cross-device sync are optional: with the flag off, no client is constructed, nothing
 * reaches the network, and every local feature keeps working. That is also the default, so a
 * checkout with no `.env` runs fully offline.
 */
export function isCloudSyncEnabled(): boolean {
  return ENABLED;
}

let client: SupabaseClient | null = null;

/**
 * The shared Supabase client, created on first use.
 *
 * Only ever called when {@link isCloudSyncEnabled} is true. Misconfiguration fails loudly here
 * rather than surfacing later as confusing network errors.
 *
 * Note this is the *publishable* key, which is safe to ship in the app: it carries no authority of
 * its own and every table it can reach is protected by row level security. The service-role key must
 * never appear in this bundle.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!ENABLED) {
    throw new Error(
      "getSupabaseClient() was called while EXPO_PUBLIC_SUPABASE_ENABLED is not \"true\". Check isCloudSyncEnabled() first.",
    );
  }

  if (!URL || !PUBLISHABLE_KEY) {
    const missing = [
      URL ? null : "EXPO_PUBLIC_SUPABASE_URL",
      PUBLISHABLE_KEY ? null : "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    ].filter(Boolean);

    throw new Error(
      `Cloud sync is enabled but ${missing.join(" and ")} ${
        missing.length > 1 ? "are" : "is"
      } missing. See .env.example.`,
    );
  }

  client ??= createClient(URL, PUBLISHABLE_KEY, {
    auth: {
      autoRefreshToken: true,
      // There is no browser redirect to read a session back out of on native.
      detectSessionInUrl: false,
      persistSession: true,
    },
  });

  return client;
}
