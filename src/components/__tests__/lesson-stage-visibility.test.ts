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
