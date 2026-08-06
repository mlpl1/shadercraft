# Shadercraft

Shadercraft is a mobile-first, interactive course for learning fragment shaders. Lessons
combine concise explanations, live OpenGL previews, GLSL source, and small experiments so
learners can see coordinate and rendering concepts change in real time.

The project is currently an early working prototype built with Expo and React Native.

## Current features

- Home dashboard and four-module curriculum browser
- Complete Module 01, Module 02, and Module 03 learning paths with sequential unlocking
- Interactive lessons spanning UV coordinates, time, transforms, distance fields, color mixing, luma, procedural palettes, and lighting
- Live `expo-gl` fragment shader with animated output
- Normalized and centered UV experiments that update both preview and GLSL source
- Persistent lesson completion and course progress
- Module unlocking derived from the shared progress state
- Reversible completion for accidentally completed lessons
- Guided completion summary with review and course-navigation actions
- Shader editor: write GLSL, watch it compile and render live, and keep sketches per profile — with
  per-line compile errors, and the last working version staying on screen while you type (see
  [`docs/data/shader-sandbox.md`](docs/data/shader-sandbox.md))
- Fully offline curriculum and progress, backed by an on-device SQLite database seeded from a
  checksummed, version-controlled content release
- Optional Supabase accounts and background cross-device progress synchronization, reachable from
  an account icon on the Course screen; disabled by default and entirely inert until configured
- Remote curriculum publishing: an immutable, checksummed course release can be published to
  Supabase and picked up by installed apps in the background, without an app-store update

Modules 01, 02, and 03 are published and contain 14 interactive lessons in total (five, five,
and four respectively). Every published module concludes with a layered shader challenge.
Completing Shape Synthesis unlocks Color & Light. Module 04, Procedural Textures, is currently
`planned`: it shows a five-topic roadmap card and stays unopenable until it ships real lessons.

## Technology

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- React Native 0.86 and React 19.2
- [Expo Router](https://docs.expo.dev/versions/v57.0.0/sdk/router/) for file-based navigation
- [Expo GLView](https://docs.expo.dev/versions/v57.0.0/sdk/gl-view/) for live shader rendering,
  including runtime compilation of learner-authored GLSL ES 1.00 (see
  [`docs/data/shader-sandbox.md`](docs/data/shader-sandbox.md); note that `expo-gl` does not work with
  remote debugging enabled)
- [`expo-sqlite`](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) for the local curriculum
  and progress database, the only runtime data source screens read from
- Zod-validated JSON content, compiled into a checksummed bundled release (see
  [`docs/data/local-curriculum.md`](docs/data/local-curriculum.md))
- AsyncStorage, only to migrate a device's pre-SQLite legacy completions on first launch
- [Supabase](https://supabase.com) for optional accounts and progress sync (see
  [`docs/data/progress-sync.md`](docs/data/progress-sync.md)); off by default, and never reached
  by any screen unless explicitly enabled
- Supabase also hosts immutable, published curriculum releases a device can download and activate
  in the background (see
  [`docs/data/curriculum-publishing.md`](docs/data/curriculum-publishing.md)); reads are open to
  every client, publishing is restricted to a service-role credential held only by CI
- TypeScript and the React Compiler

## Requirements

- Node.js 22.13 or newer
- npm
- Android Studio with an Android emulator, or a connected Android device
- A configured Android SDK and Java environment for native builds
- Docker, only if developing against a local Supabase stack for optional accounts/sync (see
  [`docs/data/progress-sync.md`](docs/data/progress-sync.md)) — not needed for offline curriculum
  and progress

Expo SDK 57 supports Android 7 and newer. iOS and web are configured, but current development
and device verification have focused on Android.

## Getting started

Install dependencies:

```bash
npm install
```

Build and launch the Android development client:

```bash
npm run android
```

For subsequent JavaScript and styling changes, start Metro and reopen the installed client:

```bash
npm run start
```

When a native dependency changes, run `npm run android` again so the package is included in
the installed application.

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run start` | Start the Expo development server |
| `npm run android` | Build and run the native Android application |
| `npm run ios` | Build and run the native iOS application |
| `npm run web` | Start the web version |
| `npm run content:build` | Regenerate `assets/course/bundled-course.json` from `content/module-*.json` |
| `npm run content:check` | Fail if the tracked bundled course is stale |
| `npm run content:publish -- --release <id>` | Publish authored content to Supabase as a new immutable release (requires `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`; see [`docs/data/curriculum-publishing.md`](docs/data/curriculum-publishing.md)) |
| `npm test` | Run the Jest suite |
| `npm run test:watch` | Run the Jest suite in watch mode |
| `npx tsc --noEmit` | Run the TypeScript check without emitting files |

## Project structure

```text
src/
├── app/          Expo Router screens and root layout
├── components/   Navigation, course, lesson, and shader UI
├── constants/    Shared visual theme
├── context/      React providers exposing the course and progress repositories
├── data/         SQLite lifecycle, course/progress repositories, and content schema
└── shaders/      The preview capability registry and GLSL previews
```

The Android native project is stored in `android/`. Static images and app icons are stored in
`assets/`.

## Progress behavior

Lesson completion is stored locally on the device in SQLite. Completing a lesson updates Home and
Course immediately and unlocks the next lesson in its module. A module unlocks once every module
ahead of it is fully complete; the first module is always unlocked. A completed lesson can be
marked incomplete after confirmation without deleting completion records for later lessons.
Progress survives app restarts and, on a device upgrading from an older release with no SQLite
database, migrates automatically from its legacy AsyncStorage record on first launch.

Progress syncs between a learner's own devices only when they explicitly sign in, and only in
builds with cloud sync configured — see [Optional accounts and sync](#optional-accounts-and-sync)
below. Without an account, progress stays local to the device, exactly as above.

## Optional accounts and sync

Signing in is entirely optional and off by default. With `EXPO_PUBLIC_SUPABASE_ENABLED` unset (a
fresh checkout), the account entry point on Course is hidden and nothing in the app ever talks to
Supabase — every feature above works exactly as if accounts did not exist.

When configured, an account icon appears on Course, leading to a screen where a learner can create
an account or sign in with email and password, see their signed-in email, the number of pending
local changes still waiting to reach the server, and — for a temporary sync problem — a way to
retry it. Signing in merges progress made anonymously on that device into the account; signing out
returns the device to local-only progress without losing it. Cross-device conflicts are resolved
by the most recent action the server actually accepted, not by comparing device clocks.

See [`docs/data/progress-sync.md`](docs/data/progress-sync.md) for how to configure a local
Supabase stack, the account/profile merge rules, the conflict policy, and how to inspect pending
sync rows during development.

## Curriculum content

The lesson content (copy, GLSL snippets, and preview wiring) is authored as JSON under
`content/`, one file per module, and compiled into the SQLite seed the app installs on first
launch. See [`docs/data/local-curriculum.md`](docs/data/local-curriculum.md) for the full
authoring workflow: which files to edit, the `content:build` / `content:check` commands, what
the schema validates, and the constraints around preview capabilities and release checksums.

A validated, checksummed release can also be published to Supabase and picked up by installed apps
in the background, without an app-store update. See
[`docs/data/curriculum-publishing.md`](docs/data/curriculum-publishing.md) for the immutability
contract, the pull-request and manual-publish CI workflows
(`.github/workflows/content-check.yml`, `.github/workflows/publish-course.yml`), compatibility
rules, and rollback by publishing a prior payload under a new release id. Two current limitations
documented there: a learner on a build too old for the active release gets no on-screen message
(the check just quietly fails to install), and a device that updates the app and then stays offline
can be stranded on the app update's own bundled curriculum instead of a newer one it had already
downloaded — no progress is lost either way, since progress is keyed by lesson id.

## Roadmap

- Editable GLSL with debounced shader recompilation and compiler feedback
- Configured linting (`expo lint` runs, but the project has no committed ESLint
  setup yet and currently reports pre-existing violations)
- Surface `requires-app-update` to the learner instead of silently declining to install (see
  [`docs/data/curriculum-publishing.md`](docs/data/curriculum-publishing.md))

## Contributing

Issues and focused pull requests are welcome while the curriculum and interaction model are
still evolving. Before submitting a change, run:

```bash
npm run content:check
npm test -- --runInBand
npx tsc --noEmit
```

If you edited any `content/module-*.json` file, run `npm run content:build` first and commit the
regenerated `assets/course/bundled-course.json` alongside your change — see
[`docs/data/local-curriculum.md`](docs/data/local-curriculum.md).
