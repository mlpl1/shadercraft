import { render, screen } from "@testing-library/react-native";

import { SplashScreen, type SplashPhase } from "../splash-screen";

const PHASES: SplashPhase[] = [
  { done: true, id: "OPEN_DATABASE" },
  { done: false, id: "INSTALL_RELEASE" },
  { done: false, id: "IMPORT_PROGRESS" },
];

async function renderSplash(overrides: Partial<Parameters<typeof SplashScreen>[0]> = {}) {
  return render(
    <SplashScreen
      lessonCount={14}
      phases={PHASES}
      releaseId="bundled-2026-08-04"
      schemaVersion={1}
      version="1.0.0"
      {...overrides}
    />,
  );
}

describe("SplashScreen", () => {
  it("shows the wordmark with the real application version", async () => {
    await renderSplash({ version: "2.3.4" });

    expect(screen.getByText("SHADERCRAFT")).toBeTruthy();
    expect(screen.getByText("v2.3.4")).toBeTruthy();
  });

  it("names the first unfinished phase as the active status", async () => {
    await renderSplash();

    expect(screen.getByText("INSTALL_RELEASE")).toBeTruthy();
  });

  it("marks finished phases OK and pending phases as still running", async () => {
    await renderSplash();

    expect(screen.getByText("> OPEN_DATABASE  OK")).toBeTruthy();
    expect(screen.getByText("> INSTALL_RELEASE  …")).toBeTruthy();
    expect(screen.getByText("> IMPORT_PROGRESS  …")).toBeTruthy();
  });

  it("falls back to the last phase once every step is done", async () => {
    await renderSplash({ phases: PHASES.map((phase) => ({ ...phase, done: true })) });

    // The status line keeps naming the final step rather than going blank during the handoff.
    expect(screen.getByText("IMPORT_PROGRESS")).toBeTruthy();
    expect(screen.getByText("> IMPORT_PROGRESS  OK")).toBeTruthy();
  });

  it("reports the real release, lesson count and schema version", async () => {
    await renderSplash({ lessonCount: 14, releaseId: "bundled-2026-08-04", schemaVersion: 1 });

    expect(screen.getByText("RELEASE: bundled-2026-08-04")).toBeTruthy();
    expect(screen.getByText(/LESSONS: 14\s+SCHEMA: v1/)).toBeTruthy();
  });

  it("replaces the progress readout with a retryable failure", async () => {
    const onRetry = jest.fn();
    await renderSplash({ error: new Error("disk is full"), onRetry });

    expect(screen.getByText("Could not open Shadercraft")).toBeTruthy();
    expect(screen.getByText("disk is full")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();

    // The status line and its progress bar must not sit underneath an error.
    expect(screen.queryByText("INSTALL_RELEASE")).toBeNull();
  });

  it("keeps the branding and telemetry visible while reporting a failure", async () => {
    await renderSplash({ error: new Error("disk is full") });

    expect(screen.getByText("SHADERCRAFT")).toBeTruthy();
    expect(screen.getByText("RELEASE: bundled-2026-08-04")).toBeTruthy();
  });
});
