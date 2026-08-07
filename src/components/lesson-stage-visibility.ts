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
