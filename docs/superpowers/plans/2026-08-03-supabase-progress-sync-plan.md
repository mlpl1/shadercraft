# Supabase Progress Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional Supabase accounts and reliable cross-device lesson-progress synchronization while preserving immediate offline SQLite behavior.

**Architecture:** Every progress action remains a local SQLite transaction that also creates a profile-partitioned outbox mutation. A session-aware sync engine sends idempotent mutations through a revision-checking Supabase RPC, rebases explicit local actions after conflicts, and pulls changes through a durable monotonic cursor.

**Tech Stack:** Expo SDK 57, Expo SQLite, Supabase Auth/Postgres/RLS, `@supabase/supabase-js`, React Native URL polyfill, Supabase CLI migrations, Jest with deterministic fake adapters.

## Global Constraints

- Complete the Local SQLite Curriculum plan before this plan.
- Accounts remain optional and offline learning never waits for Supabase.
- Screens continue reading progress only from SQLite.
- Authenticated and anonymous progress are isolated by local learner profile.
- Supabase secrets with service-role authority never enter the mobile bundle.
- Conflict ordering uses server revisions, not device timestamps.
- Outbox mutations are never deleted before server acknowledgement.
- Every task ends in a focused commit and leaves local-only use working.

---

## File Structure

- `supabase/config.toml` — local Supabase project configuration.
- `supabase/migrations/202608030001_progress_sync.sql` — progress tables, sequence, RLS, and RPC.
- `supabase/tests/database/progress_sync.test.sql` — database policy and mutation behavior tests.
- `.env.example` — public mobile Supabase configuration names.
- `src/data/auth/auth-service.ts` — session/authentication interface.
- `src/data/auth/supabase-auth-service.ts` — Supabase implementation.
- `src/data/auth/profile-service.ts` — local profile activation and anonymous merge.
- `src/data/supabase/client.ts` — configured browser-safe Supabase client.
- `src/data/sync/progress-remote.ts` — remote progress protocol.
- `src/data/sync/supabase-progress-remote.ts` — RPC/query adapter.
- `src/data/sync/progress-sync-engine.ts` — deterministic push/rebase/pull algorithm.
- `src/data/sync/sync-scheduler.ts` — connectivity/session/app-state scheduling and backoff.
- `src/context/auth-context.tsx` — optional account state.
- `src/context/sync-context.tsx` — sync health and manual retry state.
- `src/app/account.tsx` — minimal sign-up, sign-in, sign-out, and sync status screen.

---

### Task 1: Create and test the Supabase progress schema

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202608030001_progress_sync.sql`
- Create: `supabase/tests/database/progress_sync.test.sql`

**Interfaces:**
- Produces: `public.lesson_progress`, `public.progress_mutations`, and the
  `public.apply_progress_mutation` RPC defined below.
- Consumes: Supabase `auth.users` and `auth.uid()`.

- [ ] **Step 1: Install and initialize the Supabase CLI**

Run:

```bash
npm install --save-dev supabase
npx supabase init
```

Keep the generated local project ID non-secret. Do not link a remote project in this task.

- [ ] **Step 2: Write the failing database tests**

The SQL test must create two test users and verify:

- A user can select only their own progress.
- Direct writes cannot target another user ID.
- Applying one mutation creates revision `1` and one change ID.
- Applying the same mutation ID again returns the original result without another revision.
- Applying a stale base revision returns `conflict = true` without changing progress.
- Applying a rebased mutation creates the next revision.

Use transaction-scoped test JWT claims such as
`set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true)`
and roll the test transaction back.

- [ ] **Step 3: Run the database test and verify failure**

Run:

```bash
npx supabase start
npx supabase test db
```

Expected: FAIL because the progress schema and RPC do not exist.

- [ ] **Step 4: Implement the progress tables and global change sequence**

Create:

```sql
create sequence public.progress_change_id_seq;

create table public.lesson_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  completed boolean not null,
  revision bigint not null default 0,
  change_id bigint not null default nextval('public.progress_change_id_seq'),
  updated_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table public.progress_mutations (
  mutation_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lesson_id text not null,
  completed boolean not null,
  resulting_revision bigint not null,
  resulting_change_id bigint not null,
  accepted_at timestamptz not null default now()
);
```

Add a trigger that assigns `nextval('public.progress_change_id_seq')` and `now()` on each accepted
progress update.

- [ ] **Step 5: Add RLS and the revision-checking RPC**

Enable RLS on both tables. Policies permit authenticated users to select their own rows. Revoke
direct insert/update/delete from authenticated clients; progress writes occur through a
`security definer` function whose first statement captures and validates `auth.uid()`.

The RPC signature is:

```sql
public.apply_progress_mutation(
  p_mutation_id uuid,
  p_lesson_id text,
  p_completed boolean,
  p_base_revision bigint
)
returns table (
  applied boolean,
  conflict boolean,
  completed boolean,
  revision bigint,
  change_id bigint
)
```

Serialize changes to the same `(user_id, lesson_id)` with
`SELECT revision FROM public.lesson_progress WHERE user_id = v_user_id AND lesson_id = p_lesson_id FOR UPDATE`.
Insert into
`progress_mutations` only after an accepted state change. Return the recorded result immediately
when the mutation ID already exists.

- [ ] **Step 6: Verify the database contract**

Run: `npx supabase test db`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json supabase
git commit -m "feat(sync): define secure revisioned progress storage"
```

### Task 2: Add the Supabase client and authentication service

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `.env.example`
- Create: `src/data/supabase/client.ts`
- Create: `src/data/auth/auth-service.ts`
- Create: `src/data/auth/supabase-auth-service.ts`
- Create: `src/data/auth/__tests__/auth-service.test.ts`

**Interfaces:**
- Produces: `AuthService`, `SupabaseAuthService`, `getSupabaseClient()`,
  `isCloudSyncEnabled()`.
- Consumes: `EXPO_PUBLIC_SUPABASE_ENABLED`, `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

- [ ] **Step 1: Install the Expo-compatible Supabase client dependencies**

Run:

```bash
npm install @supabase/supabase-js react-native-url-polyfill
```

- [ ] **Step 2: Write failing auth-adapter tests**

Against a mocked Supabase auth client, verify:

```ts
await service.signUpWithPassword("learner@example.com", "correct horse battery staple");
expect(auth.signUp).toHaveBeenCalledWith({
  email: "learner@example.com",
  password: "correct horse battery staple",
});

await service.signOut();
expect(auth.signOut).toHaveBeenCalledTimes(1);
```

Also test session restoration and auth-state subscription cleanup.

- [ ] **Step 3: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/auth/__tests__/auth-service.test.ts`

Expected: FAIL because auth services are absent.

- [ ] **Step 4: Configure the client**

Create `.env.example`:

```dotenv
EXPO_PUBLIC_SUPABASE_ENABLED=false
EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_example_do_not_use
```

Import `react-native-url-polyfill/auto` and `expo-sqlite/localStorage/install` before creating the
client. Configure persistent sessions, automatic refresh, and `detectSessionInUrl: false`. Throw a
descriptive startup error when either URL/key value is absent while
`EXPO_PUBLIC_SUPABASE_ENABLED=true`. When the flag is false, return a disabled auth service and keep
all local functionality available without constructing a Supabase client.

- [ ] **Step 5: Implement the auth interface**

```ts
export interface AuthService {
  getSession(): Promise<AuthSession | null>;
  subscribe(listener: (session: AuthSession | null) => void): () => void;
  signUpWithPassword(email: string, password: string): Promise<SignUpResult>;
  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}
```

The public session type contains no token material:

```ts
export type AuthSession = {
  userId: string;
  email: string;
};

export type SignUpResult =
  | { kind: "signed-in" }
  | { kind: "confirm-email"; email: string };
```

Map a Supabase sign-up response without a session to `confirm-email`; the account screen must show
that state instead of reporting a failed sign-up.

Normalize Supabase errors into safe user-facing messages without including tokens.

- [ ] **Step 6: Verify**

Run:

```bash
npm test -- --runInBand src/data/auth
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .env.example src/data/supabase src/data/auth
git commit -m "feat(auth): add optional Supabase account services"
```

### Task 3: Implement isolated local profiles and anonymous merge

**Files:**
- Create: `src/data/auth/profile-service.ts`
- Create: `src/data/auth/__tests__/profile-service.test.ts`
- Modify: `src/data/progress/progress-repository.ts`
- Modify: `src/data/progress/sqlite-progress-repository.ts`

**Interfaces:**
- Produces: `ProfileService.activateAnonymous()`,
  `ProfileService.activateAuthenticated(userId)`, `ProfileService.signOut()`.
- Consumes: SQLite learner profiles, progress rows, and outbox from the local plan.

- [ ] **Step 1: Write failing profile-isolation tests**

Test this exact sequence:

1. Anonymous profile completes lessons A and B and explicitly uncompletes C.
2. User 1 signs in; A/B/C are copied to User 1 and converted into authenticated mutations.
3. Source anonymous mutations are marked merged.
4. Signing out activates a different anonymous profile with no User 1 progress.
5. User 2 signs in and receives no User 1 or previously merged guest progress.
6. User 1 signs back in and sees the cached A/B/C state.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/auth/__tests__/profile-service.test.ts`

Expected: FAIL because profile activation and merge are absent.

- [ ] **Step 3: Extend the progress repository for profile operations**

Add:

```ts
getProfileBySupabaseUserId(userId: string): Promise<LearnerProfile | null>;
createAuthenticatedProfile(userId: string): Promise<LearnerProfile>;
setActiveProfile(profileId: string): Promise<void>;
mergeAnonymousProfile(sourceProfileId: string, targetProfileId: string): Promise<void>;
```

The merge transaction collapses source mutations to the latest explicit state per lesson, upserts
target progress, creates fresh target mutations, marks source mutations merged, and records the
source profile's merged target ID.

- [ ] **Step 4: Implement profile activation**

`activateAuthenticated` reuses the cached profile for a returning Supabase user. It merges only the
currently active, unmerged anonymous profile. `signOut` activates a reusable empty anonymous profile
or creates one.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --runInBand src/data/auth
npm test -- --runInBand src/data/progress
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/auth src/data/progress
git commit -m "feat(auth): isolate and merge local learner profiles"
```

### Task 4: Implement the Supabase progress adapter

**Files:**
- Create: `src/data/sync/progress-remote.ts`
- Create: `src/data/sync/supabase-progress-remote.ts`
- Create: `src/data/sync/__tests__/supabase-progress-remote.test.ts`

**Interfaces:**
- Produces: `ProgressRemote`, `SupabaseProgressRemote`.
- Consumes: RPC and progress table from Task 1, Supabase client from Task 2.

- [ ] **Step 1: Write failing adapter tests**

Mock `.rpc()` and `.from().select().gt().order()` to verify request/response mapping for applied,
conflict, repeated, empty-pull, and multi-page pull results.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/sync/__tests__/supabase-progress-remote.test.ts`

Expected: FAIL because the remote adapter is absent.

- [ ] **Step 3: Define the protocol**

```ts
export type RemoteMutationResult =
  | { kind: "applied"; completed: boolean; revision: number; changeId: number }
  | { kind: "conflict"; completed: boolean; revision: number; changeId: number };

export type AppliedProgressResult = {
  completed: boolean;
  revision: number;
  changeId: number;
};

export type RemoteProgressChange = AppliedProgressResult & {
  lessonId: string;
};

export interface ProgressRemote {
  applyMutation(mutation: ProgressMutation): Promise<RemoteMutationResult>;
  pullAfter(changeId: number, limit: number): Promise<RemoteProgressChange[]>;
}
```

- [ ] **Step 4: Implement strict Supabase mapping**

Call `apply_progress_mutation` with exact snake-case parameters. Treat missing/multiple RPC rows,
non-integer revisions, or missing lesson IDs as protocol errors. Pull ordered by `change_id` in pages
of 200 and never advance the cursor past an unparsed row.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --runInBand src/data/sync/__tests__/supabase-progress-remote.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/sync
git commit -m "feat(sync): adapt Supabase progress revisions"
```

### Task 5: Build the deterministic push/rebase/pull sync engine

**Files:**
- Create: `src/data/sync/progress-sync-engine.ts`
- Create: `src/data/sync/__tests__/progress-sync-engine.test.ts`
- Modify: `src/data/progress/progress-repository.ts`
- Modify: `src/data/progress/sqlite-progress-repository.ts`

**Interfaces:**
- Produces: `ProgressSyncEngine.sync(profileId)`.
- Consumes: `ProgressRemote`, pending outbox and cursor repository methods.

- [ ] **Step 1: Write failing sync-engine tests with a deterministic fake remote**

Cover:

- Push all queued mutations before the first pull.
- Remove an outbox row only after applied acknowledgement.
- Preserve the row after a transport failure.
- Rebase one conflict to the returned revision and resend the same mutation ID.
- Stop after three consecutive conflicts in one run and retain the row.
- Apply pulled changes and cursor atomically.
- Do not overwrite a lesson that still has a pending local mutation.
- Repeating the complete sync converges without extra writes.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/sync/__tests__/progress-sync-engine.test.ts`

Expected: FAIL because the engine is absent.

- [ ] **Step 3: Add repository sync primitives**

```ts
getPendingMutations(profileId: string): Promise<ProgressMutation[]>;
acknowledgeMutation(profileId: string, mutationId: string, result: AppliedProgressResult): Promise<void>;
rebaseMutation(profileId: string, mutationId: string, revision: number): Promise<void>;
applyRemoteChanges(profileId: string, changes: RemoteProgressChange[], cursor: number): Promise<void>;
getPullCursor(profileId: string): Promise<number>;
```

`applyRemoteChanges` skips rows with a pending local mutation for the same lesson and advances the
cursor in the same transaction.

- [ ] **Step 4: Implement push, bounded rebase, then paginated pull**

Expose one structured result:

```ts
type SyncResult = {
  pushed: number;
  pulled: number;
  pending: number;
  lastCursor: number;
};
```

Allow only one sync per profile at a time; concurrent callers await the same promise.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --runInBand src/data/sync
npm test -- --runInBand src/data/progress
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/sync src/data/progress
git commit -m "feat(sync): reconcile offline progress with server revisions"
```

### Task 6: Schedule synchronization and expose health state

**Files:**
- Create: `src/data/sync/sync-scheduler.ts`
- Create: `src/data/sync/__tests__/sync-scheduler.test.ts`
- Create: `src/context/auth-context.tsx`
- Create: `src/context/sync-context.tsx`
- Modify: `src/app/_layout.tsx`

**Interfaces:**
- Produces: `useAuth()`, `useSyncStatus()`, manual `retrySync()`.
- Consumes: auth/profile services and progress sync engine.

- [ ] **Step 1: Write failing scheduler tests with fake timers**

Verify sync on authenticated startup, foreground return, manual retry, and local mutation. Verify
backoff delays of 2, 4, 8, 16, 32, and 60 seconds maximum, reset after success, and no scheduled
sync while anonymous.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --runInBand src/data/sync/__tests__/sync-scheduler.test.ts`

Expected: FAIL because scheduling is absent.

- [ ] **Step 3: Implement scheduler and contexts**

Use auth session events and React Native `AppState`. Network requests themselves determine online
status; do not add a second connectivity dependency. Expose:

```ts
type SyncStatus = "offline" | "idle" | "syncing" | "attention";
```

Never show a blocking error for cloud failure. `attention` retains the last safe error category and
pending count.

- [ ] **Step 4: Wire provider order**

Place `AuthProvider` and `SyncProvider` inside `DataProvider` but outside Course/Progress consumers.
Auth changes call `ProfileService` before exposing the new active session to progress UI.

- [ ] **Step 5: Verify**

Run:

```bash
npm test -- --runInBand src/data/sync src/context
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/data/sync src/context src/app/_layout.tsx
git commit -m "feat(sync): schedule background progress synchronization"
```

### Task 7: Add the optional account screen and verify cross-device convergence

**Files:**
- Create: `src/app/account.tsx`
- Create: `src/app/__tests__/account.test.tsx`
- Modify: `src/app/course.tsx`
- Modify: `README.md`
- Create: `docs/data/progress-sync.md`

**Interfaces:**
- Consumes: `useAuth()`, `useSyncStatus()`.
- Produces: account entry point from Course and explicit retry/sign-out controls.

- [ ] **Step 1: Write failing account-screen tests**

Verify anonymous, submitting, authenticated, validation-error, auth-error, syncing, and attention
states, plus cloud-sync-disabled behavior. The anonymous screen uses email/password sign-up and
sign-in without blocking dismissal.

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- --runInBand src/app/__tests__/account.test.tsx`

Expected: FAIL because the route is absent.

- [ ] **Step 3: Implement the account screen in the existing visual system**

Add an account icon button to the Course header. The account screen contains:

- Email and password fields.
- Separate “Sign in” and “Create account” actions.
- Current account email when authenticated.
- Pending mutation count and last successful sync.
- “Retry sync” only in attention state.
- “Sign out” with confirmation that offline curriculum remains available.

Use accessible labels, disable duplicate submissions, and never display raw Supabase error payloads.
When `EXPO_PUBLIC_SUPABASE_ENABLED` is false, hide the Course account button; direct navigation to
`/account` shows a local-only informational state rather than constructing a Supabase client.

- [ ] **Step 4: Document configuration and operations**

Document `.env` setup, local Supabase commands, RLS test commands, account merge behavior, conflict
policy, and how to inspect pending SQLite outbox rows during development.

- [ ] **Step 5: Run full automated verification**

Run:

```bash
npx supabase test db
npm test -- --runInBand
npx tsc --noEmit
npm run content:check
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 6: Run two-client acceptance verification**

Using two emulators or one emulator plus a second clean application data profile:

1. Complete a lesson offline on device A.
2. Sign in and reconnect A; verify the outbox clears.
3. Sign in on B; verify the completion arrives.
4. Take both offline; complete on A and uncomplete on B.
5. Reconnect A, then B; verify B's last server-accepted action wins on both.
6. Sign out B; verify A's account progress is not visible in B's anonymous profile.
7. Sign back into the same account; verify cached progress resumes.

- [ ] **Step 7: Commit**

```bash
git add src/app README.md docs/data/progress-sync.md
git commit -m "feat(account): expose optional cross-device progress sync"
```
