# Linear Lesson Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prev/next stage pager with one scrolling page where each stage is a self-contained block carrying its own live preview, source and prose.

**Architecture:** Each stage renders as a block with its own `ShaderSandbox`. A block's GL context is created lazily just before it scrolls into reach and is never destroyed while the lesson is open; when a block leaves the viewport its render loop stops entirely. The viewport arithmetic lives in a pure function so its boundary conditions are unit-testable without a renderer.

**Tech Stack:** Expo SDK 57, React Native 0.86, React 19.2, TypeScript 6, `expo-gl`, Jest with `jest-expo`, `@testing-library/react-native` 14.

**Spec:** `docs/superpowers/specs/2026-08-07-linear-lesson-layout-design.md`

## Global Constraints

- Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing code against any Expo API.
- **No new dependencies.** **Do not run `npx expo lint`** — it silently auto-installs eslint packages, which has breached this constraint before.
- **Presentation only.** No change to `LessonStage`, the content schema, `lesson_stages`, the repository, the installer, or anything under `content/`.
- **`active` and `paused` stay separate concepts.** `paused` freezes `iTime` but keeps drawing (a visible, frozen preview). `active={false}` stops the loop entirely (an off-screen preview draws nothing).
- **Mounting is one-way.** Once a block's sandbox has mounted it stays mounted until the lesson changes.
- **`"Stage N of M"` and the prev/next controls must not survive.** A per-block `Stage 2` eyebrow is fine and is not that counter — the removed thing is the pager's navigation state.
- Nothing under `src/data` may import React or `expo-gl`.
- Before every commit: `npm test`, `npx tsc --noEmit`, `npm run content:check`.

### Test-harness facts that will otherwise cost an hour

- In `@testing-library/react-native` 14, `render` **and every `fireEvent` variant** return promises and must be awaited. An unawaited event overlaps the next `act()` scope and tears the tree down mid-test.
- `jest.mock` factories may only close over `mock`-prefixed bindings.
- `toHaveTextContent` matches strings **exactly**; multi-line content needs a regex.
- `BottomNavigation` needs the safe-area package's own jest mock or `useSafeAreaInsets` throws.

## File Structure

**Created:**
- `src/components/lesson-stage-visibility.ts` — pure viewport arithmetic
- `src/components/lesson-stage-block.tsx` — one stage rendered whole

**Modified:**
- `src/components/shader-sandbox.tsx` — gains `active?: boolean`
- `src/components/lesson-workspace.tsx` — pager becomes a list

**Untouched:** `src/components/stage-source-view.tsx` is reused as-is inside each block.

---

### Task 1: Stop the render loop when a sandbox is off-screen

**Files:**
- Modify: `src/components/shader-sandbox.tsx`
- Test: `src/components/__tests__/shader-sandbox.test.tsx`

**Interfaces:**
- Consumes: `createFakeGl` from `../shaders/testing/fake-gl` (tests only).
- Produces: `ShaderSandboxProps` gains `active?: boolean` (default `true`).

- [ ] **Step 1: Write the failing tests**

The existing suite mocks `expo-gl` with a plain `View`, so `onContextCreate` never fires and no loop ever starts. These tests need it to fire, so they use a different mock that invokes the callback with the project's existing fake GL context. Add to `src/components/__tests__/shader-sandbox.test.tsx`, in a new `describe` block with its own mock:

```tsx
describe("ShaderSandbox render loop", () => {
  beforeEach(() => {
    jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("draws when active", async () => {
    await render(<ShaderSandbox source="fragColor = vec4(1.0);" />);

    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
  });

  it("does not start the loop when mounted inactive", async () => {
    await render(<ShaderSandbox active={false} source="fragColor = vec4(1.0);" />);

    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("starts the loop when it becomes active", async () => {
    const view = await render(<ShaderSandbox active={false} source="fragColor = vec4(1.0);" />);
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();

    await view.rerender(<ShaderSandbox active source="fragColor = vec4(1.0);" />);

    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
  });

  it("does not schedule twice when active is set again", async () => {
    const view = await render(<ShaderSandbox active source="fragColor = vec4(1.0);" />);
    const afterMount = (globalThis.requestAnimationFrame as jest.Mock).mock.calls.length;

    await view.rerender(<ShaderSandbox active source="fragColor = vec4(1.0);" />);

    expect((globalThis.requestAnimationFrame as jest.Mock).mock.calls.length).toBe(afterMount);
  });
});
```

Replace the file's existing `jest.mock("expo-gl", …)` with one that fires the callback, so the loop actually runs:

```tsx
jest.mock("expo-gl", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");
  const { createFakeGl } = require("../../shaders/testing/fake-gl") as typeof import("../../shaders/testing/fake-gl");

  return {
    GLView: ({
      onContextCreate,
      style,
    }: {
      onContextCreate?: (gl: unknown) => void;
      style?: unknown;
    }) => {
      React.useEffect(() => {
        onContextCreate?.(createFakeGl());
      }, [onContextCreate]);

      return React.createElement(View, { style, testID: "gl-view" });
    },
  };
});
```

The existing tests in the file (GL surface renders, placeholder shows, height honoured) keep working under this mock; the placeholder test now needs `active={false}` or it will report having rendered.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/components/__tests__/shader-sandbox.test.tsx`

Expected: the three `active` tests FAIL — the prop does not exist, so the loop always starts.

- [ ] **Step 3: Implement the prop**

In `src/components/shader-sandbox.tsx`, add to `ShaderSandboxProps`:

```tsx
  /**
   * `false` stops the render loop entirely — no animation frame, no draw, no `endFrameEXP`. Used for
   * a preview scrolled off-screen, where drawing is pure waste.
   *
   * Deliberately distinct from `paused`, which freezes `iTime` but keeps drawing so a visible
   * preview holds its last frame rather than going blank.
   */
  active?: boolean;
```

Destructure it with `active = true`, and add alongside the other refs:

```tsx
  const activeRef = useRef(active);
  /** Set once the context exists, so the effect below can restart a loop that stopped itself. */
  const renderRef = useRef<(() => void) | null>(null);
```

Add this effect after the `paused` effect:

```tsx
  useEffect(() => {
    const wasActive = activeRef.current;
    activeRef.current = active;

    // The loop stops scheduling itself when inactive, so becoming active again has to restart it.
    // The null check on `frameRef` is what stops a re-render with unchanged `active` double-scheduling.
    if (active && !wasActive && frameRef.current === null) {
      renderRef.current?.();
    }
  }, [active]);
```

In `createContext`, change the loop to stop rather than reschedule, and only start it when active:

```tsx
    const render = () => {
      if (!mountedRef.current) return;

      if (!activeRef.current) {
        // Stop without rescheduling. `frameRef` going null is what the effect above tests.
        frameRef.current = null;
        return;
      }

      if (!pausedRef.current) {
        frozenSeconds = (globalThis.performance.now() - startedAtRef.current) / 1000;
      }

      host.render(frozenSeconds, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.endFrameEXP();

      frameRef.current = requestAnimationFrame(render);
    };

    renderRef.current = render;
    if (activeRef.current) render();
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest src/components/__tests__/shader-sandbox.test.tsx`

Expected: PASS.

- [ ] **Step 5: Verify and commit**

```bash
npm test
npx tsc --noEmit
git add src/components/shader-sandbox.tsx src/components/__tests__/shader-sandbox.test.tsx
git commit -m "feat(components): stop the sandbox render loop when off-screen"
```

---

### Task 2: The viewport arithmetic

**Files:**
- Create: `src/components/lesson-stage-visibility.ts`
- Test: `src/components/__tests__/lesson-stage-visibility.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type StageBounds = { top: number; height: number }`
  - `function computeStageVisibility(bounds: readonly StageBounds[], scrollY: number, viewportHeight: number): { shouldMount: boolean[]; isVisible: boolean[] }`

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/lesson-stage-visibility.test.ts`:

```ts
import { computeStageVisibility, type StageBounds } from "../lesson-stage-visibility";

/** Four 300pt blocks stacked from the top, in a 600pt viewport. */
const BLOCKS: StageBounds[] = [
  { top: 0, height: 300 },
  { top: 300, height: 300 },
  { top: 600, height: 300 },
  { top: 900, height: 300 },
];

describe("computeStageVisibility", () => {
  it("marks blocks intersecting the viewport visible", () => {
    const { isVisible } = computeStageVisibility(BLOCKS, 0, 600);

    expect(isVisible).toEqual([true, true, false, false]);
  });

  it("follows the viewport as it scrolls", () => {
    const { isVisible } = computeStageVisibility(BLOCKS, 600, 600);

    expect(isVisible).toEqual([false, false, true, true]);
  });

  it("counts a partial overlap as visible", () => {
    const { isVisible } = computeStageVisibility(BLOCKS, 150, 600);

    expect(isVisible).toEqual([true, true, true, false]);
  });

  it("treats a block starting exactly at the viewport bottom as not visible", () => {
    const { isVisible } = computeStageVisibility([{ top: 600, height: 300 }], 0, 600);

    expect(isVisible).toEqual([false]);
  });

  it("treats a block ending exactly at the viewport top as not visible", () => {
    const { isVisible } = computeStageVisibility([{ top: 0, height: 300 }], 300, 600);

    expect(isVisible).toEqual([false]);
  });

  it("mounts one viewport-height ahead of the visible region", () => {
    // Viewport is 0-600; the mount window is -600 to 1200, so every block but none beyond it.
    const { shouldMount } = computeStageVisibility(BLOCKS, 0, 600);

    expect(shouldMount).toEqual([true, true, true, true]);
  });

  it("does not mount a block beyond the margin", () => {
    const distant: StageBounds[] = [{ top: 0, height: 300 }, { top: 5000, height: 300 }];

    const { shouldMount } = computeStageVisibility(distant, 0, 600);

    expect(shouldMount).toEqual([true, false]);
  });

  it("mounts blocks behind the viewport within the margin", () => {
    const { shouldMount } = computeStageVisibility(BLOCKS, 900, 600);

    expect(shouldMount).toEqual([false, true, true, true]);
  });

  it("treats an unmeasured block as neither visible nor mountable", () => {
    const unmeasured: StageBounds[] = [{ top: 0, height: 0 }, { top: 0, height: 300 }];

    const { shouldMount, isVisible } = computeStageVisibility(unmeasured, 0, 600);

    expect(isVisible).toEqual([false, true]);
    expect(shouldMount).toEqual([false, true]);
  });

  it("returns nothing for no blocks", () => {
    expect(computeStageVisibility([], 0, 600)).toEqual({ shouldMount: [], isVisible: [] });
  });

  it("marks nothing visible before the viewport has been measured", () => {
    const { shouldMount, isVisible } = computeStageVisibility(BLOCKS, 0, 0);

    expect(isVisible).toEqual([false, false, false, false]);
    expect(shouldMount).toEqual([false, false, false, false]);
  });

  it("returns arrays matching the bounds length", () => {
    const { shouldMount, isVisible } = computeStageVisibility(BLOCKS, 0, 600);

    expect(shouldMount).toHaveLength(BLOCKS.length);
    expect(isVisible).toHaveLength(BLOCKS.length);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/components/__tests__/lesson-stage-visibility.test.ts`

Expected: FAIL — `Cannot find module '../lesson-stage-visibility'`.

- [ ] **Step 3: Implement it**

Create `src/components/lesson-stage-visibility.ts`:

```ts
export type StageBounds = {
  /** Offset of the block's top from the top of the scroll content. */
  top: number;
  /** `0` when the block has not been measured yet. */
  height: number;
};

/**
 * How far beyond the viewport, in viewport-heights, a block's preview is mounted. Mounting slightly
 * ahead means the GL context exists before the learner arrives rather than being created under them.
 */
const MOUNT_MARGIN_RATIO = 1;

/**
 * Decides, for right now, which stage blocks should have a mounted preview and which are on screen.
 *
 * Deliberately pure and history-free: it answers only "now", and never makes a decision sticky.
 * Keeping mounting one-way is the caller's job, because that is state and this is arithmetic — and
 * arithmetic with this many boundary conditions is worth being able to test without a renderer.
 */
export function computeStageVisibility(
  bounds: readonly StageBounds[],
  scrollY: number,
  viewportHeight: number,
): { shouldMount: boolean[]; isVisible: boolean[] } {
  const viewportTop = scrollY;
  const viewportBottom = scrollY + viewportHeight;
  const margin = viewportHeight * MOUNT_MARGIN_RATIO;

  const shouldMount: boolean[] = [];
  const isVisible: boolean[] = [];

  for (const { top, height } of bounds) {
    // A zero height means `onLayout` has not fired for this block yet. It waits rather than
    // guessing — guessing would mount every block at once on first render, which is the failure
    // this design exists to avoid.
    if (height <= 0 || viewportHeight <= 0) {
      shouldMount.push(false);
      isVisible.push(false);
      continue;
    }

    const bottom = top + height;

    // Touching edges do not count as overlapping: a block whose bottom is exactly the viewport top
    // occupies no visible pixels.
    isVisible.push(bottom > viewportTop && top < viewportBottom);
    shouldMount.push(bottom > viewportTop - margin && top < viewportBottom + margin);
  }

  return { shouldMount, isVisible };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest src/components/__tests__/lesson-stage-visibility.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit
git add src/components/lesson-stage-visibility.ts src/components/__tests__/lesson-stage-visibility.test.ts
git commit -m "feat(components): compute which lesson stages are visible and mountable"
```

---

### Task 3: One stage rendered whole

**Files:**
- Create: `src/components/lesson-stage-block.tsx`
- Test: `src/components/__tests__/lesson-stage-block.test.tsx`

**Interfaces:**
- Consumes: `LessonStage` from `../data/course/types`; `ShaderSandbox` from `./shader-sandbox`; `StageSourceView` from `./stage-source-view`.
- Produces: `function LessonStageBlock(props: LessonStageBlockProps)` where

```ts
type LessonStageBlockProps = {
  stage: LessonStage;
  position: number;
  isMounted: boolean;
  isVisible: boolean;
};
```

- [ ] **Step 1: Write the failing tests**

Create `src/components/__tests__/lesson-stage-block.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";

import { LessonStageBlock } from "../lesson-stage-block";
import type { LessonStage } from "../../data/course/types";

jest.mock("../shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text, View } = require("react-native") as typeof import("react-native");

  return {
    ShaderSandbox: ({ source, active }: { source: string; active?: boolean }) =>
      React.createElement(
        View,
        { testID: "sandbox" },
        React.createElement(Text, null, `${active === false ? "inactive" : "active"}:${source}`),
      ),
  };
});

const STAGE: LessonStage = {
  id: "a-stage",
  position: 2,
  title: "Divide by the resolution",
  body: "A body long enough to read like real teaching prose rather than a placeholder.",
  source: "fragColor = vec4(1.0, 0.0, 0.0, 1.0);",
};

describe("LessonStageBlock", () => {
  it("renders the stage's ordinal, title, body and source", async () => {
    await render(
      <LessonStageBlock isMounted isVisible position={2} stage={STAGE} />,
    );

    expect(screen.getByText("Stage 2")).toBeTruthy();
    expect(screen.getByText("Divide by the resolution")).toBeTruthy();
    expect(screen.getByText(/real teaching prose/)).toBeTruthy();
    expect(screen.getByTestId("stage-source")).toBeTruthy();
  });

  it("renders a sandbox once mounted", async () => {
    await render(
      <LessonStageBlock isMounted isVisible position={1} stage={STAGE} />,
    );

    expect(screen.getByTestId("sandbox")).toHaveTextContent(/^active:fragColor/);
  });

  it("renders a placeholder instead of a sandbox before mounting", async () => {
    await render(
      <LessonStageBlock isMounted={false} isVisible={false} position={1} stage={STAGE} />,
    );

    expect(screen.queryByTestId("sandbox")).toBeNull();
    expect(screen.getByTestId("stage-preview-placeholder")).toBeTruthy();
  });

  it("marks a mounted but off-screen sandbox inactive", async () => {
    await render(
      <LessonStageBlock isMounted isVisible={false} position={1} stage={STAGE} />,
    );

    expect(screen.getByTestId("sandbox")).toHaveTextContent(/^inactive:/);
  });

  it("still shows the source while the preview is unmounted", async () => {
    await render(
      <LessonStageBlock isMounted={false} isVisible={false} position={3} stage={STAGE} />,
    );

    expect(screen.getByTestId("stage-source")).toBeTruthy();
    expect(screen.getByText("Stage 3")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/components/__tests__/lesson-stage-block.test.tsx`

Expected: FAIL — `Cannot find module '../lesson-stage-block'`.

- [ ] **Step 3: Implement the component**

Create `src/components/lesson-stage-block.tsx`:

```tsx
import { StyleSheet, Text, View } from "react-native";

import { ShaderSandbox } from "./shader-sandbox";
import { StageSourceView } from "./stage-source-view";
import { Colors, Spacing } from "../constants/theme";
import type { LessonStage } from "../data/course/types";

const PREVIEW_HEIGHT = 200;

type LessonStageBlockProps = {
  stage: LessonStage;
  /** 1-based, for the block's eyebrow. */
  position: number;
  /** Whether this block's GL context has been created. One-way: the workspace never unsets it. */
  isMounted: boolean;
  /** Whether the block is on screen. Drives the sandbox's render loop. */
  isVisible: boolean;
};

/**
 * One stage read whole: its render, its source, its prose.
 *
 * Owns no scroll logic and makes no visibility decision — it is told what it is. That keeps the
 * arithmetic in one testable place and this component trivial.
 */
export function LessonStageBlock({
  stage,
  position,
  isMounted,
  isVisible,
}: LessonStageBlockProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.eyebrow}>Stage {position}</Text>

      {isMounted ? (
        <ShaderSandbox active={isVisible} height={PREVIEW_HEIGHT} source={stage.source} />
      ) : (
        // Same height as the sandbox, so mounting never shifts the layout under the reader.
        <View style={styles.placeholder} testID="stage-preview-placeholder" />
      )}

      <StageSourceView source={stage.source} />

      <Text style={styles.title}>{stage.title}</Text>
      <Text style={styles.body}>{stage.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.md,
    marginBottom: Spacing.xxxl,
  },
  eyebrow: {
    color: Colors.textSubtle,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  placeholder: {
    backgroundColor: Colors.surfaceRaised,
    height: PREVIEW_HEIGHT,
  },
  title: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "600",
  },
  body: {
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx jest src/components/__tests__/lesson-stage-block.test.tsx`

Expected: PASS, 5 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit
git add src/components/lesson-stage-block.tsx src/components/__tests__/lesson-stage-block.test.tsx
git commit -m "feat(components): render a lesson stage as a self-contained block"
```

---

### Task 4: Turn the workspace from a pager into a list

**Files:**
- Modify: `src/components/lesson-workspace.tsx`
- Test: `src/components/__tests__/lesson-workspace.test.tsx`

**Interfaces:**
- Consumes: `computeStageVisibility`, `StageBounds` (Task 2); `LessonStageBlock` (Task 3); `ShaderSandbox`'s `active` prop (Task 1).
- Produces: no new exports. `LessonWorkspace`'s props are unchanged.

- [ ] **Step 1: Write the failing tests**

In `src/components/__tests__/lesson-workspace.test.tsx`, delete every test naming the stage pager — "opens on the first stage", "advances to the next stage and shows its source", "goes back", "disables previous on the first stage and next on the last", and the stage-reset regression test. They describe a control that no longer exists. Replace them with:

```tsx
  it("renders every stage's title, body and source", async () => {
    await renderWorkspace();

    expect(screen.getByText("Stage 1")).toBeTruthy();
    expect(screen.getByText("Stage 4")).toBeTruthy();
    expect(screen.getAllByTestId("stage-source")).toHaveLength(4);
  });

  it("has no stage pager", async () => {
    await renderWorkspace();

    expect(screen.queryByLabelText("Next stage")).toBeNull();
    expect(screen.queryByLabelText("Previous stage")).toBeNull();
    expect(screen.queryByText(/Stage \d+ of \d+/)).toBeNull();
  });

  it("mounts the first stage's preview before any scrolling", async () => {
    await renderWorkspace();

    expect(screen.getAllByTestId("sandbox")).toHaveLength(1);
  });

  it("mounts a later stage once it comes within reach", async () => {
    await renderWorkspace();
    await measureAndScroll({ scrollY: 700 });

    expect(screen.getAllByTestId("sandbox").length).toBeGreaterThan(1);
  });

  it("keeps a stage mounted after it scrolls back out of view", async () => {
    await renderWorkspace();
    await measureAndScroll({ scrollY: 700 });
    const mountedAfterScroll = screen.getAllByTestId("sandbox").length;

    await measureAndScroll({ scrollY: 0 });

    expect(screen.getAllByTestId("sandbox").length).toBe(mountedAfterScroll);
  });

  it("stops the loop on previews that scrolled off-screen", async () => {
    await renderWorkspace();
    await measureAndScroll({ scrollY: 1400 });

    const sandboxes = screen.getAllByTestId("sandbox");
    expect(sandboxes.some((node) => /^inactive:/.test(node.props.children))).toBe(true);
  });

  it("resets mounted previews when the lesson changes", async () => {
    //  returns { props, view };  is already defined at module scope
    // in this file and has two stages.
    const { props, view } = await renderWorkspace();
    await measureAndScroll({ scrollY: 700 });
    expect(screen.getAllByTestId("sandbox").length).toBeGreaterThan(1);

    await view.rerender(<LessonWorkspace {...props} lesson={otherLesson} />);

    expect(screen.getAllByTestId("sandbox")).toHaveLength(1);
  });
```

Add this helper to the file, alongside its existing `renderWorkspace`. It fires the layout events the component needs before a scroll means anything:

```tsx
/**
 * The component cannot know any block's position until `onLayout` fires, and no test environment
 * fires it. This supplies plausible geometry — a 600pt viewport over four 400pt blocks — then scrolls.
 */
async function measureAndScroll({ scrollY }: { scrollY: number }) {
  const scroll = screen.getByTestId("lesson-scroll");

  await fireEvent(scroll, "layout", { nativeEvent: { layout: { height: 600, width: 400 } } });

  const blocks = screen.getAllByTestId(/^stage-block-/);
  for (const [index, block] of blocks.entries()) {
    await fireEvent(block, "layout", {
      nativeEvent: { layout: { y: index * 400, height: 400, width: 400 } },
    });
  }

  await fireEvent.scroll(scroll, {
    nativeEvent: {
      contentOffset: { y: scrollY, x: 0 },
      contentSize: { height: blocks.length * 400, width: 400 },
      layoutMeasurement: { height: 600, width: 400 },
    },
  });
}
```

The existing mock of `../shader-sandbox` must echo `active` so the off-screen test can read it:

```tsx
jest.mock("../shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text, View } = require("react-native") as typeof import("react-native");

  return {
    ShaderSandbox: ({ source, active }: { source: string; active?: boolean }) =>
      React.createElement(
        View,
        { testID: "sandbox" },
        React.createElement(Text, null, `${active === false ? "inactive" : "active"}:${source}`),
      ),
  };
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx jest src/components/__tests__/lesson-workspace.test.tsx`

Expected: FAIL — there is no `lesson-scroll` testID, no `stage-block-*` testIDs, and only one stage renders.

- [ ] **Step 3: Replace the pager state with visibility state**

In `src/components/lesson-workspace.tsx`, remove `stageIndex` from `WorkspaceState` and from `freshState`. Add these imports:

```tsx
import { LessonStageBlock } from "./lesson-stage-block";
import { computeStageVisibility, type StageBounds } from "./lesson-stage-visibility";
```

Add this state and geometry, after the existing `stages` derivation:

```tsx
  /**
   * Which blocks have a mounted preview, and which are on screen. `mounted` is one-way: a block that
   * scrolls out keeps its context and only loses its render loop, so scrolling back is free.
   */
  const [visibility, setVisibility] = useState(() => ({
    // Block 0 mounts unconditionally so an opened lesson is never blank while layout settles.
    mounted: stages.map((_stage, index) => index === 0),
    visible: stages.map((_stage, index) => index === 0),
  }));

  const boundsRef = useRef<StageBounds[]>([]);
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);

  // A new lesson invalidates every measurement. Reusing them would drive mount decisions from the
  // previous lesson's geometry — the same shape of bug as the stage index that used to leak here.
  useEffect(() => {
    boundsRef.current = [];
    scrollYRef.current = 0;
    setVisibility({
      mounted: stages.map((_stage, index) => index === 0),
      visible: stages.map((_stage, index) => index === 0),
    });
  }, [lesson.id, stages.length]);

  const recomputeVisibility = useCallback(() => {
    const { shouldMount, isVisible } = computeStageVisibility(
      boundsRef.current,
      scrollYRef.current,
      viewportHeightRef.current,
    );

    setVisibility((previous) => {
      const mounted = shouldMount.map((next, index) => next || previous.mounted[index] === true);
      const sameMounted = mounted.every((value, index) => value === previous.mounted[index]);
      const sameVisible = isVisible.every((value, index) => value === previous.visible[index]);

      // Returning the previous object tells React to skip the re-render. Without this the component
      // would re-render on every scroll frame, which is exactly the cost this layout must not add.
      return sameMounted && sameVisible ? previous : { mounted, visible: isVisible };
    });
  }, []);
```

Ensure `useCallback`, `useEffect` and `useRef` are imported from `react`.

- [ ] **Step 4: Replace the pager markup with the list**

Give the `ScrollView` its testID and handlers:

```tsx
          <ScrollView
            contentContainerStyle={styles.content}
            onLayout={(event) => {
              viewportHeightRef.current = event.nativeEvent.layout.height;
              recomputeVisibility();
            }}
            onScroll={(event) => {
              scrollYRef.current = event.nativeEvent.contentOffset.y;
              recomputeVisibility();
            }}
            overScrollMode="never"
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            testID="lesson-scroll"
          >
```

Replace the entire `<View style={styles.workspace}>…</View>` block — the sandbox, the source view, the stage bar and the single stage's title and body — with:

```tsx
            <View style={styles.stages}>
              {stages.map((item, index) => (
                <View
                  key={item.id}
                  onLayout={(event) => {
                    boundsRef.current[index] = {
                      top: event.nativeEvent.layout.y,
                      height: event.nativeEvent.layout.height,
                    };
                    recomputeVisibility();
                  }}
                  testID={`stage-block-${index}`}
                >
                  <LessonStageBlock
                    isMounted={visibility.mounted[index] === true}
                    isVisible={visibility.visible[index] === true}
                    position={index + 1}
                    stage={item}
                  />
                </View>
              ))}
            </View>
```

The wrapper `View` carries the layout measurement and the testID, which is why `LessonStageBlock` has no `onLayout` prop of its own — measurement is the list's concern, not the block's.

Delete the now-unused `stage` derivation, and delete these styles: `workspace`, `stageBar`, `stageNav`, `stageCount`, `stageTitle`, `stageBody`. Add:

```tsx
  stages: {
    gap: Spacing.xl,
  },
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx jest src/components/__tests__/lesson-workspace.test.tsx`

Expected: PASS. If "mounts a later stage once it comes within reach" fails, check that the wrapper `View`'s `onLayout` writes into `boundsRef` at the right index and that `recomputeVisibility` runs after the `ScrollView`'s own layout has set `viewportHeightRef`.

- [ ] **Step 6: Verify the whole suite and commit**

```bash
npm test
npx tsc --noEmit
npm run content:check
git add src/components/lesson-workspace.tsx src/components/__tests__/lesson-workspace.test.tsx
git commit -m "feat(components): read a lesson as one page of stage blocks"
```

---

## Device Verification

Automated tests prove which blocks mount and which loops stop. They cannot prove the thing this design actually risks. On a real device, after `adb uninstall com.anonymous.shadercraft` and `npm run android`:

- [ ] **1. Scroll smoothness.** Scroll a five-stage lesson top to bottom and back. Watch for stutter as blocks mount. This is the finding that decides whether the design stands.
- [ ] **2. Contexts are not recreated.** Scroll down past all stages and back up. Previews should resume instantly; a visible black flash or re-compile means a context was destroyed and the mounting is not one-way.
- [ ] **3. Off-screen loops really stop.** Scroll so an animated stage (Module 1 lesson 4) is off-screen and confirm the device does not stay warm or drain as if it were still drawing.
- [ ] **4. Nothing shifts under the reader.** As a block's preview mounts, the text you are reading must not jump — that is what the placeholder's matched height is for.
- [ ] **5. Oldest device available.** Five live contexts is the risk this design accepts; the oldest hardware is where it shows first.

**If check 1 or 5 fails**, the fallback is in the spec and is not a redesign: keep this block layout and render a single pinned preview above the scroll area, driven by whichever block is nearest the top. The content structure, the pure visibility module and `LessonStageBlock` all survive that change.
