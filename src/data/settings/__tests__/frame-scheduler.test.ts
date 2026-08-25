import { BATTERY_SAVER_FRAME_MS, shouldPresentFrame } from "../frame-scheduler";

describe("preview frame scheduler", () => {
  it("presents every full-speed frame", () => {
    expect(shouldPresentFrame("full-speed", 1, 0)).toBe(true);
  });

  it("skips battery-saver frames before the 30 FPS boundary", () => {
    expect(shouldPresentFrame("battery-saver", 20, 0)).toBe(false);
  });

  it("presents battery-saver frames at the 30 FPS boundary", () => {
    expect(shouldPresentFrame("battery-saver", 34, 0)).toBe(true);
    expect(BATTERY_SAVER_FRAME_MS).toBe(1000 / 30);
  });

  it("presents backwards timestamps so the loop can reset instead of starving", () => {
    expect(shouldPresentFrame("battery-saver", 9, 10)).toBe(true);
  });
});
