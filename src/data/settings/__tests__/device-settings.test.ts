import {
  DEFAULT_DEVICE_SETTINGS,
  createDeviceSettingsRepository,
  type DeviceSettings,
} from "../device-settings";

const DEVICE_SETTINGS_KEY = "@shadercraft/device-settings";
const LEGACY_PREVIEW_MODE_KEY = "@shadercraft/preview-mode";

function createStorage() {
  return {
    getItem: jest.fn<Promise<string | null>, [string]>(),
    setItem: jest.fn<Promise<void>, [string, string]>(),
    removeItem: jest.fn<Promise<void>, [string]>(),
  };
}

describe("DeviceSettingsRepository", () => {
  test("returns defaults when no versioned settings record exists", async () => {
    const storage = createStorage();
    storage.getItem.mockResolvedValue(null);
    const repository = createDeviceSettingsRepository(storage);

    await expect(repository.load()).resolves.toEqual(DEFAULT_DEVICE_SETTINGS);
  });

  test("normalizes each persisted field independently", async () => {
    const storage = createStorage();
    storage.getItem.mockResolvedValue(
      JSON.stringify({
        version: 1,
        editorFontSize: 99,
        showEditorLineNumbers: false,
        previewPerformance: "unknown",
        editorPreviewMode: "wide",
      }),
    );
    const repository = createDeviceSettingsRepository(storage);

    await expect(repository.load()).resolves.toEqual({
      ...DEFAULT_DEVICE_SETTINGS,
      showEditorLineNumbers: false,
      editorPreviewMode: "wide",
    });
  });

  test("ignores records from an unsupported settings version", async () => {
    const storage = createStorage();
    storage.getItem.mockResolvedValue(
      JSON.stringify({ ...DEFAULT_DEVICE_SETTINGS, version: 2, editorFontSize: 16 }),
    );
    const repository = createDeviceSettingsRepository(storage);

    await expect(repository.load()).resolves.toEqual(DEFAULT_DEVICE_SETTINGS);
  });
  test("migrates the legacy preview mode only after writing the versioned record", async () => {
    const storage = createStorage();
    storage.getItem.mockImplementation(async (key) =>
      key === LEGACY_PREVIEW_MODE_KEY ? "square" : null,
    );
    storage.setItem.mockResolvedValue(undefined);
    storage.removeItem.mockResolvedValue(undefined);
    const repository = createDeviceSettingsRepository(storage);

    await expect(repository.load()).resolves.toEqual({
      ...DEFAULT_DEVICE_SETTINGS,
      editorPreviewMode: "square",
    });

    expect(storage.setItem).toHaveBeenCalledWith(
      DEVICE_SETTINGS_KEY,
      JSON.stringify({ ...DEFAULT_DEVICE_SETTINGS, editorPreviewMode: "square" }),
    );
    expect(storage.removeItem).toHaveBeenCalledWith(LEGACY_PREVIEW_MODE_KEY);
    expect(storage.setItem.mock.invocationCallOrder[0]).toBeLessThan(
      storage.removeItem.mock.invocationCallOrder[0],
    );
  });

  test("keeps the legacy value when the migrated record cannot be written", async () => {
    const storage = createStorage();
    storage.getItem.mockImplementation(async (key) =>
      key === LEGACY_PREVIEW_MODE_KEY ? "wide" : null,
    );
    storage.setItem.mockRejectedValue(new Error("storage full"));
    const repository = createDeviceSettingsRepository(storage);

    await expect(repository.load()).rejects.toThrow("storage full");
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  test("serializes saves and recovers the queue after a rejected write", async () => {
    const storage = createStorage();
    const writes: { value: string; resolve: () => void; reject: (error: Error) => void }[] = [];
    storage.setItem.mockImplementation(
      (_key, value) =>
        new Promise<void>((resolve, reject) => {
          writes.push({ value, resolve, reject });
        }),
    );
    const repository = createDeviceSettingsRepository(storage);
    const first: DeviceSettings = { ...DEFAULT_DEVICE_SETTINGS, editorFontSize: 12 };
    const second: DeviceSettings = { ...DEFAULT_DEVICE_SETTINGS, editorFontSize: 16 };
    const third: DeviceSettings = { ...DEFAULT_DEVICE_SETTINGS, showEditorLineNumbers: false };

    const firstSave = repository.save(first);
    const secondSave = repository.save(second);
    await Promise.resolve();
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    writes[0].reject(new Error("temporary failure"));
    await expect(firstSave).rejects.toThrow("temporary failure");
    await Promise.resolve();
    expect(storage.setItem).toHaveBeenCalledTimes(2);

    writes[1].resolve();
    await expect(secondSave).resolves.toBeUndefined();

    const thirdSave = repository.save(third);
    await Promise.resolve();
    expect(storage.setItem).toHaveBeenCalledTimes(3);
    writes[2].resolve();
    await expect(thirdSave).resolves.toBeUndefined();

    expect(storage.setItem.mock.calls.map(([, value]) => JSON.parse(value).editorFontSize)).toEqual([
      12,
      16,
      14,
    ]);
  });
});
