# Offline Curriculum and Supabase Sync Design

Date: 2026-08-03

## Summary

Shadercraft will move from module-specific TypeScript curriculum files and a single
AsyncStorage progress blob to an offline-first data architecture. SQLite will be the runtime
source of truth for curriculum and learner progress. Supabase will provide optional accounts,
cross-device progress synchronization, and distribution of published curriculum releases.

Authors will edit version-controlled JSON files, initially one file per module. A validated
publishing process will convert those files into immutable Supabase curriculum releases and
produce the bundled seed used by new installations. Screens will never query Supabase directly.

This design serves three equally important goals:

1. Make lessons easier to add and maintain.
2. Support optional accounts and cross-device progress.
3. Publish compatible lesson-content changes without an app-store release.

The entire downloaded curriculum and all local progress must remain usable without a network
connection.

## Scope

### Included

- SQLite schema, migrations, and bundled curriculum seed
- Migration of existing AsyncStorage completion data
- Course and progress repository boundaries
- Version-controlled JSON curriculum authoring
- Curriculum validation and publishing to Supabase
- Optional Supabase authentication
- Local-first progress with a durable synchronization outbox
- Immutable curriculum releases and atomic background activation
- Server-revision conflict handling
- Compatibility checks for remotely published lessons
- Automated data, migration, repository, and synchronization tests

### Excluded

- A dedicated curriculum administration website
- Direct lesson authoring in the Supabase dashboard
- Arbitrary remotely downloaded GLSL implementations
- Cloud synchronization of user-authored shaders
- A generalized prerequisite graph or branching curriculum
- Replacing the existing preview renderer

Saved shaders may use the same repository and sync patterns later, but they are not part of this
migration.

## Guiding Decisions

- SQLite is the only database read by application screens.
- Supabase is a synchronization and publishing backend, not a runtime dependency for learning.
- Accounts are optional. A learner can start immediately and sign in later.
- Curriculum updates download in the background and activate only after complete validation.
- Remote lessons reference built-in preview capabilities through stable `preview_key` values.
- New preview capabilities require an application release.
- The most recently server-accepted explicit progress action wins across devices.
- Existing AsyncStorage progress is imported automatically and removed only after verification.

## Architecture

```text
React screens and providers
           |
Course and Progress repositories
           |
      Local SQLite
           |
  Background sync service
           |
        Supabase
```

### Application UI

Screens and UI components consume repository-backed providers or hooks. They do not import
module-specific curriculum arrays and do not call SQLite or Supabase directly. UI reads resolve
from SQLite immediately, regardless of connectivity.

The existing `ProgressProvider` may remain as the initial UI-facing API. Its persistence changes
from AsyncStorage functions to the progress repository. A course provider or equivalent hooks
will expose modules, lessons, presets, sections, current lessons, and unlock state.

### Course Repository

The course repository owns queries for:

- Active curriculum release
- Ordered modules and lessons
- Full lesson content
- Presets and explanatory sections
- Total and completed lesson counts
- Current and next lesson
- Sequential unlock state

The repository depends on SQLite, not React or Supabase.

### Progress Repository

The progress repository owns:

- Completion and explicit incompletion
- Progress percentages
- Local progress timestamps
- Server revisions
- Atomic creation of synchronization mutations
- Import of legacy completion data

A completion change updates the progress row and inserts its outbox mutation in the same SQLite
transaction.

### Sync Service

The sync service owns:

- Session-aware background synchronization
- Ordered and idempotent progress uploads
- Server revision conflict handling
- Cursor-based progress downloads
- Curriculum manifest checks and staged downloads
- Retry scheduling and sync-health state

The sync service communicates with Supabase through a small adapter interface. Tests can replace
that adapter with a deterministic fake.

### Content Validator

The content validator is shared conceptually by the publishing process and mobile activation
path. It checks schema compatibility, stable relationships, ordering, code highlights, preview
keys, application compatibility, and release checksums.

### Preview Registry

The preview registry maps stable database keys such as `lighting-diffuse` to capabilities already
implemented in the installed application. Remote content may change text, order, code examples,
highlighted lines, labels, and supported preview parameters. It may not introduce executable
preview behavior unknown to the installed app.

## Authoring Model

Curriculum authors edit JSON files in source control:

```text
content/
  module-01-foundations.json
  module-02-shapes.json
  module-03-color-light.json
  module-04-textures.json
```

One file per module balances readable reviews with manageable file count. The authoring format
contains module metadata and its ordered lessons, presets, code samples, highlighted lines, and
sections. It does not mirror normalized database rows exactly; the publishing tool performs that
conversion.

The build process also emits a canonical, checksummed seed artifact from the same validated source.
The artifact is bundled with the application and imported into SQLite transactionally on first
installation. It is generated data, not a second manually maintained curriculum source.

Stable IDs are mandatory and are never reused. Titles and positions may change without affecting
stored progress. Removing a lesson hides it from the active curriculum but does not delete its
historical progress row.

## Data Model

### Curriculum tables

```text
content_releases
  id
  schema_version
  minimum_app_version
  checksum
  published_at

modules
  release_id
  id
  position
  status
  title
  description
  planned_lesson_count
  planned_topics_json

lessons
  release_id
  id
  module_id
  position
  title
  short_title
  intro
  concept_title
  concept_lede
  takeaway

lesson_presets
  release_id
  id
  lesson_id
  position
  label
  preview_key
  preview_parameters_json
  value
  filename
  code_lines_json
  highlighted_lines_json

lesson_sections
  release_id
  id
  lesson_id
  position
  title
  body
```

Every content table uses `(release_id, id)` as its primary key. Foreign keys include `release_id`,
so two immutable releases may contain the same stable content IDs without colliding or linking
across releases.

Code lines, highlighted line numbers, and preview parameters remain JSON values because the app
loads each collection as a unit. Modules, lessons, presets, and sections remain normalized because
their identities, ordering, and relationships are queried independently.

An application metadata record identifies the locally active release. Downloaded records for a
new release remain staged until activation.

### Progress and synchronization tables

```text
learner_profiles
  id
  kind
  supabase_user_id
  created_at
  last_used_at

lesson_progress
  profile_id
  lesson_id
  completed
  server_revision
  locally_modified_at
  server_updated_at

sync_outbox
  profile_id
  mutation_id
  entity_type
  entity_id
  operation
  payload_json
  base_revision
  attempts
  created_at
  last_error

sync_state
  profile_id
  resource
  pull_cursor
  last_success_at
```

`lesson_progress` uses `(profile_id, lesson_id)` as its primary key. `learner_profiles.kind` is
either `anonymous` or `authenticated`; authenticated profiles have a unique Supabase user ID.
Outbox mutations and pull cursors are partitioned by profile, preventing one account's progress
from being uploaded into another account.

Absence of a progress row means the active learner profile has never explicitly changed that
lesson. An explicit incompletion remains a row with `completed = false`; this distinction is
required for merging anonymous work and synchronizing undo actions.

## Unlocking

Lessons unlock sequentially by position within a module. Modules unlock sequentially when the
previous module is complete. These rules are calculated by repository queries and domain helpers
using the active curriculum release and local progress.

`modules.status` is either `published` or `planned`. A planned module may provide a lesson count and
topic labels for the course roadmap without publishing incomplete lesson records. Planned lessons
do not contribute to progress totals and cannot open a lesson route. When a later curriculum
release changes the module to `published`, its complete validated lessons become available while
the stable module ID and ordering remain unchanged.

A generalized prerequisite graph is deferred until the product needs optional or branching
paths. This avoids schema and UI complexity that has no current consumer.

## Curriculum Publishing

The publishing command performs the following steps:

1. Parse every authoring file.
2. Validate the curriculum schema.
3. Verify globally unique stable IDs and deterministic ordering.
4. Verify highlighted line numbers exist in their code arrays.
5. Verify every `preview_key` and its parameters against the supported registry.
6. Set schema and minimum application versions.
7. Produce a deterministic release checksum.
8. Upload normalized records under a new release ID.
9. Verify the uploaded release.
10. Mark the release active only after complete success.

Published releases are immutable. A correction creates a new release. Previous releases remain
available for rollback and diagnostics.

The publishing command or CI environment holds the Supabase service-role credential. The mobile
application never receives that credential.

## Curriculum Download and Activation

The app always renders the active SQLite release first. When online, the sync service:

1. Fetches the active Supabase release manifest.
2. Compares its release ID and checksum with local metadata.
3. Stops if the local release is already current.
4. Rejects a release whose schema or minimum application version is incompatible.
5. Downloads the complete release into staged SQLite rows.
6. Validates IDs, relationships, ordering, preview keys, highlighted lines, and checksum.
7. Switches the local active release inside one SQLite transaction.
8. Schedules obsolete staged content for later cleanup.

The prior active release remains usable throughout download and validation. Failed, interrupted,
or incompatible downloads never become visible.

## Progress Synchronization

### Local mutation

Completing or uncompleting a lesson executes one SQLite transaction:

1. Upsert the explicit `lesson_progress` state.
2. Assign the local modification time.
3. Insert a unique mutation into `sync_outbox` with the current server revision.
4. Commit both operations.

The UI reflects the committed local state immediately. Authentication and connectivity are not
required.

### Push and pull

When a valid session and network are available, the sync service:

1. Uploads outbox mutations in creation order.
2. Uses each stable mutation ID for idempotent retries.
3. Receives the resulting server revision and update cursor.
4. Removes only acknowledged mutations.
5. Pulls server progress changes newer than the stored cursor.
6. Applies changes and advances the cursor in one local transaction.

Push runs before pull so the device does not overwrite its own pending local state with an older
server snapshot.

### Conflict policy

Supabase owns monotonically increasing record revisions. A mutation carries the revision on which
it was based. If the server has a newer revision, the server returns the current row rather than
silently accepting the stale base.

The sync service then applies the selected policy: it deliberately rebases the newest queued
explicit local action onto the returned revision and resends it. The newly accepted action receives
the next server revision and becomes authoritative. Mutations on a device remain ordered, and
mutation IDs prevent duplicate application.

This implements “most recently server-accepted explicit action wins” without comparing unreliable
device clocks.

Supabase Realtime may trigger an immediate sync after another device changes progress. Realtime
events do not write directly to SQLite and do not replace the durable pull cursor.

## Optional Authentication and Anonymous Merge

An account is not required to open the app, download bundled lessons, or record progress.

Before sign-in, explicit progress belongs to the active anonymous learner profile. On first
sign-in:

- Create or reopen the local profile bound to the Supabase user ID.
- Merge explicit rows from the active anonymous profile into that authenticated profile.
- Lessons without an anonymous explicit row defer to Supabase.
- Locally modified lessons enter the authenticated profile's outbox.
- Those actions synchronize through the normal revision flow.
- Imported legacy completions behave as explicit local completion actions.

Anonymous outbox entries never upload directly. During merge, the repository collapses them to the
latest explicit state for each lesson, creates new authenticated mutations with new IDs and the
authenticated profile's base revisions, and marks the source anonymous mutations as merged.

After a successful merge, mark the source anonymous rows as merged so they are not imported into a
different account later. Signing out pauses authenticated synchronization and switches to a new or
existing anonymous profile. The authenticated profile remains cached but is not displayed or
modified while signed out. Signing back into the same account reactivates its cached profile;
signing into a different account activates a separate profile.

Supabase Row Level Security restricts progress records to their owning user. Published curriculum
is publicly readable and writable only through trusted publishing credentials.

## Legacy AsyncStorage Migration

The existing `@shadercraft/progress/v1` value is imported once:

1. Create and migrate the SQLite schema.
2. Check the SQLite `legacy_progress_imported` marker.
3. Read and validate the AsyncStorage value.
4. Insert one explicit completed progress row per valid lesson ID under the active anonymous
   learner profile.
5. Record the import marker in the same SQLite transaction.
6. Read the inserted rows back and verify them.
7. Remove the AsyncStorage value only after verification.

The process is idempotent. If the application stops after the SQLite transaction but before
AsyncStorage cleanup, the marker and unique lesson IDs prevent duplicate progress. Unknown
historical IDs may be retained as progress rows but do not contribute to current visible totals.

## Failure Handling

- **No network:** continue entirely from SQLite and retain queued mutations.
- **Supabase unavailable:** retry with bounded exponential backoff.
- **Expired authentication:** pause authenticated sync, refresh the session, and preserve the
  outbox.
- **Invalid content:** reject staged rows and continue using the prior active release.
- **Unknown preview key:** reject the release before activation.
- **Interrupted download:** discard or resume staged content without affecting the active release.
- **Progress revision conflict:** rebase and resend according to the approved policy.
- **Repeated mutation failure:** retain the mutation and expose a non-blocking sync-attention state.
- **SQLite write failure:** roll back the transaction, restore prior UI state, and show a retryable
  error.
- **Schema migration failure:** roll back the migration and present a retryable startup error.

Content is reconstructible from the bundled seed or Supabase. Progress and outbox data are not, so
automatic recovery may remove corrupt staged content but must never discard progress or mutations.

Diagnostics may record release IDs, mutation IDs, table names, retry counts, and error categories.
They must not record authentication tokens or complete user-authored shader source.

## Testing Strategy

### Content validation

- Validate every authoring file against the curriculum schema.
- Require unique module, lesson, preset, and section IDs.
- Require complete deterministic ordering.
- Verify highlighted lines are within their code arrays.
- Verify preview keys and parameters against the registry.
- Verify bundled seed and authoring source checksums match.
- Reject incompatible releases before activation.

### Migration

- New installation without existing data
- Valid existing AsyncStorage progress
- Malformed legacy JSON
- Unknown historical lesson IDs
- Duplicate completed IDs
- Restart after SQLite import but before AsyncStorage cleanup
- Upgrade from every supported SQLite schema version

### Repositories and domain rules

- Module and lesson ordering
- Planned-module roadmap display and exclusion from progress totals
- Sequential unlocking
- Progress percentages
- Complete and uncomplete operations
- Stable progress after content reordering
- Removed lessons excluded from visible totals
- Anonymous-to-account merge and account switching isolation
- Transaction rollback after a simulated write failure

### Synchronization

A deterministic fake Supabase adapter verifies:

- Offline mutations remain queued.
- Repeated delivery is idempotent.
- Push occurs before pull.
- Pull resumes from its durable cursor.
- Revision conflicts follow the rebase policy.
- Two devices converge on the last server-accepted action.
- Authentication failure pauses work without deleting it.
- Partial curriculum downloads cannot replace active content.

### Android acceptance checks

1. Upgrade an installation containing current AsyncStorage progress.
2. Confirm all completion remains intact.
3. Browse the full curriculum in airplane mode.
4. Complete and uncomplete lessons offline.
5. Reconnect and verify synchronization.
6. Sign into a second device and verify convergence.
7. Publish a compatible release and verify atomic background activation.
8. Publish an incompatible release and verify the old content remains active.
9. Verify every database-loaded preview compiles through Expo GLView.

## Delivery Sequence

Implementation will be split into focused, independently verifiable commits:

1. Add the schema, SQLite lifecycle, migrations, and repository interfaces.
2. Convert existing curriculum into validated authoring JSON and generate the bundled seed.
3. Move course reads from TypeScript imports to the course repository.
4. Migrate progress and import existing AsyncStorage data.
5. Add automated tests around content, migrations, repositories, and domain rules.
6. Add the Supabase schema, Row Level Security, and authentication adapter.
7. Add the publishing command and immutable curriculum-release workflow.
8. Add progress outbox synchronization and revision conflict handling.
9. Add background curriculum download and atomic activation.
10. Complete Android offline, migration, multi-device, and release acceptance checks.

Each commit should preserve a runnable application and avoid combining unrelated mechanical and
behavioral changes.

## Success Criteria

- Screens no longer import module-specific curriculum data.
- A fresh install receives a complete bundled curriculum.
- Planned modules remain visible without creating incomplete lesson records.
- The entire active curriculum remains usable offline.
- Existing completion data survives the SQLite migration.
- Completing and uncompleting lessons works without authentication or connectivity.
- Optional sign-in synchronizes progress across devices.
- Compatible published curriculum releases activate without an app-store update.
- Incompatible or invalid releases never replace working local content.
- New remote lessons cannot reference unimplemented preview capabilities.
- All migrations, data validation, repositories, synchronization rules, and Android acceptance
  checks pass.

## Technical References

- Expo SDK 57 SQLite: https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/
- Supabase React Native authentication: https://supabase.com/docs/guides/auth/quickstarts/react-native
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Postgres Changes: https://supabase.com/docs/guides/realtime/postgres-changes
