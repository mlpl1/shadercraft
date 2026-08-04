# Optional accounts and cross-device progress sync

Shadercraft's curriculum and progress live entirely in on-device SQLite (see
[`docs/data/local-curriculum.md`](local-curriculum.md)) and work fully offline with no
configuration at all. This document covers the optional layer on top: Supabase-backed accounts
and background synchronization of lesson completions across a learner's devices. Nothing in this
document is required to build or run the app — with cloud sync switched off (the default), none of
it is even loaded.

## Turning cloud sync on locally

Cloud sync is controlled by `EXPO_PUBLIC_SUPABASE_ENABLED`, read once at module load in
`src/data/supabase/client.ts`. Left unset (or `false`), `isCloudSyncEnabled()` returns `false`,
`getSupabaseClient()` is never called, and every screen behaves as if accounts do not exist.

To exercise the account screen and sync against a real backend:

1. Copy `.env.example` to `.env.local`.
2. Start the local stack: `npx supabase start`. It prints the local API URL and keys; the same
   values are always available afterwards via `npx supabase status`.
3. Fill in `.env.local`:
   ```bash
   EXPO_PUBLIC_SUPABASE_ENABLED=true
   EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from `supabase status`>
   ```
   **An Android emulator cannot reach the host machine's `127.0.0.1`.** Use
   `http://10.0.2.2:54321` for `EXPO_PUBLIC_SUPABASE_URL` when running on an emulator; a physical
   device on the same network needs the host machine's LAN IP instead. A real deployed project's
   URL (`https://<project>.supabase.co`) works unchanged.
4. Only ever put the **publishable** key in `.env.local` (or in the deployed app's build
   config). It carries no authority by itself and every table it can reach is protected by row
   level security (below). The **service-role** key must never appear in `.env.local`, in the
   mobile bundle, or anywhere reachable from the app — it belongs only in the Supabase project's
   own server-side configuration.
5. Restart Metro (`npm run start`) so the new environment variables are picked up. `expo-router`
   also needs one full bundler pass to register the new `/account` route in its generated types
   the first time; a clean checkout's `npx tsc --noEmit` regenerates this automatically once
   `expo start` has run.

With cloud sync enabled, Course's header gains an account icon; without it, that icon is hidden
and `/account` — reachable only by typing the URL directly in development — renders a local-only
informational screen instead of ever constructing a Supabase client.

## Local Supabase commands

| Command | Purpose |
| --- | --- |
| `npx supabase start` | Starts the local Postgres/Auth/Realtime stack in Docker. |
| `npx supabase status` | Prints the running stack's URLs and keys (API, DB, Studio, publishable/service-role keys). |
| `npx supabase stop` | Stops the local stack. |
| `npx supabase db reset` | Recreates the local database from `supabase/migrations/`, then reseeds. Use after editing a migration. |
| `npx supabase test db` | Runs the pgTAP suite in `supabase/tests/database/` against the local database (row-level-security and constraint checks). Requires the stack to be running. |

## RLS and database tests

`supabase/tests/database/progress_sync.test.sql` is a pgTAP suite that exercises the server contract
directly against Postgres, acting as two fixture users in the `authenticated` role: that row level
security is enabled and a learner can neither see nor write another learner's `lesson_progress`
rows, that direct writes are refused so every change has to go through
`apply_progress_mutation`, that replaying a mutation id is idempotent while replaying *another
user's* mutation id is refused outright, and that revision/`change_id` ordering behaves — including
that an accepted update takes a new, larger `change_id`, which is what every other device's pull
cursor depends on.

Two things it deliberately does **not** cover. There is no server-side equivalent of SQLite's
`sync_outbox`; the outbox is purely local (see below). And it never leaves the `authenticated` role,
so it says nothing about what an unauthenticated (`anon`) caller can do — that is enforced by the
`revoke ... from anon` grants and the `28000` guard in `apply_progress_mutation`
(`supabase/migrations/202608030001_progress_sync.sql`), and asserting it would mean driving the
suite as `anon` as well. Run it with:

```bash
npx supabase start   # once, if not already running
npx supabase test db
```

This is independent of the Jest suite (`npm test -- --runInBand`), which covers the TypeScript
data layer (`AuthService`, `ProfileService`, `ProgressSyncEngine`, `SyncScheduler`) against fakes
and never touches a real Postgres instance. Both must pass; neither substitutes for the other.

## Account/profile merge behavior

Every device always has exactly one *active local learner profile*, tracked in SQLite's
`learner_profiles` table (`src/data/database/migrations.ts`) and owned by `ProfileService`
(`src/data/auth/profile-service.ts`):

- A fresh install starts on an **anonymous** profile. All progress accumulates against it.
- **Signing in** (`activateAuthenticated(userId)`) resolves to that Supabase user's profile —
  creating it on a first-ever sign-in from any device, reopening the cached one on a returning
  sign-in. If the anonymous profile in front of the learner at that moment has not already been
  merged into some other account, its progress is merged into the authenticated profile first, so
  progress made before signing in is not lost.
- **Signing out** (`AuthService.signOut()`, surfaced through the account screen's confirmation)
  always hands the device back to a guest profile via `ProfileService.signOut()` — never
  `activateAnonymous()`, which deliberately refuses to run while an authenticated profile is
  active. This is what keeps a signed-out device from ever reading or writing an authenticated
  profile's rows as if it were a guest.
- Switching to a **different** account on the same device never merges progress across accounts:
  only the guest profile actually in front of the learner at sign-in time is eligible to merge,
  and an already-authenticated or already-merged profile is left untouched.

`src/context/auth-context.tsx` (`AuthProvider`) drives all of this from Supabase's own session
state, so the account screen and every other screen never call `ProfileService` directly — they
read `useAuth().profileId`/`session` and the progress repository does the rest.

## Conflict policy

Two devices can edit the same lesson's completion while offline and only find out about each
other on their next successful sync. The rule, enforced by `ProgressSyncEngine`
(`src/data/sync/progress-sync-engine.ts`) and the Postgres functions in
`supabase/migrations/202608030001_progress_sync.sql`, is: **the most recently server-accepted
explicit action wins, ordered by the server's own revision counter — never by device clocks**,
which cannot be trusted to agree with each other. A device whose mutation is rejected as stale
(its `base_revision` no longer matches the server's) rebases onto the server's current state and
resends under a fresh revision rather than dropping the mutation.

Outbox mutations (`sync_outbox` in SQLite) are only ever deleted **after** the server has
acknowledged them — a mutation that fails to send, or fails partway through a device losing
connectivity, is retried on the next pass rather than lost. Their *upload* order comes from SQLite's
`rowid`, which is monotonic per insert, for the same reason conflicts are ordered by server revision:
the device clock cannot be trusted to order two actions taken in the same millisecond, and the server
treats the last action it accepts for a lesson as authoritative.

Every request a pass makes also carries the Supabase account that pass is scoped to, and
`SupabaseProgressRemote` checks it against the client's live session before each request. The client
is a singleton that attaches whichever JWT is current *at request time*, so signing into a different
account while a pass is in flight would otherwise send the first account's mutations under the
second's session — which the server accepts and files as the new account's own work. The check turns
that into an `auth` failure instead: the pass stops, the outbox is untouched, and sync resumes under
the right identity.

A mutation the server *permanently* refuses (`rejected` — a permission error, a constraint refusal, a
PostgREST 404 from a migration that is not deployed yet) is recorded against its own outbox row and
skipped for the rest of the pass. The remaining queue is still pushed and the pull still runs, so one
stuck lesson can never stop a device hearing from the learner's other devices. Once such a row has
accumulated `MAX_MUTATION_ATTEMPTS` recorded failures it is counted in `SyncResult.blocked` and the
account screen shows a non-blocking "Needs attention" rather than a clean "Up to date"; the row is
still kept and still offered once per pass, because some causes of a permanent rejection are fixed
somewhere else entirely and abandoning the learner's action outright has no way back.

## Inspecting the local outbox during development

Every unsynced lesson completion/incompletion is a row in SQLite's `sync_outbox` table until the
server accepts it, at which point the row is **deleted** — acknowledgement is the only thing that
ever removes one (`SqliteProgressRepository.acknowledgeMutation`). `merged_at` is a different signal
entirely: it is stamped by `mergeAnonymousProfile` on the *source* guest profile's rows, which are
retired in place because the merge re-queues that progress under the account instead, and are never
uploaded. So a row with `merged_at` set is not a synced row — it is one that will never sync. To
inspect the table on a connected device or emulator with `adb`:

```bash
# Pull the on-device database out to inspect locally (requires a debug build).
adb shell "run-as <application-id> cat /data/data/<application-id>/files/SQLite/shadercraft.db" \
  > shadercraft.db

# Then, with any SQLite client:
sqlite3 shadercraft.db "SELECT rowid, profile_id, mutation_id, entity_id, operation, base_revision, attempts, merged_at FROM sync_outbox ORDER BY rowid;"
```

`rowid` — not `created_at` — is upload order: it is the only value here that is monotonic per insert,
and upload order decides which of two actions on the same lesson the server accepts last and treats
as authoritative (`SqliteProgressRepository.getPendingMutations`).

Rows with `merged_at IS NULL` are still pending — the partial index
`idx_sync_outbox_profile_pending_created_at` is what makes that filter cheap, and it is also what the
account screen's "Pending changes" count reflects. That count is read from this table by `SyncProvider`
(`getPendingMutations`), not taken from the last pass's `SyncResult.pending`: the moments the number
matters most are the ones where no pass has run since — a device with no network, or one that queued a
change while a pass was already reading the outbox — and a pass's own figure is stale in exactly those
cases.

The same applies to the "Last successful sync" readout, which is `sync_state.last_success_at` read
through `ProgressSyncRepository.getLastSyncSuccessAt`, so it survives relaunches. It is `NULL` until a
pass actually *moves* something: a pass with nothing to push and nothing to pull deliberately records
nothing (see `ProgressSyncEngine.runOnce`, whose `recordSyncSuccess` call exists only to keep the column
fresh for a pass that pushed but had nothing to pull), so a brand-new account can sync cleanly and still
read "Not yet". That is not a failure, and the screen never presents it as one.

To inspect the server side instead, `npx supabase status` prints `STUDIO_URL`
(`http://127.0.0.1:54323` by default) — Supabase Studio's table editor and SQL editor work against
the local stack exactly as they would against a deployed project.

## The account screen

`src/app/account.tsx` is the only user-facing surface this feature adds, reachable from an account
icon in Course's header (`src/app/course.tsx`) that is itself hidden whenever cloud sync is
disabled. It renders one of:

- **Cloud sync disabled** — a local-only explanation, no sign-in fields, no Supabase client ever
  constructed (checked directly via `isCloudSyncEnabled()`, not inferred from session state).
- **Anonymous, cloud sync enabled** — email/password fields with separate "Sign in" and "Create
  account" actions. Client-side validation (a plausible email shape, a 6+ character password —
  matching `supabase/config.toml`'s `minimum_password_length`) runs before any network call. A
  sign-up that comes back awaiting email confirmation (`SignUpResult.kind === "confirm-email"`) is
  shown as a success needing a further step, never as an error.
- **Authenticated** — the signed-in email (never any token material — `AuthSession` does not carry
  any), the current sync status, the queued-mutation count, and the durable "last successful sync"
  timestamp. A "Retry sync" action appears only in the `attention` state; sync health is otherwise
  purely informational and never blocks anything. "Sign out" asks for confirmation, explicitly noting
  that offline progress on the device remains available either way.

## Sync status, and what each one means

`SyncScheduler` publishes one of six statuses (`src/data/sync/sync-scheduler.ts`), and they are kept
distinct because a learner reads each of them differently — one shared name for several of them is what
made a working sync look broken:

| Status | Means | Screen reads |
| --- | --- | --- |
| `signed-out` | No authenticated session. Nothing syncs; nothing is wrong. | (the sign-in panel) |
| `offline` | Signed in, but the device reports no usable network. Nothing is attempted or scheduled. | "Offline — N changes waiting" |
| `syncing` | A pass is running. | "Syncing…" |
| `retrying` | One pass failed with a network up; an automatic retry is on the backoff ladder. | "Waiting to retry" |
| `up-to-date` | The last pass succeeded and the server refuses nothing. | "Up to date", or "N changes waiting to sync" if the outbox is not empty |
| `attention` | Repeated failure, an expired session, or a mutation the server keeps refusing. | "Needs attention" + a "Retry sync" action |

Connectivity is what makes `offline` possible, and it is the fix for a real delay: the backoff ladder
runs 2s → 60s, so a device that lost its network mid-outage used to sit out the remaining wait long
after the network was back. `SyncProvider` watches `expo-network` (the only place it is imported) and
feeds a framework-free `SyncConnectivityMonitor` into the scheduler, which:

- attempts nothing while the device reports itself offline — every request would fail on the first byte,
  and spending backoff steps on that is what caused the delay;
- **syncs immediately** when connectivity returns, cancelling any pending backoff wait;
- does *not* reset the failure streak on a network return — only a successful pass earns that, so a
  flapping connection still escalates to `attention` instead of looping on the first rung forever;
- leaves an `auth` `attention` state alone in either direction, since a network that came and went says
  nothing about a session the server has already refused.

An *unknown* network state is treated as **reachable**, never as offline. Every field of
`NetworkState` is optional and `isInternetReachable` is `undefined` on platforms that do not probe;
only an explicit negative counts, because a device with an ambiguous state must be allowed to try and
let the attempt decide rather than stop syncing outright.

`expo-network` is a native module, so adding it needs a rebuild (`npm run android` / `npm run ios`) —
a Metro reload will not pick it up. With `EXPO_PUBLIC_SUPABASE_ENABLED` unset, no listener is registered
and the platform is never even queried; `src/context/__tests__/disabled-cloud-sync.test.tsx` asserts
exactly that.

Errors surfaced from `AuthService` calls are shown as-is (they are already normalised, safe `Error`
messages with no raw Supabase payload); sync errors are shown only as their pre-classified kind
(`"transport"`, `"auth"`, or `"rejected"`) with a fixed, safe description per kind — never the
underlying network/Postgres error text.
