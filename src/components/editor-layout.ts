export const MIN_PREVIEW_HEIGHT = 120;
export const PREVIEW_HEIGHT_RATIO = 0.6;

export function clampPreviewHeight(value: number, windowHeight: number): number {
  const maximum = Math.max(
    MIN_PREVIEW_HEIGHT,
    Math.floor(windowHeight * PREVIEW_HEIGHT_RATIO),
  );
  return Math.min(maximum, Math.max(MIN_PREVIEW_HEIGHT, Math.round(value)));
}
