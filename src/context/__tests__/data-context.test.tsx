// `data-context.tsx` imports the AsyncStorage native module at module scope (used by the legacy
// progress import). That native module isn't available under plain Jest, so it needs the
// package's own documented mock swapped in before anything requires it transitively.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Mock the three initialization collaborators so the five init steps can be driven and ordered
// deterministically without touching real SQLite.
jest.mock("../../data/database/client", () => ({
  openShadercraftDatabase: jest.fn(),
}));
jest.mock("../../data/database/seed", () => ({
  installBundledRelease: jest.fn(),
}));
jest.mock("../../data/progress/legacy-import", () => ({
  importLegacyProgress: jest.fn(),
}));

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { openShadercraftDatabase } from "../../data/database/client";
import { installBundledRelease } from "../../data/database/seed";
import type { DatabaseDriver } from "../../data/database/driver";
import { importLegacyProgress } from "../../data/progress/legacy-import";
import { DataProvider, useData, type DataContextValue } from "../data-context";
import bundledCourse from "../../../assets/course/bundled-course.json";

// `openShadercraftDatabase`'s real signature resolves an `ExpoSqliteDriver` (a concrete class with
// a private field), but the fakes here only need to satisfy the `DatabaseDriver` interface it's
// used through everywhere downstream. Retype the mock at the `DatabaseDriver` level so fakes don't
// need to impersonate the concrete class.
const mockOpenShadercraftDatabase = openShadercraftDatabase as unknown as jest.MockedFunction<
  () => Promise<DatabaseDriver>
>;
const mockInstallBundledRelease = installBundledRelease as jest.MockedFunction<
  typeof installBundledRelease
>;
const mockImportLegacyProgress = importLegacyProgress as jest.MockedFunction<
  typeof importLegacyProgress
>;

async function passthroughTransaction<T>(work: () => Promise<T>): Promise<T> {
  return work();
}

function createFakeDriver(): DatabaseDriver & { close: jest.MockedFunction<DatabaseDriver["close"]> } {
  return {
    exec: jest.fn().mockResolvedValue(undefined),
    run: jest.fn().mockResolvedValue({ changes: 0, lastInsertRowId: 0 }),
    first: jest.fn().mockResolvedValue(null),
    all: jest.fn().mockResolvedValue([]),
    transaction: passthroughTransaction,
    close: jest.fn().mockResolvedValue(undefined),
  };
}

/** Renders only once `useData()` reports `status: "ready"`, proving repositories were exposed. */
function Probe() {
  const data = useData();
  if (data.status !== "ready") return null;
  return (
    <Text testID="ready">
      {`ready:${typeof data.courseRepository}:${typeof data.progressRepository}`}
    </Text>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("DataProvider", () => {
  test("runs the five init steps strictly in order and exposes repositories once ready", async () => {
    const fakeDriver = createFakeDriver();
    const callOrder: string[] = [];

    mockOpenShadercraftDatabase.mockImplementation(async () => {
      callOrder.push("open");
      return fakeDriver;
    });
    mockInstallBundledRelease.mockImplementation(async () => {
      callOrder.push("install");
    });
    mockImportLegacyProgress.mockImplementation(async () => {
      callOrder.push("import");
    });

    await render(
      <DataProvider minimumSplashMs={0}>
        <Probe />
      </DataProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("ready")).toBeTruthy());

    // Step ordering: open+migrate, then install the bundled release, then the legacy import.
    // (Repository construction, step 3, is synchronous and is proven by `ready` exposing them.)
    expect(callOrder).toEqual(["open", "install", "import"]);

    // installBundledRelease/importLegacyProgress must receive the driver produced by step 1.
    expect(mockInstallBundledRelease).toHaveBeenCalledWith(fakeDriver, expect.anything());
    expect(mockOpenShadercraftDatabase).toHaveBeenCalledTimes(1);
    expect(mockInstallBundledRelease).toHaveBeenCalledTimes(1);
    expect(mockImportLegacyProgress).toHaveBeenCalledTimes(1);
    expect(fakeDriver.close).not.toHaveBeenCalled();
  });

  test("exposes a release installer wired to invalidate the course repository", async () => {
    // The one wiring that makes an activated remote release reach Course, Home and an open lesson:
    // `DataProvider` is the only place that holds the driver, so it is the only place that can hand
    // the installer the repository whose subscribers have to be told.
    const fakeDriver = createFakeDriver();
    mockOpenShadercraftDatabase.mockResolvedValue(fakeDriver);

    let captured: DataContextValue | null = null;
    function Capture() {
      captured = useData();
      return null;
    }

    await render(
      <DataProvider minimumSplashMs={0}>
        <Probe />
        <Capture />
      </DataProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("ready")).toBeTruthy());

    const data = captured as unknown as DataContextValue;
    if (data.status !== "ready") throw new Error("expected a ready DataContextValue");
    expect(data.bundledReleaseId).toBe(bundledCourse.id);

    let invalidations = 0;
    data.courseRepository.subscribe(() => {
      invalidations += 1;
    });

    // The fake driver reports nothing installed and no active release, so this is an activation.
    await act(async () => {
      await expect(
        data.releaseInstaller.stageAndActivate(bundledCourse, { verifyChecksum: false }),
      ).resolves.toEqual({ status: "activated", releaseId: bundledCourse.id });
    });

    expect(invalidations).toBe(1);
  });

  test("advances the splash phase log as each real init step completes", async () => {
    const fakeDriver = createFakeDriver();

    // Gate each step so the splash can be observed mid-initialization rather than only at the end.
    let releaseInstall: () => void = () => undefined;
    let legacyImport: () => void = () => undefined;

    mockOpenShadercraftDatabase.mockResolvedValue(fakeDriver);
    mockInstallBundledRelease.mockImplementation(
      () => new Promise<void>((resolve) => (releaseInstall = resolve)),
    );
    mockImportLegacyProgress.mockImplementation(
      () => new Promise<void>((resolve) => (legacyImport = resolve)),
    );

    await render(
      <DataProvider minimumSplashMs={0}>
        <Probe />
      </DataProvider>,
    );

    // The database is open, so its phase reads OK while the release install is still running.
    await waitFor(() => expect(screen.getByText("> OPEN_DATABASE  OK")).toBeTruthy());
    expect(screen.getByText("> INSTALL_RELEASE  …")).toBeTruthy();
    expect(screen.getByText("INSTALL_RELEASE")).toBeTruthy();

    await act(async () => {
      releaseInstall();
    });

    await waitFor(() => expect(screen.getByText("> INSTALL_RELEASE  OK")).toBeTruthy());
    expect(screen.getByText("> IMPORT_PROGRESS  …")).toBeTruthy();

    await act(async () => {
      legacyImport();
    });

    // Once every step is done the splash hands off to the children.
    await waitFor(() => expect(screen.getByTestId("ready")).toBeTruthy());
  });

  test("surfaces an initialization error instead of swallowing it, closing the opened driver first", async () => {
    const fakeDriver = createFakeDriver();
    mockOpenShadercraftDatabase.mockResolvedValue(fakeDriver);
    mockInstallBundledRelease.mockRejectedValue(new Error("bad bundled release"));

    await render(
      <DataProvider minimumSplashMs={0}>
        <Probe />
      </DataProvider>,
    );

    await waitFor(() => expect(screen.getByText("bad bundled release")).toBeTruthy());

    // Repositories were never exposed: the Probe (which only renders when status is "ready")
    // never mounted its marker.
    expect(screen.queryByTestId("ready")).toBeNull();

    // The legacy import (step 4) never ran because step 2 failed first.
    expect(mockImportLegacyProgress).not.toHaveBeenCalled();

    // The driver opened in step 1 was closed before the error was surfaced (data-context.tsx
    // ~lines 74-83), even though the failure happened in a later step.
    expect(fakeDriver.close).toHaveBeenCalledTimes(1);
  });

  test("retry() re-invokes initialization and can recover to ready after a transient failure", async () => {
    const fakeDriver = createFakeDriver();
    mockOpenShadercraftDatabase.mockResolvedValue(fakeDriver);
    mockInstallBundledRelease
      .mockRejectedValueOnce(new Error("transient failure"))
      .mockResolvedValue(undefined);
    mockImportLegacyProgress.mockResolvedValue(undefined);

    await render(
      <DataProvider minimumSplashMs={0}>
        <Probe />
      </DataProvider>,
    );

    await waitFor(() => expect(screen.getByText("transient failure")).toBeTruthy());
    expect(screen.queryByTestId("ready")).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    });

    await waitFor(() => expect(screen.getByTestId("ready")).toBeTruthy());

    expect(mockOpenShadercraftDatabase).toHaveBeenCalledTimes(2);
    expect(mockInstallBundledRelease).toHaveBeenCalledTimes(2);
    expect(mockImportLegacyProgress).toHaveBeenCalledTimes(1);

    // The driver opened during the failed attempt was closed exactly once; the successful retry
    // did not need to close its own (still-open) driver.
    expect(fakeDriver.close).toHaveBeenCalledTimes(1);
  });
});
