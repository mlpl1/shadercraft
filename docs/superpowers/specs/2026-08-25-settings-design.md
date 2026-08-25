# Shadercraft Settings Design

**Date:** 2026-08-25  
**Status:** Approved for implementation planning

## Purpose

Shadercraft needs a single, truthful place for device preferences, account status, data export,
support, and app information. Settings will be a fifth root destination in the bottom navigation,
alongside Home, Course, Practice, and Editor.

The Stitch Settings screen is the visual reference: dark surfaces, acid-green section labels,
compact cards, segmented controls, and native switches. Its technical specification is not the
functional contract. Several items in that draft describe product or renderer capabilities that do
not exist and must not appear as disabled or misleading controls.

## Goals

- Add Settings as a first-class bottom-navigation destination.
- Centralize device-local preferences in one validated, versioned store.
- Let learners adjust editable GLSL typography and preview performance.
- Surface account and sync state without weakening Shadercraft's offline-first behavior.
- Let a learner export any saved sketch as a portable `.frag` file.
- Provide public support, safe diagnostics, documentation, version, repository, and license links.
- Ensure every visible control performs real behavior in the first release.

## Non-goals

This release does not add:

- subscriptions, FREE/PRO tiers, avatars, or premium entitlements;
- GLSL-version selection;
- resolution scaling or a promised 120 FPS mode;
- IntelliSense, autocomplete, word wrap, or syntax-highlight themes;
- a switch that disables autosave;
- light mode or custom accent colors;
- a shader compilation cache or a fake "Clear cache" action;
- bulk ZIP export, import, cloud sketch sync, or broad data-reset controls;
- password reset, account deletion, or other new account lifecycle operations;
- behavioral analytics or telemetry.

GLSL-version selection is specifically unsafe: authored curriculum, tutorials, sketches, and the
shader wrapper share one GLSL ES 1.00 contract. Preview performance controls may change scheduling,
but never language support or shader semantics.

## Navigation and Layout

Settings is a root route and the fifth item in the persistent bottom navigation. It uses a gear icon,
the label `SETTINGS`, and the same selected-state behavior as the other destinations. Because it is a
root tab, the Stitch back arrow is omitted. Native back behavior and deep-link handling follow the
existing root-route conventions.

The screen is vertically scrollable and retains the bottom navigation. It contains five sections in
this order:

1. Account
2. Editor
3. Preview performance
4. Data & storage
5. Help & about

Cards, controls, spacing, borders, and color roles reuse Shadercraft's existing theme rather than
copying web CSS values from the Stitch artifact.

## Account

Settings is the global entry point for account behavior. The Course screen's current account icon is
removed so the app does not present two competing entry points.

The section reflects existing configuration and context state:

- **Cloud disabled:** show `Local-only mode` and explain that data stays on this device. Do not show
  unusable authentication controls.
- **Cloud enabled and signed out:** show `Sign in or create account` and navigate to the existing
  Account route.
- **Cloud enabled and signed in:** show the learner's email, current sync status, and `Manage
  account`, which navigates to the existing Account route.

Settings does not duplicate sign-in forms or sync actions. Account and sync contexts remain the
source of truth.

## Device Preference Model

Preferences are device settings, not learner-profile data. A central settings repository stores one
versioned record in AsyncStorage and exposes it through a root `SettingsProvider`.

The initial record contains:

```ts
type DeviceSettings = {
  version: 1;
  editorFontSize: 12 | 14 | 16;
  showEditorLineNumbers: boolean;
  previewPerformance: "battery-saver" | "full-speed";
  editorPreviewMode: "responsive" | "square" | "wide";
};
```

Defaults are font size `14`, line numbers enabled, Full speed, and responsive preview mode. Existing
preview-mode persistence migrates into this record without discarding the learner's saved choice.

On startup, missing or malformed fields fall back independently to defaults. Unknown fields are
ignored. A future record version must be migrated explicitly rather than accepted implicitly.
Consumers receive safe defaults while hydration is pending, and accepted stored values replace them
once loading completes.

A setting change updates consumers immediately and then persists. If persistence fails, the value
rolls back to the last durable record and Settings shows a retryable error. Concurrent writes are
serialized so an older completion cannot overwrite a newer choice.

## Editor Preferences

The Editor section provides:

- a `12 / 14 / 16` segmented font-size control;
- a `Show line numbers` switch, enabled by default;
- an informational `Changes save automatically` row.

Font size and line-number visibility apply to editable GLSL in both the free editor and tutorial
workspace. Static lesson source remains unchanged because it is authored teaching material.

Line numbers are removed with their gutter when disabled. Syntax-highlight and native-input layers
must retain identical font metrics for all three sizes. Word wrap remains unavailable because the
current horizontal editor and line-number gutter intentionally depend on one visual row per source
line.

Autosave remains mandatory data-safety behavior. The informational row must not resemble an enabled
or disabled control.

## Preview Performance

The Preview performance section provides one two-state segmented control:

- **Battery saver:** target approximately 30 rendered frames per second by skipping animation-frame
  callbacks that arrive before the next render deadline.
- **Full speed:** render at the platform's normal animation-frame cadence.

The preference applies to every live `ShaderSandbox`: lesson stages, tutorials, the library, and the
free editor. It changes only presentation scheduling. Shader compilation, uniform values, animation
time, and output semantics remain identical. Battery saver uses elapsed timestamps rather than
slowing `iTime`; a shader therefore progresses through the same timeline with fewer presented
frames.

The UI does not promise an exact hardware frame rate. Backgrounded, inactive, collapsed, and
off-screen previews retain their existing pause/unmount behavior regardless of this preference.

## Data and Sketch Export

The Data & storage section explains that curriculum, progress, tutorials, and sketches work offline.
When cloud sync is enabled, it also summarizes the existing lesson-progress sync state without
implying that tutorials or sketches sync.

`Export sketch` opens a chooser containing sketches belonging to the active local profile. Choosing
one writes its source to a temporary UTF-8 `.frag` file and opens the platform share sheet. Export is
one sketch per action; bulk ZIP export is outside this release.

Export filenames:

- derive from the sketch name;
- remove or replace filesystem separators, control characters, and platform-invalid punctuation;
- trim unsafe leading/trailing whitespace and dots;
- use a stable fallback such as `shader.frag` if nothing remains;
- end in exactly `.frag`.

The file contains only shader source. It contains no account data, profile identifier, progress,
parameters, database metadata, or diagnostics. Temporary files may be overwritten or cleaned up by
later exports; they are not a second persistence system.

No-sketch, source-read, temporary-file, and share-sheet failures produce specific retryable messages
without leaving Settings. User cancellation is a successful dismissal, not an error.

## Help, Diagnostics, and About

The Help & about section contains:

- **Documentation:** opens the public repository README.
- **Report an issue:** opens `https://github.com/mlpl1/shadercraft/issues/new/choose`.
- **Copy diagnostics:** builds and previews an allowlisted plain-text report before copying it.
- **Repository:** opens `https://github.com/mlpl1/shadercraft`.
- **License:** opens the repository's public license file.
- **About:** displays the app version/build and active curriculum release.

The repository gains public bug-report and feature-request templates. Settings warns that GitHub
issues are public and that learners must not include personal information or private shader code.

Diagnostics may contain only values from this allowlist when available:

- Shadercraft version and native build number;
- platform and OS version;
- device model;
- active curriculum release id and content schema version;
- cloud sync enabled/disabled and signed-in/signed-out state, without email or user id;
- GL renderer and GL version obtained without compiling or copying learner source.

Diagnostics must never include email, user/profile/device identifiers, auth state tokens, Supabase
URLs or keys, shader source, sketch names, progress, local filesystem paths, database contents, or
free-form error logs. Missing values are omitted or labeled unavailable. Nothing is transmitted
automatically.

## Accessibility and Responsive Behavior

- Every control exposes an explicit label, current value, hint, and selected or checked state.
- Rows and segmented choices meet the app's existing minimum touch-target sizing.
- Section structure is announced semantically where React Native supports it.
- Large system text may increase row height; critical labels and values do not truncate.
- Focus order follows visual order, including the export chooser and diagnostics preview.
- Error and success messages are announced as alerts without stealing focus unnecessarily.
- Color is never the only indication of selection or failure.

Five compact bottom-navigation items must fit the supported phone widths without overlapping. Labels
remain visible; icon-only Settings navigation is not acceptable.

## Error Handling

- Preference hydration failure uses defaults and exposes a non-blocking Settings warning.
- Preference persistence failure rolls back the optimistic value and offers retry.
- Opening an unavailable external URL reports the failure instead of silently doing nothing.
- Export failures preserve the saved sketch and never mutate its database row.
- Account and sync errors continue through their existing context/UI paths.
- Settings remains usable when optional cloud services are disabled or unreachable.

## Testing and Release Verification

Automated coverage includes:

- preference defaults, validation, migration from the existing preview-mode key, serialization,
  concurrent writes, persistence failure, and rollback;
- Settings rendering for cloud disabled, signed out, signed in, and temporary sync failure states;
- fifth-tab navigation, selection, accessibility state, back behavior, and deep linking;
- immediate editor font-size and line-number propagation in free-editor and tutorial inputs;
- highlight/input metric alignment for each font size and both gutter states;
- Battery saver scheduling near 30 FPS without altering elapsed shader time;
- preservation of existing inactive/off-screen preview behavior;
- sketch selection, profile scoping, filename sanitization, exact source output, cancellation, and
  temporary/share failures;
- diagnostic allowlisting and explicit rejection of sensitive fields;
- external-link failure behavior and About metadata.

Before completion, run the full Jest suite, TypeScript, lint, content validation, Expo dependency
check, Expo Doctor, and database tests. Perform an Android device smoke test covering the fifth tab,
preference persistence across restart, preview mode changes, export/share cancellation, and external
links. Produce an iOS static export; native iOS interaction verification remains a macOS/device
release requirement.

## Documentation Changes

Implementation updates the README to describe Settings, device preferences, sketch export, and the
fact that AsyncStorage stores lightweight device preferences in addition to legacy migration data.
Documentation must continue to distinguish lesson-progress sync from local-only tutorial and sketch
data.
