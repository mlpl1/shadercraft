# Stitch Editor and Shader Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Editor tab's sketch modal with the approved Stitch-inspired Shader Library, redesign the live editor around a left file drawer, and add persisted float parameters that drive custom shader uniforms.

**Architecture:** Add a `/library` route as the Editor tab destination and keep `/editor` focused on one route-param-selected sketch. Extend the existing profile-scoped SQLite sketch repository with validated versioned metadata, then thread parameter definitions and values through `wrapMainImageBody`, `ShaderProgramHost`, and `ShaderSandbox`. Build the library, file drawer, and parameter panel as focused native components while preserving the existing editor's compile, last-working-program, pause, collapse, and autosave contracts.

**Tech Stack:** Expo SDK 57.0.0, Expo Router 57, React Native 0.86, TypeScript 6, SQLite, `expo-gl` ~57.0.2, `@react-native-community/slider` 5.2.0, Jest 29, React Native Testing Library 14.

## Global Constraints

- Read exact documentation under `https://docs.expo.dev/versions/v57.0.0/` before changing Expo APIs or dependencies.
- Keep authored shader source as a `mainImage` body; do not accept or parse full GLSL programs.
- Support custom `float` parameters only; reject reserved or invalid GLSL identifiers.
- Keep sketches and metadata profile-scoped and local-only; write no sync outbox rows.
- Keep failed compiles rendering the last successfully linked program.
- Keep off-screen library previews inactive and collapsed editor previews unmounted.
- Preserve safe areas, screen-reader labels, adjustable slider semantics, and Android back behavior.
- Do not commit `stitch-assets/`; it is a local, Git-excluded reference directory.
- Use the Stitch screens for hierarchy and styling, but implement native React Native UI rather than embedding their HTML.

## File Map

- Create `src/data/sketches/sketch-metadata.ts`: metadata types, defaults, parsing, normalization, and GLSL identifier rules.
- Modify `src/data/sketches/sketch-repository.ts`: add metadata to `Sketch` and `updateMetadata` to the repository contract.
- Modify `src/data/sketches/sqlite-sketch-repository.ts`: read/write `metadata_json` and preserve idempotent ordering.
- Modify `src/data/sketches/testing/fake-sketch-repository.ts`: implement the expanded contract for screen tests.
- Modify `src/data/database/migrations.ts`: migration 4 adding non-null `metadata_json`.
- Modify repository and migration tests for compatibility, validation, isolation, and restart persistence.
- Modify `src/shaders/shader-source.ts`: generate validated uniform declarations and line offsets.
- Modify `src/shaders/shader-program-host.ts`: cache and upload custom uniform values without recompiling for value-only changes.
- Modify `src/shaders/testing/fake-gl.ts`: expose custom uniform calls to tests.
- Modify shader tests for declaration, recompilation, and upload behavior.
- Modify `src/components/shader-sandbox.tsx`: accept parameter definitions and values and update the host through refs.
- Create `src/components/shader-parameters-panel.tsx`: slider view plus parameter-definition management.
- Create `src/components/shader-file-drawer.tsx`: left modal drawer and sketch CRUD UI.
- Create `src/components/shader-library-card.tsx`: visible-only read-only preview card.
- Create `src/app/library.tsx`: search, category filters, creation, and editor navigation.
- Modify `src/app/editor.tsx`: route-param loading, Stitch workspace header, drawer, parameters, and back behavior.
- Modify `src/components/bottom-navigation.tsx`: make Editor navigate to `/library`.
- Modify `src/constants/theme.ts`: add only the approved shared Stitch tokens missing from the current palette.
- Replace obsolete `SketchListSheet` tests/component after the drawer is integrated.
- Add route/component tests and update `docs/data/shader-sandbox.md` for the custom-uniform contract.

---

### Task 1: Versioned Sketch Metadata Domain

**Files:**
- Create: `src/data/sketches/sketch-metadata.ts`
- Create: `src/data/sketches/__tests__/sketch-metadata.test.ts`

**Interfaces:**
- Produces: `ShaderParameterDefinition`, `SketchMetadata`, `SketchMetadataParseResult`, `DEFAULT_SKETCH_METADATA`, `parseSketchMetadata(value: unknown): SketchMetadata`, `parseSketchMetadataResult(value: unknown): SketchMetadataParseResult`, `serializeSketchMetadata(metadata: SketchMetadata): string`, and `isValidShaderParameterKey(key: string): boolean`.
- Reserved keys: `iResolution`, `iTime`, `gl_FragColor`, `gl_FragCoord`, `main`, and `mainImage`.

- [ ] **Step 1: Write failing normalization and validation tests**

```ts
expect(parseSketchMetadata(undefined)).toEqual(DEFAULT_SKETCH_METADATA);
expect(parseSketchMetadata({
  version: 1,
  category: "  Experiments  ",
  parameters: [{
    key: "u_intensity", label: "Intensity", min: 0, max: 5, step: 0.1,
    defaultValue: 1.5, value: 9,
  }],
})).toEqual({
  version: 1,
  category: "Experiments",
  parameters: [{
    key: "u_intensity", label: "Intensity", min: 0, max: 5, step: 0.1,
    defaultValue: 1.5, value: 5,
  }],
});
expect(isValidShaderParameterKey("u_speed")).toBe(true);
expect(isValidShaderParameterKey("iTime")).toBe(false);
expect(isValidShaderParameterKey("9speed")).toBe(false);
expect(parseSketchMetadataResult("broken")).toEqual({
  metadata: DEFAULT_SKETCH_METADATA,
  warning: "Saved shader parameters were invalid and have been reset.",
});
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run: `npm test -- --runInBand src/data/sketches/__tests__/sketch-metadata.test.ts`
Expected: FAIL because `sketch-metadata` does not exist.

- [ ] **Step 3: Implement the metadata boundary**

```ts
export type ShaderParameterDefinition = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  value: number;
};

export type SketchMetadata = {
  version: 1;
  category: string;
  parameters: ShaderParameterDefinition[];
};

export type SketchMetadataParseResult = {
  metadata: SketchMetadata;
  warning: string | null;
};

export const DEFAULT_SKETCH_METADATA: SketchMetadata = {
  version: 1,
  category: "Drafts",
  parameters: [],
};
```

Normalize without mutating input: trim category/key/label, reject malformed entries, reject duplicate
or reserved keys, require finite numbers with `max > min` and `step > 0`, clamp default/value, and
return fresh objects so callers cannot mutate the shared default.

- [ ] **Step 4: Run the focused metadata tests**

Run: `npm test -- --runInBand src/data/sketches/__tests__/sketch-metadata.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the metadata domain**

```bash
git add src/data/sketches/sketch-metadata.ts src/data/sketches/__tests__/sketch-metadata.test.ts
git commit -m "feat(editor): define shader parameter metadata"
```

### Task 2: SQLite Migration and Repository Metadata

**Files:**
- Modify: `src/data/database/migrations.ts`
- Modify: `src/data/database/__tests__/migrations.test.ts`
- Modify: `src/data/sketches/sketch-repository.ts`
- Modify: `src/data/sketches/sqlite-sketch-repository.ts`
- Modify: `src/data/sketches/testing/fake-sketch-repository.ts`
- Modify: `src/data/sketches/__tests__/sketch-repository.test.ts`

**Interfaces:**
- Consumes: `SketchMetadata`, `DEFAULT_SKETCH_METADATA`, `parseSketchMetadataResult`, and `serializeSketchMetadata` from Task 1.
- Produces: `Sketch.metadata: SketchMetadata`, `Sketch.metadataWarning: string | null`, and `SketchRepository.updateMetadata(profileId: string, id: string, metadata: SketchMetadata): Promise<void>`.

- [ ] **Step 1: Write failing migration and repository tests**

Add assertions that `PRAGMA table_info(sketches)` includes non-null `metadata_json`, an existing
version-3 database gains metadata equal to the default, creates return default metadata, malformed
stored JSON reads as the default, `updateMetadata` persists across repository reconstruction, does
not update another profile, advances `updatedAt` only when serialized metadata changes, and creates
no outbox row.

```ts
await repository.updateMetadata(PROFILE_A, created.id, {
  version: 1,
  category: "Experiments",
  parameters: [{ key: "u_gain", label: "Gain", min: 0, max: 2, step: 0.1, defaultValue: 1, value: 1.4 }],
});
expect((await repository.get(PROFILE_A, created.id))?.metadata.category).toBe("Experiments");
```

- [ ] **Step 2: Verify the persistence tests fail**

Run: `npm test -- --runInBand src/data/database/__tests__/migrations.test.ts src/data/sketches/__tests__/sketch-repository.test.ts`
Expected: FAIL because `metadata_json`, `Sketch.metadata`, and `updateMetadata` are absent.

- [ ] **Step 3: Add migration 4**

```ts
{
  version: 4,
  async migrate(driver) {
    await driver.exec(
      `ALTER TABLE sketches ADD COLUMN metadata_json TEXT NOT NULL
       DEFAULT '{"version":1,"category":"Drafts","parameters":[]}'`,
    );
  },
}
```

- [ ] **Step 4: Expand the real and fake repositories**

Include `metadata_json` in `COLUMNS`, parse it in `toSketch`, initialize new rows with serialized
default metadata, and add an idempotent update:

```ts
updateMetadata(profileId, id, metadata) {
  const json = serializeSketchMetadata(metadata);
  return driver.run(
    "UPDATE sketches SET metadata_json = ?, updated_at = ? WHERE profile_id = ? AND id = ? AND metadata_json <> ?",
    [json, now(), profileId, id, json],
  ).then(() => undefined);
}
```

Mirror the behavior in `createFakeSketchRepository` and update every inline mocked `SketchRepository`
to include `updateMetadata` and default metadata.

- [ ] **Step 5: Run persistence tests and type-check**

Run: `npm test -- --runInBand src/data/database/__tests__/migrations.test.ts src/data/sketches/__tests__/sketch-repository.test.ts`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: PASS after all test fixtures satisfy the expanded interface.

- [ ] **Step 6: Commit persistence changes**

```bash
git add src/data/database src/data/sketches src/app/__tests__ src/components/__tests__
git commit -m "feat(editor): persist sketch metadata"
```

### Task 3: Generate and Upload Custom Float Uniforms

**Files:**
- Modify: `src/shaders/shader-source.ts`
- Modify: `src/shaders/__tests__/shader-source.test.ts`
- Modify: `src/shaders/shader-program-host.ts`
- Modify: `src/shaders/testing/fake-gl.ts`
- Modify: `src/shaders/__tests__/shader-program-host.test.ts`

**Interfaces:**
- Consumes: `ShaderParameterDefinition` from Task 1.
- Produces: `wrapMainImageBody(body: string, helpers?: string, parameters?: readonly ShaderParameterDefinition[])`, `ShaderParameterValues = Readonly<Record<string, number>>`, `ShaderProgramHost.setBody(body, helpers?, parameters?)`, and `ShaderProgramHost.setParameterValues(values)`.

- [ ] **Step 1: Write failing wrapper tests**

```ts
const parameter = { key: "u_gain", label: "Gain", min: 0, max: 2, step: 0.1, defaultValue: 1, value: 1.2 };
const wrapped = wrapMainImageBody("fragColor = vec4(u_gain);", undefined, [parameter]);
expect(wrapped.source).toContain("uniform float u_gain;");
expect(wrapped.source.split("\n")[wrapped.lineOffset]).toBe("fragColor = vec4(u_gain);");
```

Also assert declarations follow built-in uniforms, duplicate/invalid keys are not emitted defensively,
and each generated declaration advances the error offset by one.

- [ ] **Step 2: Write failing host tests**

Assert a successful compile caches `u_gain`, `render` calls `uniform1f` with its current value,
`setParameterValues({ u_gain: 1.8 })` changes the next render without increasing `createdCount()`, and
changing definitions does increase it. Assert NaN/Infinity values are skipped.

- [ ] **Step 3: Run shader tests and verify failure**

Run: `npm test -- --runInBand src/shaders/__tests__/shader-source.test.ts src/shaders/__tests__/shader-program-host.test.ts`
Expected: FAIL because custom uniform arguments and value updates do not exist.

- [ ] **Step 4: Implement declarations, locations, and value updates**

Store active custom locations as `Map<string, WebGLUniformLocation | null>`. Include a stable
definition signature in the compile cache so value-only changes do not compile while key changes do.
Call `gl.uniform1f(location, value)` for each finite value after built-in uniforms and before draw.
Keep the active program and its locations unchanged after a failed replacement compile.

- [ ] **Step 5: Run shader tests**

Run: `npm test -- --runInBand src/shaders/__tests__/shader-source.test.ts src/shaders/__tests__/shader-program-host.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit shader runtime changes**

```bash
git add src/shaders
git commit -m "feat(editor): render saved shader uniforms"
```

### Task 4: Thread Parameters Through ShaderSandbox

**Files:**
- Modify: `src/components/shader-sandbox.tsx`
- Modify: `src/components/__tests__/shader-sandbox.test.tsx`

**Interfaces:**
- Consumes: `ShaderParameterDefinition` and the Task 3 host methods.
- Produces: optional `parameters?: readonly ShaderParameterDefinition[]` prop on `ShaderSandbox`.

- [ ] **Step 1: Write failing sandbox tests**

Mock `ShaderProgramHost` and assert initial context creation calls `setBody(source, helpers,
parameters)`, a value-only prop change calls `setParameterValues` without recreating the host, and a
definition-key change calls `setBody`.

- [ ] **Step 2: Verify focused failure**

Run: `npm test -- --runInBand src/components/__tests__/shader-sandbox.test.tsx`
Expected: FAIL because `parameters` is not a prop and the host never receives values.

- [ ] **Step 3: Implement stable definition and value effects**

Derive values with `useMemo(() => Object.fromEntries(parameters.map(({ key, value }) => [key,
value])), [parameters])`. Keep definitions and values in refs for context creation. Recompile only
when the ordered key/definition signature changes; call `setParameterValues` for value changes.

- [ ] **Step 4: Run sandbox and shader suites**

Run: `npm test -- --runInBand src/components/__tests__/shader-sandbox.test.tsx src/shaders/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit sandbox plumbing**

```bash
git add src/components/shader-sandbox.tsx src/components/__tests__/shader-sandbox.test.tsx
git commit -m "feat(editor): pass parameters into shader previews"
```

### Task 5: Native Parameter Panel and Definition Manager

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/components/shader-parameters-panel.tsx`
- Create: `src/components/__tests__/shader-parameters-panel.test.tsx`

**Interfaces:**
- Consumes: `ShaderParameterDefinition`, `isValidShaderParameterKey`.
- Produces: `ShaderParametersPanel({ parameters, onChange, onClose }: { parameters: ShaderParameterDefinition[]; onChange(next: ShaderParameterDefinition[]): void; onClose(): void })`.

- [ ] **Step 1: Install the Expo 57-recommended slider**

Run: `npx expo install @react-native-community/slider`
Expected: `package.json` records version `5.2.0` compatible with SDK 57.

- [ ] **Step 2: Write failing panel tests**

Mock the slider as a host component. Assert the slider list displays saved labels/values, a value
change emits a new clamped parameter array, Manage opens a form, invalid/reserved/duplicate keys
show specific inline errors, valid Add emits a definition, Edit preserves the current value when
still in range, and Remove requires confirmation before emitting removal.

```ts
await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 1.6);
expect(onChange).toHaveBeenCalledWith([
  expect.objectContaining({ key: "u_gain", value: 1.6 }),
]);
```

- [ ] **Step 3: Verify component failure**

Run: `npm test -- --runInBand src/components/__tests__/shader-parameters-panel.test.tsx`
Expected: FAIL because the panel does not exist.

- [ ] **Step 4: Implement slider and secondary manage mode**

Use `Slider` with `minimumValue`, `maximumValue`, `step`, `value`, `onValueChange`,
`minimumTrackTintColor`, and `thumbTintColor`. Keep the compact slider view as default. The manage
form uses controlled native text inputs, validates all fields before emitting, and uses `Alert.alert`
with Cancel/Remove buttons for destructive removal.

- [ ] **Step 5: Run panel tests**

Run: `npm test -- --runInBand src/components/__tests__/shader-parameters-panel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit the panel**

```bash
git add package.json package-lock.json src/components/shader-parameters-panel.tsx src/components/__tests__/shader-parameters-panel.test.tsx
git commit -m "feat(editor): add saved shader parameter controls"
```

### Task 6: Stitch-Style File Drawer

**Files:**
- Create: `src/components/shader-file-drawer.tsx`
- Create: `src/components/__tests__/shader-file-drawer.test.tsx`
- Delete after integration: `src/components/sketch-list-sheet.tsx`
- Delete after integration: `src/components/__tests__/sketch-list-sheet.test.tsx`

**Interfaces:**
- Consumes: `Sketch` with metadata.
- Produces: `ShaderFileDrawer({ visible, sketches, activeSketchId, onSelect, onCreate, onRename, onDelete, onClose })` with the existing CRUD callback signatures.

- [ ] **Step 1: Port behavior expectations into failing drawer tests**

Assert the drawer groups rows by category, marks the active row selected, formats modification
metadata, invokes selection/create/rename, refuses deletion when only one sketch exists, confirms a
real deletion, closes on Close and scrim press, and calls `onClose` from `onRequestClose`.

- [ ] **Step 2: Verify drawer tests fail**

Run: `npm test -- --runInBand src/components/__tests__/shader-file-drawer.test.tsx`
Expected: FAIL because the drawer component does not exist.

- [ ] **Step 3: Implement the native left drawer**

Use `Modal transparent animationType="fade"`, a full-screen scrim, and an `Animated.View` anchored
left with a maximum width matching the Stitch proportions. Preserve inline rename behavior and all
accessibility labels/test IDs from the old sheet where practical.

- [ ] **Step 4: Run drawer tests**

Run: `npm test -- --runInBand src/components/__tests__/shader-file-drawer.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit the drawer without deleting the old sheet yet**

```bash
git add src/components/shader-file-drawer.tsx src/components/__tests__/shader-file-drawer.test.tsx
git commit -m "feat(editor): add shader file drawer"
```

### Task 7: Shader Library Route and Preview Cards

**Files:**
- Create: `src/components/shader-library-card.tsx`
- Create: `src/components/__tests__/shader-library-card.test.tsx`
- Create: `src/app/library.tsx`
- Create: `src/app/__tests__/library.test.tsx`
- Modify: `src/components/bottom-navigation.tsx`
- Modify: `src/components/__tests__/bottom-navigation.test.tsx`
- Modify: `src/constants/theme.ts`

**Interfaces:**
- Consumes: `SketchRepository`, `ShaderSandbox.parameters`, `useFocusEffect`, and `router.push({ pathname: "/editor", params: { sketchId } })`.
- Produces: `/library` as the Editor tab landing route and `ShaderLibraryCard({ sketch, active, onPress })`.

- [ ] **Step 1: Write failing card and library tests**

Assert cards pass source/parameters to the mocked sandbox and set `active={false}` when outside the
visible ID set. Assert the route creates the starter on an empty profile, shows all sketches in
updated order, filters title case-insensitively, filters by category, resets an empty filter, creates
a sketch, and pushes `/editor` with its ID on card press.

- [ ] **Step 2: Write the failing navigation regression**

Update the bottom-navigation expectation so pressing Editor calls `router.replace("/library")`, while
an already-active Editor tab remains a no-op on either editor-area route.

- [ ] **Step 3: Verify focused failures**

Run: `npm test -- --runInBand src/components/__tests__/shader-library-card.test.tsx src/app/__tests__/library.test.tsx src/components/__tests__/bottom-navigation.test.tsx`
Expected: FAIL because the route/card do not exist and Editor still targets `/editor`.

- [ ] **Step 4: Implement card visibility and library state**

Use `FlatList` viewability callbacks to keep a `Set` of visible sketch IDs; only visible cards receive
`active`. Derive categories as `All` plus distinct metadata categories. Filter in `useMemo`, reload in
`useFocusEffect`, and keep empty-list creation separate from no-search-results reset.

- [ ] **Step 5: Apply shared Stitch tokens and native layout**

Add only reusable missing colors/spacing to `theme.ts` (`acidGreen`, `electricBlue`, `magenta`,
`surfaceLowest`, `surfaceHigh`) and compose the reference hierarchy with `SafeAreaView`, native text
inputs, chips, cards, and `BottomNavigation`. Do not render the downloaded HTML or image in-product.

- [ ] **Step 6: Run library/navigation tests**

Run: `npm test -- --runInBand src/components/__tests__/shader-library-card.test.tsx src/app/__tests__/library.test.tsx src/components/__tests__/bottom-navigation.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit the library route**

```bash
git add src/app/library.tsx src/app/__tests__/library.test.tsx src/components/shader-library-card.tsx src/components/__tests__/shader-library-card.test.tsx src/components/bottom-navigation.tsx src/components/__tests__/bottom-navigation.test.tsx src/constants/theme.ts
git commit -m "feat(editor): add shader library route"
```

### Task 8: Editor Route Integration and Stitch Workspace

**Files:**
- Modify: `src/app/editor.tsx`
- Modify: `src/app/__tests__/editor.test.tsx`
- Delete: `src/components/sketch-list-sheet.tsx`
- Delete: `src/components/__tests__/sketch-list-sheet.test.tsx`
- Modify: `src/components/preview-controls.tsx`
- Modify: `src/components/__tests__/preview-controls.test.tsx`

**Interfaces:**
- Consumes: route `sketchId`, `ShaderFileDrawer`, `ShaderParametersPanel`, `SketchRepository.updateMetadata`, and parameterized `ShaderSandbox`.
- Produces: the complete editor flow and metadata autosave.

- [ ] **Step 1: Rewrite route tests around the approved navigation**

Mock `useLocalSearchParams` and `useRouter`. Assert a valid `sketchId` opens that sketch, a missing ID
falls back to the most recent sketch, no sketches creates starter metadata, menu opens the drawer,
drawer selection flushes pending source then changes sketch, back closes the parameter panel before
the drawer before `router.back()`, and delete of the active sketch selects a replacement or returns
to `/library` when none remains.

- [ ] **Step 2: Add parameter integration tests**

Assert the sandbox receives saved parameters, the tune action opens the panel, slider changes reach
the sandbox immediately, `updateMetadata` fires after the metadata debounce, definition changes
reach the sandbox and therefore trigger Task 4's definition compile path, and a failed metadata save
keeps the values in memory with a warning. Also assert `sketch.metadataWarning` is rendered
non-destructively above the editor without blocking source editing.

- [ ] **Step 3: Preserve existing editor regressions**

Keep tests for source compile/autosave debounce, last-working badge, source-save error retention,
pause, restart, collapse/unmount, and controlled-input remount when switching sketches. Move the
preview controls into icon actions but retain their accessible labels exactly.

- [ ] **Step 4: Verify editor tests fail against the old layout**

Run: `npm test -- --runInBand src/app/__tests__/editor.test.tsx src/components/__tests__/preview-controls.test.tsx`
Expected: FAIL on route-param, drawer, parameter, and workspace-header assertions.

- [ ] **Step 5: Implement route loading and independent debounces**

Keep source and metadata pending refs/timers separate. `flushAllSaves()` awaits source then metadata
before selection or navigation. Update `sketchRef` after every local metadata change so unmount flush
cannot write stale values. Re-read the repository after mutations to preserve `updatedAt DESC` order.

- [ ] **Step 6: Implement the Stitch editor hierarchy**

Compose a compact header, preview overlay/status, divider, `GlslInput`, bottom navigation,
`ShaderFileDrawer`, and `ShaderParametersPanel`. Keep collapse unmount semantics and `GLView` frame
presentation unchanged. Use `BackHandler` only while an overlay is open; normal route back remains
Expo Router's responsibility.

- [ ] **Step 7: Remove the obsolete sheet and run editor tests**

Run: `npm test -- --runInBand src/app/__tests__/editor.test.tsx src/components/__tests__/shader-file-drawer.test.tsx src/components/__tests__/shader-parameters-panel.test.tsx src/components/__tests__/preview-controls.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit editor integration**

```bash
git add src/app/editor.tsx src/app/__tests__/editor.test.tsx src/components
git commit -m "feat(editor): integrate Stitch workspace and drawer"
```

### Task 9: Documentation and Full Verification

**Files:**
- Modify: `docs/data/shader-sandbox.md`
- Modify if required by findings: focused source/test files from Tasks 1-8

**Interfaces:**
- Documents: generated custom float uniforms, metadata source of truth, value-only update behavior, and authoring limits.

- [ ] **Step 1: Update the shader contract documentation**

Document that `iResolution` and `iTime` remain built-ins, saved parameter definitions add validated
`uniform float` declarations, generated lines are included in error-offset correction, and slider
value changes upload without linking a new program. State that full programs and non-float uniforms
remain unsupported.

- [ ] **Step 2: Run formatting/static verification**

Run: `npx tsc --noEmit`
Expected: PASS.

Run: `npm run lint`
Expected: PASS with no new warnings.

- [ ] **Step 3: Run the full automated suite**

Run: `npm test -- --runInBand`
Expected: all Jest suites PASS with no leaked timers or open handles attributable to this feature.

- [ ] **Step 4: Build the web target as a routing/layout smoke test**

Run: `npx expo export --platform web`
Expected: export succeeds and includes `/library` and `/editor` routes. This does not replace Android
GL acceptance because Jest/web cannot validate a native `GLView` context.

- [ ] **Step 5: Inspect Git scope and local assets**

Run: `git status --short`
Expected: only intended code/docs changes; no `stitch-assets/` paths.

Run: `git diff --check`
Expected: no whitespace errors.

- [ ] **Step 6: Perform Android acceptance checks**

On a development build with remote debugging disabled: verify library scrolling and preview
activation, drawer scrim/back ordering, keyboard/editor layout, slider response without compile
flicker, parameter persistence after relaunch, and authored error-line mapping with generated uniform
declarations.

- [ ] **Step 7: Commit documentation and final fixes**

```bash
git add docs/data/shader-sandbox.md src
git commit -m "docs(editor): document saved shader uniforms"
```

- [ ] **Step 8: Run final verification from a clean index**

Run: `npx tsc --noEmit`

Run: `npm run lint`

Run: `npm test -- --runInBand`
Expected: every command exits 0. Record any device-only acceptance items still owed; do not claim
them complete without a real Android run.
