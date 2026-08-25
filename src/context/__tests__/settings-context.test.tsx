jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import {
  DEFAULT_DEVICE_SETTINGS,
  createDeviceSettingsRepository,
  type DeviceSettings,
  type DeviceSettingsRepository,
} from "../../data/settings/device-settings";
import { SettingsProvider, useSettings } from "../settings-context";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createRepository(): jest.Mocked<DeviceSettingsRepository> {
  return {
    load: jest.fn(),
    save: jest.fn(),
  };
}

let latestSettings: ReturnType<typeof useSettings> | null = null;

function Probe() {
  latestSettings = useSettings();
  return (
    <>
      <Text testID="font-size">{String(latestSettings.settings.editorFontSize)}</Text>
      <Text testID="hydrated">{String(latestSettings.hydrated)}</Text>
      <Text testID="error">{latestSettings.error?.message ?? ""}</Text>
    </>
  );
}

async function renderProvider(repository: DeviceSettingsRepository) {
  latestSettings = null;
  return render(
    <SettingsProvider repository={repository}>
      <Probe />
    </SettingsProvider>,
  );
}

describe("SettingsProvider", () => {
  test("hydrates the settings loaded from the device without blocking default consumers", async () => {
    const repository = createRepository();
    const loaded: DeviceSettings = {
      ...DEFAULT_DEVICE_SETTINGS,
      editorFontSize: 12,
      showEditorLineNumbers: false,
      editorPreviewMode: "wide",
    };
    const loading = createDeferred<DeviceSettings>();
    repository.load.mockReturnValue(loading.promise);

    await renderProvider(repository);

    expect(screen.getByTestId("font-size")).toHaveTextContent("14");
    await act(async () => {
      loading.resolve(loaded);
    });
    await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("true"));
    expect(screen.getByTestId("font-size")).toHaveTextContent("12");
  });

  test("rolls back a failed optimistic update and retries its desired record", async () => {
    const repository = createRepository();
    repository.load.mockResolvedValue(DEFAULT_DEVICE_SETTINGS);
    repository.save.mockRejectedValueOnce(new Error("storage full")).mockResolvedValueOnce(undefined);

    await renderProvider(repository);
    await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("true"));

    await act(async () => {
      await expect(latestSettings?.update({ editorFontSize: 16 })).rejects.toThrow("storage full");
    });

    expect(screen.getByTestId("font-size")).toHaveTextContent("14");
    expect(screen.getByTestId("error")).toHaveTextContent("storage full");

    await act(async () => {
      await latestSettings?.retry();
    });

    expect(repository.save).toHaveBeenNthCalledWith(1, {
      ...DEFAULT_DEVICE_SETTINGS,
      editorFontSize: 16,
    });
    expect(repository.save).toHaveBeenNthCalledWith(2, {
      ...DEFAULT_DEVICE_SETTINGS,
      editorFontSize: 16,
    });
    expect(screen.getByTestId("font-size")).toHaveTextContent("16");
    expect(screen.getByTestId("error")).toHaveTextContent("");
  });

  test("keeps the newest optimistic value when older and newer writes settle out of order", async () => {
    const repository = createRepository();
    repository.load.mockResolvedValue(DEFAULT_DEVICE_SETTINGS);
    const saves: ReturnType<typeof createDeferred<void>>[] = [];
    repository.save.mockImplementation(() => {
      const save = createDeferred<void>();
      saves.push(save);
      return save.promise;
    });

    await renderProvider(repository);
    await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("true"));

    let firstUpdate: Promise<void>;
    let secondUpdate: Promise<void>;
    await act(() => {
      firstUpdate = latestSettings!.update({ editorFontSize: 12 });
      secondUpdate = latestSettings!.update({ editorFontSize: 16 });
    });

    expect(repository.save.mock.calls.map(([settings]) => settings.editorFontSize)).toEqual([12, 16]);

    await act(async () => {
      saves[1].resolve();
      await secondUpdate;
    });
    expect(screen.getByTestId("font-size")).toHaveTextContent("16");

    await act(async () => {
      saves[0].resolve();
      await firstUpdate;
    });
    expect(screen.getByTestId("font-size")).toHaveTextContent("16");
  });
  test("merges a startup patch into every loaded durable field before saving", async () => {
    const repository = createRepository();
    const loading = createDeferred<DeviceSettings>();
    const loaded: DeviceSettings = {
      ...DEFAULT_DEVICE_SETTINGS,
      showEditorLineNumbers: false,
      previewPerformance: "battery-saver",
      editorPreviewMode: "wide",
    };
    repository.load.mockReturnValue(loading.promise);
    repository.save.mockResolvedValue(undefined);

    await renderProvider(repository);

    let startupUpdate: Promise<void>;
    await act(() => {
      startupUpdate = latestSettings!.update({ editorFontSize: 16 });
    });
    expect(repository.save).not.toHaveBeenCalled();

    await act(async () => {
      loading.resolve(loaded);
      await startupUpdate;
    });

    expect(repository.save).toHaveBeenCalledWith({ ...loaded, editorFontSize: 16 });
  });

  test("persists a startup update after the missing-record legacy migration", async () => {
    const writes: ReturnType<typeof createDeferred<void>>[] = [];
    const storage = {
      getItem: jest.fn(async (key: string) =>
        key === "@shadercraft/preview-mode" ? "square" : null,
      ),
      setItem: jest.fn<Promise<void>, [string, string]>(() => {
        const write = createDeferred<void>();
        writes.push(write);
        return write.promise;
      }),
      removeItem: jest.fn().mockResolvedValue(undefined),
    };
    const repository = createDeviceSettingsRepository(storage);

    await renderProvider(repository);
    await waitFor(() => expect(writes).toHaveLength(1));

    let startupUpdate: Promise<void>;
    await act(() => {
      startupUpdate = latestSettings!.update({ editorFontSize: 16 });
    });
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      writes[0].resolve();
    });
    await waitFor(() => expect(writes).toHaveLength(2));

    await act(async () => {
      writes[1].resolve();
      await startupUpdate;
    });

    expect(storage.setItem.mock.calls.map(([, value]) => JSON.parse(value))).toEqual([
      { ...DEFAULT_DEVICE_SETTINGS, editorPreviewMode: "square" },
      { ...DEFAULT_DEVICE_SETTINGS, editorFontSize: 16, editorPreviewMode: "square" },
    ]);
  });
  test("rolls back a queued startup update when loading settings fails", async () => {
    const repository = createRepository();
    const loading = createDeferred<DeviceSettings>();
    repository.load.mockReturnValue(loading.promise);

    await renderProvider(repository);

    let startupUpdate: Promise<void>;
    await act(() => {
      startupUpdate = latestSettings!.update({ editorFontSize: 16 });
    });
    expect(screen.getByTestId("font-size")).toHaveTextContent("16");

    await act(async () => {
      loading.reject(new Error("load failed"));
      await expect(startupUpdate).rejects.toThrow("load failed");
    });

    expect(screen.getByTestId("font-size")).toHaveTextContent("14");
    expect(screen.getByTestId("error")).toHaveTextContent("load failed");
  });

  test("retries a queued startup patch against authoritative settings after load failure", async () => {
    const repository = createRepository();
    const firstLoad = createDeferred<DeviceSettings>();
    const authoritative: DeviceSettings = {
      ...DEFAULT_DEVICE_SETTINGS,
      showEditorLineNumbers: false,
      previewPerformance: "battery-saver",
      editorPreviewMode: "wide",
    };
    repository.load.mockReturnValueOnce(firstLoad.promise).mockResolvedValueOnce(authoritative);
    repository.save.mockResolvedValue(undefined);

    await renderProvider(repository);

    let startupUpdate: Promise<void>;
    await act(() => {
      startupUpdate = latestSettings!.update({ editorFontSize: 16 });
    });
    await act(async () => {
      firstLoad.reject(new Error("load failed"));
      await expect(startupUpdate).rejects.toThrow("load failed");
    });

    let retry: Promise<void>;
    await act(() => {
      retry = latestSettings!.retry();
    });
    await act(async () => {
      await retry;
    });

    expect(repository.load).toHaveBeenCalledTimes(2);
    expect(repository.save).toHaveBeenCalledWith({ ...authoritative, editorFontSize: 16 });
    expect(screen.getByTestId("font-size")).toHaveTextContent("16");
  });
});
