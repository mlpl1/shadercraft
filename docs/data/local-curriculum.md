# Editing the Shadercraft curriculum

The curriculum is authored as version-controlled JSON, compiled into a single checksummed
release, and installed into an on-device SQLite database on first launch. SQLite is the only
runtime source screens read from — nothing in `src/app` or `src/components` reads the JSON
directly. This document covers what a contributor needs to safely edit that content.

## Where content lives

One file per module, in `content/`:

- `content/module-01-foundations.json`
- `content/module-02-shapes.json`
- `content/module-03-color-light.json`
- `content/module-04-textures.json`

Each file is a single module object: metadata (`id`, `position`, `status`, `title`,
`description`) plus its `lessons` array. A lesson holds concept copy, an array of `presets`
(each pairing a GLSL snippet with a live preview), and an array of `sections` (the body text
below the preview).

`module-04-textures.json` has `"status": "planned"` and an empty `lessons` array — see
[Planned modules](#planned-modules-vs-published-modules) below.

## The build → commit workflow

```bash
npm run content:build   # regenerate assets/course/bundled-course.json from content/module-*.json
npm run content:check   # fail if the tracked asset doesn't match what content:build produces
npm test -- --runInBand # full Jest suite, including content/schema assertions
npx tsc --noEmit        # project-wide type check
```

After editing any `content/module-*.json` file:

1. Run `npm run content:build`. This validates every module against
   `src/data/course/schema.ts` and writes the compiled result to
   `assets/course/bundled-course.json`.
2. **Commit the regenerated `assets/course/bundled-course.json` together with your content
   change.** It is a tracked, checked-in file, not a build artifact ignored by git — the app
   reads it directly as the bundled seed for SQLite, so a stale copy ships stale content.
3. Run `npm run content:check` before opening a PR. It fails (exit 1) if
   `assets/course/bundled-course.json` is not exactly what `content:build` would produce right
   now — this is the guard against someone editing `content/*.json` and forgetting step 2.
4. Run `npm test -- --runInBand` and `npx tsc --noEmit`. In particular,
   `src/data/course/__tests__/bundled-course.test.ts` pins exact lesson/preset counts and exact
   per-lesson copy (captions, default presets, paused presets, and so on) against the compiled
   bundle — adding, removing, or renaming lessons or presets means updating that test alongside
   the content.

## What content authoring can and cannot do

### Preview keys require existing app support

Every preset's `previewKey` must already exist in `SHADER_PREVIEW_MODE_VALUES` in
`src/shaders/preview-registry.ts`, which maps it to a rendering mode the native GL preview
(`LiveShaderPreview`) actually implements. **Content cannot introduce a new visual preview by
itself** — a new preview capability means writing the corresponding GL rendering code and
shipping an app update first, then referencing the new key from content. Authoring an unknown
`previewKey` fails `content:build`/`content:check` with `Invalid preview key: <key>`.

### `previewParameters` are name- and type-checked

A preset's `previewParameters` object may only use names the installed app knows how to act on,
authored with the right type. Today there are exactly two, both in
`SHADER_PREVIEW_PARAMETER_TYPES` (`src/shaders/preview-registry.ts`):

| Name | Type | Effect |
| --- | --- | --- |
| `restartable` | boolean | Shows the workspace's restart control. Omitted or `false` hides it. |
| `animated` | boolean | Selects the live badge's label only ("Running" vs. "Paused"). Presets animate by default; only an explicit `animated: false` shows "Paused". It does **not** pause the actual render loop. |

Authoring any other name, or the right name with the wrong type (e.g. `"restartable": "true"`),
fails validation with `Unsupported preview parameter <name> on preset <id>` or
`Preview parameter <name> on preset <id> must be a <type>`. Like preview keys, new parameter
names require an app release before content can use them.

### Other optional lesson/preset fields

- `defaultPresetId` (lesson, optional) — which preset opens first when a learner enters the
  lesson. Must reference a preset id in the same lesson. Omit it and the lesson opens on its
  lowest-`position` preset.
- `previewCaption` (lesson, **required**) — the caption shown under the live preview (e.g. "UV
  preview", "Time animation"). It exists so each lesson controls this copy precisely; there is
  no generic fallback.
- `previewValueLabel` (preset, optional) — overrides the preview footer's value text for that
  preset. Omit it and the footer falls back to `"<preset.label> · <preset.value>"`.
- `introEyebrow` (lesson, optional) — the small label above the lesson title (e.g. "Shape
  synthesis" on Module 2, "Color & light" on Module 3). Omit it and it defaults to "Concept".

## Stable IDs

`id` fields on modules, lessons, presets, and sections are permanent identifiers, not display
strings. **Never reuse or repurpose an id once it has shipped** — SQLite progress rows are keyed
by lesson id, and reassigning an id to different content would silently corrupt a learner's
history. Titles, labels, descriptive copy, and `position` values may be changed freely; they do
not affect stored progress.

## Planned modules vs. published modules

A module's `status` is either `"published"` or `"planned"`:

- **Published** modules must have at least one lesson, and must leave `plannedLessonCount` at
  `0` and `plannedTopics` empty.
- **Planned** modules must have zero lessons, and `plannedLessonCount` must equal
  `plannedTopics.length`. They render as a roadmap card (lesson count + topic list), contribute
  nothing to progress totals, and cannot be opened as a lesson route.

`content:build` rejects any file that mixes these — e.g. a planned module with lesson rows, or a
published module with leftover `plannedTopics`.

## Release IDs and checksums

`scripts/content/build-course.ts` compiles the modules into a release with a fixed `id` (the
bundled release is currently `bundled-2026-08-04`) and a SHA-256 `checksum` over the canonicalized
content. `installBundledRelease` (`src/data/database/seed.ts`) uses that pair to decide
what to do on a device that already has SQLite data:

- Unseen release id → install it.
- Same release id, matching checksum → no-op (already installed).
- **Same release id, different checksum → throws `Release <id> is already installed with a
  different checksum`, permanently, on every launch of that device.**

That last case is why a release id can only be reused while its content is byte-identical to
what already shipped. **Once a release id has reached any device, any further content change
needs a new release id** (bump the `id` string in `build-course.ts`, e.g.
`bundled-2026-08-05`). Changing content under an already-shipped id is not recoverable for
devices that already seeded it short of a data reset.

## Further reading

For the design rationale behind the SQLite schema, the legacy AsyncStorage migration, and the
module/lesson/preset data model, see
`docs/superpowers/specs/2026-08-03-offline-curriculum-sync-design.md`.
