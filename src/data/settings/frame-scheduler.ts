import type { PreviewPerformance } from "./device-settings";

export const BATTERY_SAVER_FRAME_MS = 1000 / 30;

export function shouldPresentFrame(
  mode: PreviewPerformance,
  timestampMs: number,
  lastPresentedAtMs: number,
): boolean {
  if (mode === "full-speed") return true;
  if (timestampMs < lastPresentedAtMs) return true;
  return timestampMs - lastPresentedAtMs >= BATTERY_SAVER_FRAME_MS;
}
