import type { LearnerProfile, LearnerProfileRepository } from "../progress/progress-repository";

/**
 * The profile operations this service drives. Narrowed from {@link LearnerProfileRepository} to the
 * five it actually calls, so a fake in a test only has to answer for those.
 */
export type ProfileStore = Pick<
  LearnerProfileRepository,
  | "getActiveProfile"
  | "createAuthenticatedProfile"
  | "activateEmptyAnonymousProfile"
  | "setActiveProfile"
  | "mergeAnonymousProfile"
>;

/**
 * Decides which local learner profile the app reads and writes as accounts come and go.
 *
 * Entirely local: no method here talks to Supabase. Accounts are optional, so every path has to work
 * with the network absent — signing in must not wait on a server to decide where progress lives.
 */
export interface ProfileService {
  /** Ensures a guest profile is active, keeping the current one when it already is one. */
  activateAnonymous(): Promise<LearnerProfile>;
  /**
   * Activates the profile bound to `userId`, creating it on first sign-in and reopening the cached
   * one for a returning account. Progress built up as a guest is merged in on the way, so the
   * learner does not lose it by signing in.
   */
  activateAuthenticated(userId: string): Promise<LearnerProfile>;
  /** Leaves the account's profile cached and untouched, and hands the device back to a guest. */
  signOut(): Promise<LearnerProfile>;
}

export function createProfileService(store: ProfileStore): ProfileService {
  return {
    async activateAnonymous() {
      const active = await store.getActiveProfile();
      if (isUnmergedGuest(active)) {
        return active;
      }
      return store.activateEmptyAnonymousProfile();
    },

    async activateAuthenticated(userId) {
      const active = await store.getActiveProfile();
      const target = await store.createAuthenticatedProfile(userId);

      // Only the guest profile in front of the learner right now may be claimed. An already merged
      // one belongs to another account, and an authenticated one belongs to another sign-in — so
      // switching accounts never carries progress across.
      if (isUnmergedGuest(active) && active.id !== target.id) {
        await store.mergeAnonymousProfile(active.id, target.id);
      }

      await store.setActiveProfile(target.id);
      return target;
    },

    async signOut() {
      return store.activateEmptyAnonymousProfile();
    },
  };
}

function isUnmergedGuest(profile: LearnerProfile): boolean {
  return profile.kind === "anonymous" && profile.mergedIntoProfileId === null;
}
