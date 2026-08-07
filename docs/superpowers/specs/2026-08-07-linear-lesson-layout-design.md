# Linear Lesson Layout Design

Date: 2026-08-07
Status: approved design, not yet planned

## Summary

A lesson currently shows one stage at a time, advanced with prev/next buttons. This design replaces
that with a single scrolling page where every stage is a self-contained block — its title, its live
render, its shader source, and its prose, read top to bottom.

The change is presentational only. `LessonStage` and the content schema are untouched, so no content,
database, repository or authoring work is affected, and the 27 lessons still to be authored are
unaffected either way.

The whole difficulty is GL lifecycle. Each block's preview is a `GLView` — a real EGL context with a
render loop — so a naive linear layout either creates every context at once on lesson open, or
creates and destroys them repeatedly during scrolling. Both are worse than paging. The design below
avoids both.

## Motivation

Paging was never weighed against the alternative; it was specified in an implementation brief and
inherited unexamined. Reviewing it after the fact, the linear layout wins on several counts:

- **No navigation state.** The `stageIndex`-not-resetting defect that cost a full fix round existed
  only because of paging. There is no index in this design to leak between lessons.
- **Comparison is natural.** Scrolling back to see stage 1's source while reading stage 3 is a
  gesture rather than four taps and a lost place.
- **The lesson's shape is visible.** A learner sees how long it is rather than discovering it four
  taps in.
- **It matches how shader tutorials actually read.** The Book of Shaders is one scrolling page.
- **Friction removed.** Roughly 128 taps across the 32-lesson Act 1, buying nothing.

One correctness gain comes with it, discussed under Failure Handling: a failed compile can no longer
show the learner a different stage's render.

## Scope

### Included

- `lesson-workspace.tsx` restructured from a pager into a list.
- A new `LessonStageBlock` component: one stage rendered whole.
- A new pure module computing which blocks should be mounted and which are visible.
- A new prop on `ShaderSandbox` distinguishing "off-screen, stop the loop" from the existing
  "paused but visible".

### Excluded

- Any change to `LessonStage`, the content schema, `lesson_stages`, the repository, the installer, or
  authored content. This is presentation only.
- The Editor tab and its sketches. `ShaderSandbox` gains a prop; nothing else about it changes.
- The Tutorials section.

## Guiding Decisions

1. **Every stage is a block; there is no active stage.** All stages are on screen in sequence. The
   only per-block state is whether its preview has been mounted and whether it is currently visible.
2. **Lazy mount, then never unmount while the lesson is open.** Opening a lesson creates one context,
   not five; the rest arrive as the learner scrolls; none is ever destroyed. Context creation is
   expensive and doing it repeatedly mid-scroll is the failure mode this avoids.
3. **Off-screen blocks stop their render loop entirely.** An idle GL context costs almost nothing; an
   animating one costs a draw every frame. This is what makes several contexts affordable.
4. **The viewport arithmetic is a pure function.** It is the part with boundary conditions and
   off-by-one risk, and it should be unit-testable without a renderer — the same reasoning that put
   the wrapper and log parsing in `shader-source.ts` rather than in a component.
5. **Accepted risk, with a named fallback.** Four or five live contexts is more than the one a pinned
   preview would use, and the oldest Android devices are where that shows first. If the device walk
   reveals stutter, the fallback is not a redesign: the same block layout works with a single pinned
   preview, because the content structure is identical either way.

## Architecture

### `src/components/lesson-stage-visibility.ts` (new, pure)

No React, no layout API, no GL.

```ts
export type StageBounds = { top: number; height: number };

export function computeStageVisibility(
  bounds: readonly StageBounds[],
  scrollY: number,
  viewportHeight: number,
): { shouldMount: boolean[]; isVisible: boolean[] };
```

- `isVisible[i]` — block `i` intersects `[scrollY, scrollY + viewportHeight]`.
- `shouldMount[i]` — block `i` is within one viewport-height of entering, so its context is created
  shortly before the learner reaches it rather than as they arrive.

The function answers only "now". It holds no history and makes no decision sticky; that belongs to
the caller.

`bounds` carries one entry per stage, in stage order. A stage whose `onLayout` has not yet fired is
represented by `{ top: 0, height: 0 }`; a zero-height entry is never visible and never mountable, so
an unmeasured block simply waits. Both returned arrays are the same length as `bounds`.

### `src/components/lesson-stage-block.tsx` (new)

One stage rendered whole: title, `ShaderSandbox`, `StageSourceView`, prose body. Props carry
`stage`, `isMounted`, `isVisible`, and an `onLayout` reporting its offset upward.

It owns no scroll logic and makes no visibility decision — it is told what it is. That keeps it
trivially testable and keeps all the arithmetic in one place.

### `src/components/lesson-workspace.tsx` (modified)

Becomes a list: header, progress bar, intro, stage blocks, takeaway, `tryThis`, action bar.

Removed: `stageIndex` from `WorkspaceState`, the stage bar, the prev/next controls, and the
"Stage N of M" counter.

Added: a `Set` of indices ever mounted, unioned with each `computeStageVisibility` result. **This is
where mounting becomes one-way.** A block scrolled out of view stays mounted with its loop stopped,
so scrolling back costs nothing.

### `src/components/shader-sandbox.tsx` (modified)

Gains `active?: boolean`, defaulting to `true`. When `false` the render loop stops entirely: no
`requestAnimationFrame`, no draw, no `endFrameEXP`. Used as `active={isVisible}`.

This is deliberately **not** the existing `paused`. `paused` freezes `iTime` but keeps drawing, so a
paused preview holds its last frame instead of going blank — correct for a visible-but-paused
preview, and pure waste for one nobody can see. The two concepts stay separate: a preview can be
`active` and `paused` (visible, frozen, still drawing) or inactive (off-screen, drawing nothing).

## Data Flow

1. Each block reports its offset and height through `onLayout`.
2. The `ScrollView`'s `onScroll` supplies `scrollY` at `scrollEventThrottle={16}`; its own `onLayout`
   supplies `viewportHeight`.
3. `computeStageVisibility` returns `shouldMount` and `isVisible` for every block.
4. The workspace unions `shouldMount` into its mounted `Set` and passes `isMounted` and `isVisible`
   down.
5. A mounted block renders its `ShaderSandbox`; an unmounted one renders its content with a
   placeholder in the preview's place, so layout does not shift when it mounts.
6. A visible block animates; an off-screen one holds a static context with no loop.

## Failure Handling

| Condition | Behaviour |
| --- | --- |
| A stage's shader fails to compile | That block shows its own placeholder and error. Neighbours unaffected |
| `onLayout` has not fired | Bounds unknown, so nothing mounts — except block 0, which mounts unconditionally so an opened lesson is never blank |
| Rapid scrolling | Recomputed on throttled scroll events; the mounted `Set` is union-only, so mount decisions cannot flap |
| **Lesson changes** | Blocks are keyed by stage id and the mounted `Set` **must reset**. Stale bounds from the previous lesson driving mount decisions is precisely the shape of the `stageIndex` defect already paid for once |
| GL context cannot be created | `onContextCreate` never fires; that block keeps its placeholder. Degrades per block rather than taking the screen down |

### The correctness gain

In the paged design, `ShaderProgramHost` retains the last program that linked, so a stage whose
shader failed to compile showed **the previous stage's render** — a learner reading stage 3's prose
against stage 2's picture, with nothing indicating the mismatch. With one sandbox per block that is
structurally impossible: a block shows its own output or its own placeholder, never a neighbour's.

## Testing Strategy

### Pure (`lesson-stage-visibility.ts`)

Carries the real coverage, and needs no renderer:

- Blocks entirely above and entirely below the viewport.
- Blocks partially intersecting at the top and bottom edges.
- A block sitting exactly on a boundary.
- Blocks inside and outside the one-viewport mount margin.
- Empty bounds, before any layout has happened.
- `scrollY` of 0, and a `scrollY` past the last block.

### Components

Mocking `ShaderSandbox` with a view echoing its props, as the suite already does:

- Every stage's title, prose and source render.
- Block 0 mounts a sandbox before any scroll occurs.
- Simulated layout plus scroll mounts a later block.
- A block scrolled back out **stays** mounted.
- An off-screen block receives the inactive prop, a visible one does not.
- Switching lessons resets the mounted set.
- "Stage N of M" and the prev/next controls no longer exist.

### What testing cannot establish

Whether four or five live contexts are smooth on real hardware. No Jest environment provides a GPU,
so the tests prove only that the intended blocks mount and the intended loops stop. Scroll smoothness
and battery cost are device questions, and the device walk is the only thing that answers them.

## Success Criteria

- A lesson reads top to bottom as one page; no prev/next control remains.
- Opening a lesson creates one GL context, not one per stage.
- No context is destroyed while the lesson stays open.
- Off-screen previews run no render loop.
- A block whose shader fails to compile never displays another block's render.
- Switching lessons resets mounted state.
- `npm test`, `npx tsc --noEmit` and `npm run content:check` all pass.

## Technical References

- `docs/data/shader-sandbox.md` — the sandbox contract, including the `paused` semantics this design
  extends rather than overloads.
- `src/components/shader-sandbox.tsx` — the render loop being made conditional.
- `src/components/lesson-workspace.tsx` — the pager being replaced.
- `src/components/stage-source-view.tsx` — the read-only code block, reused unchanged inside each
  stage block.
