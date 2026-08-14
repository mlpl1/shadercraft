# Stitch Editor and Shader Library Design

## Goal

Adapt the approved Stitch screens for the app's Editor area without replacing the working shader
runtime, autosave, compile diagnostics, or profile-scoped local persistence. The Editor tab will land
on a full-screen shader library. Opening a saved shader moves into a focused editor with a file drawer
and functional saved parameter controls.

## Reference Screens

- Stitch project `7478249889287186102`
- Shader Library screen `0770ce6d6b6f4376bf4a726b451daeba`
- Editor: File Browser & Drawer screen `cf5a4bf2879f47a685cffba0b8919b46`
- Downloaded reference artifacts live in `stitch-assets/`.

The references define the visual hierarchy, dark palette, compact monospace labels, cards, editor
split, left drawer, and parameter panel. Native safe areas, accessibility, existing Shadercraft
navigation conventions, and actual product behavior take precedence over literal HTML translation.

## Scope

### Included

- A dedicated `/library` route as the Editor tab's landing screen.
- A redesigned `/editor` route opened with a sketch ID.
- Full-screen browsing, search, local category filtering, and sketch creation.
- A left file-browser drawer for selecting, creating, renaming, and deleting sketches.
- Saved float-parameter definitions and values per sketch.
- Runtime custom-uniform declarations and per-frame value upload.
- Preservation of compile-error behavior, last-working output, pause, restart, collapse, and autosave.
- Tests for persistence, renderer behavior, navigation, filtering, drawer CRUD, and parameters.

### Excluded

- Cloud synchronization of sketches or parameter metadata.
- Arbitrary uniform types beyond `float`.
- Automatic parsing of full GLSL programs or top-level uniform declarations.
- A general folder hierarchy. The drawer groups sketches by category but does not introduce folders.
- Remote shader discovery, publishing, sharing, or collaboration.

## Navigation and Screen Architecture

`/library` replaces the current sketch-list modal as the Editor tab's landing destination. The
bottom navigation marks Editor active on both library and editor screens. A card selection navigates
to `/editor` with the selected sketch ID. Creating a sketch persists it first and then opens it.

`/editor` resolves the requested sketch from the existing repository. If the ID is missing or no
longer exists, it falls back to the most recently updated sketch; if none exists, it creates the
starter sketch. Android back returns to the library. When an overlay is open, back closes the
parameter panel or drawer before leaving the route.

The two routes share repository operations and focused UI components rather than sharing one large
screen state tree. Repository reads remain profile-scoped.

## Components

### Shader Library

`ShaderLibraryScreen` owns search text, the selected category, and the loaded sketch list. It renders:

- a large `Shaders` heading and compact supporting copy;
- a search field filtering titles case-insensitively;
- category chips derived from available sketch categories, with `All` first;
- a create action;
- a featured/recent card treatment following the Stitch composition;
- a useful empty state for an empty library or a filter with no matches; and
- the existing bottom navigation with Editor active.

Each card contains a read-only `ShaderSandbox`. Visibility controls its `active` prop so an off-screen
card stops scheduling frames. The library does not compile user input or manage autosave buffers; it
only renders saved source and saved parameter values.

### Editor Workspace

`EditorScreen` retains ownership of the editable buffer, compile debounce, autosave debounce,
last-working status, pause state, collapse state, and restart token. Its visual structure follows the
Stitch reference:

- compact top app bar with drawer, filename, parameters, run/pause, restart, and overflow actions;
- a live preview occupying the upper workspace;
- a narrow divider separating preview and source;
- the existing `GlslInput` filling the lower workspace; and
- bottom navigation with Editor active.

The divider communicates the split visually but is not draggable in this scope. Collapse remains an
explicit action and releases the GL context as it does today. Existing compile and save warnings are
restyled but retain their meaning.

### File Drawer

`ShaderFileDrawer` replaces `SketchListSheet`. It is a left-side modal drawer with a scrim, grouped
category labels, the active sketch, modification metadata, a create action, and internal-storage
labeling. It preserves select, create, rename, and delete operations and the rule that the only sketch
cannot be deleted. Selection flushes the current autosave before switching.

The drawer is implemented with native modal/animated layout behavior already available in the
project. It does not add a navigation or drawer dependency solely to reproduce this local overlay.

### Parameters Panel

`ShaderParametersPanel` opens from the editor tune action. Each saved float definition renders a
label, formatted current value, and slider. Because the project does not currently include a slider
package, implementation may use an accessible custom track backed by gesture handling or install the
Expo 57-compatible community slider after checking the exact versioned documentation. The choice is
made in the implementation plan, not implicitly during coding.

The panel also provides a secondary manage mode for adding, editing, and removing float definitions.
That form validates the GLSL key, label, range, step, and default before saving. Removing a definition
requires confirmation because source that references its uniform will stop compiling. The ordinary
panel remains the compact slider view shown by the Stitch reference; definition management is not
mixed into the primary editing flow.

Changing a value updates the live preview immediately and persists through a short debounce. A
definition change recompiles the shader because the uniform declarations change. A value-only change
does not recompile.

## Data Model

The existing sketches table gains JSON metadata with a versioned application representation:

```ts
type SketchMetadata = {
  version: 1;
  category: string;
  parameters: Array<{
    key: string;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    value: number;
  }>;
};
```

The persisted column defaults to metadata equivalent to category `Drafts` and an empty parameter
list. Existing sketches therefore migrate without changing source or behavior. Repository boundaries
parse and validate the JSON; malformed metadata degrades to the default and produces a recoverable
warning rather than preventing the sketch from opening.

Parameter keys must be valid GLSL identifiers, must not collide with Shadercraft's built-in uniforms,
and must be unique within a sketch. Numeric fields must be finite, `max` must exceed `min`, `step`
must be positive, and stored values are clamped to the declared range.

## Shader Runtime

The authored source remains a `mainImage` body. The wrapper receives validated parameter definitions
and emits `uniform float <key>;` declarations before `mainImage`. Its returned line offset includes
those generated declarations so compile errors still point to the correct authored line.

`ShaderProgramHost` receives both source and the current parameter-value map. After a successful
link it caches parameter uniform locations alongside `iTime` and `iResolution`. Each render uploads
finite current values. Unknown values and locations optimized out by the driver are ignored safely.

Changing parameter definitions triggers compilation because the wrapped source changes. Changing
only values updates the host's value map and the next frame without replacing the linked program.
Failed compilation continues drawing the last successfully linked program.

## Data Flow

1. The library loads profile-scoped sketches and filters them locally by title and category.
2. Selecting a card routes with the sketch ID.
3. The editor loads that sketch, seeds the controlled code input, and gives source plus validated
   parameters to `ShaderSandbox`.
4. Source edits use the existing compile and save debounces.
5. Parameter value edits update the sandbox immediately and persist through a separate short
   metadata debounce.
6. Drawer mutations flush pending writes and re-read the ordered list before changing selection.
7. Returning to the library re-reads repository state so titles, timestamps, source, and parameter
   values are current.

## Failure Handling

- Invalid GLSL keeps the last working preview and displays mapped diagnostics.
- Invalid parameter metadata falls back to safe defaults and shows a non-destructive warning.
- An invalid parameter key is never inserted into generated GLSL.
- A sketch missing from a deep link falls back to the most recent available sketch.
- A failed SQLite write leaves the code or parameter values in memory and offers the existing save
  warning instead of discarding edits.
- Empty search results preserve the active filters and offer a clear reset action.
- Library previews that fail compilation show the sandbox placeholder without breaking scrolling.

## Accessibility and Responsive Behavior

All icon-only actions receive labels, roles, hit slop, and visible pressed or focused states. Search,
category chips, cards, drawer rows, sliders, and dismissal scrims are reachable with assistive
technology. Parameter controls expose adjustable semantics and formatted values.

Safe-area insets are respected on both routes and overlays. The editor remains portrait-first, in
line with the app configuration. With the keyboard raised, the source area remains usable and the
preview can be collapsed. The Stitch measurements guide proportions but are not hardcoded to the
reference's 780-pixel capture width.

## Testing Strategy

### Pure and Repository Tests

- metadata parsing, defaults, clamping, identifier validation, and serialization;
- migration of existing sketch rows;
- metadata CRUD and profile isolation;
- wrapper declarations and corrected error offsets; and
- parameter locations/value uploads through the existing fake GL context.

### Component and Route Tests

- library search and category filters;
- empty states, creation, and card navigation;
- editor loading by ID and missing-ID fallback;
- drawer selection, creation, rename, delete protection, and dismissal;
- parameter panel rendering, definition management and validation, adjustable actions, immediate
  preview updates, and persistence;
- preservation of compile debounce, autosave, last-working output, pause, restart, and collapse; and
- bottom-navigation destinations and active state.

GL components remain mocked in route tests. Runtime behavior is verified through pure shader tests
and the fake GL context rather than relying on Jest to provide a native GL surface.

### Device Acceptance

- Verify drawer animation, scrim dismissal, and Android back ordering.
- Verify code editing and keyboard behavior on a portrait Android device.
- Verify sliders update the visible shader without recompiling or stuttering.
- Verify category/search behavior and library card scrolling.
- Verify off-screen previews stop rendering and library performance remains acceptable.
- Verify compile errors still map to authored lines after generated uniform declarations.
- Verify edits and parameter values survive backgrounding and relaunch.

## Expo SDK 57 Constraints

Implementation must use the exact Expo 57 documentation. `GLView` creates its context on mount,
requires `endFrameEXP()` to present frames, and does not function correctly with remote debugging.
Off-screen previews therefore stop their animation loops through the existing `active` contract, and
collapsed previews unmount deliberately. No code should assume every Android device supports WebGL2
features.

## Success Criteria

- The Editor tab opens a Shader Library matching the approved Stitch visual direction.
- A learner can find, create, and open saved shaders from the library.
- The editor matches the approved workspace hierarchy and provides a functional file drawer.
- Saved float parameters appear as controls, update the shader live, and persist across relaunches.
- Existing source editing, diagnostics, autosave, and render-loop behavior remain correct.
- The library does not continuously render previews that are off-screen.
- Automated tests and Android acceptance checks cover the changed behavior.
