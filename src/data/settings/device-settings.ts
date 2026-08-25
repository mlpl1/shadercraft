export type EditorFontSize = 12 | 14 | 16;
export type PreviewPerformance = "battery-saver" | "full-speed";
export type PreviewMode = "responsive" | "square" | "wide";

export type DeviceSettings = Readonly<{
  version: 1;
  editorFontSize: EditorFontSize;
  showEditorLineNumbers: boolean;
  previewPerformance: PreviewPerformance;
  editorPreviewMode: PreviewMode;
}>;

export interface DeviceSettingsRepository {
  load(): Promise<DeviceSettings>;
  save(settings: DeviceSettings): Promise<void>;
}

interface SettingsStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const DEVICE_SETTINGS_KEY = "@shadercraft/device-settings";
const LEGACY_PREVIEW_MODE_KEY = "@shadercraft/preview-mode";

export const DEFAULT_DEVICE_SETTINGS: DeviceSettings = {
  version: 1,
  editorFontSize: 14,
  showEditorLineNumbers: true,
  previewPerformance: "full-speed",
  editorPreviewMode: "responsive",
};

function normalizeSettings(record: unknown): DeviceSettings {
  if (!record || typeof record !== "object") return DEFAULT_DEVICE_SETTINGS;
  const value = record as Record<string, unknown>;
  if (value.version !== 1) return DEFAULT_DEVICE_SETTINGS;

  return {
    version: 1,
    editorFontSize:
      value.editorFontSize === 12 || value.editorFontSize === 14 || value.editorFontSize === 16
        ? value.editorFontSize
        : DEFAULT_DEVICE_SETTINGS.editorFontSize,
    showEditorLineNumbers:
      typeof value.showEditorLineNumbers === "boolean"
        ? value.showEditorLineNumbers
        : DEFAULT_DEVICE_SETTINGS.showEditorLineNumbers,
    previewPerformance:
      value.previewPerformance === "battery-saver" || value.previewPerformance === "full-speed"
        ? value.previewPerformance
        : DEFAULT_DEVICE_SETTINGS.previewPerformance,
    editorPreviewMode:
      value.editorPreviewMode === "square" || value.editorPreviewMode === "wide"
        ? value.editorPreviewMode
        : DEFAULT_DEVICE_SETTINGS.editorPreviewMode,
  };
}

function parseSettings(serialized: string): DeviceSettings {
  try {
    return normalizeSettings(JSON.parse(serialized));
  } catch {
    return DEFAULT_DEVICE_SETTINGS;
  }
}

function normalizeLegacyPreviewMode(value: string | null): PreviewMode {
  return value === "square" || value === "wide" ? value : "responsive";
}

export function createDeviceSettingsRepository(storage: SettingsStorage): DeviceSettingsRepository {
  let saveQueue: Promise<void> = Promise.resolve();

  function save(settings: DeviceSettings): Promise<void> {
    const write = saveQueue.then(() =>
      storage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(settings)),
    );
    saveQueue = write.catch(() => undefined);
    return write;
  }

  return {
    async load(): Promise<DeviceSettings> {
      const serialized = await storage.getItem(DEVICE_SETTINGS_KEY);
      if (serialized !== null) return parseSettings(serialized);

      const legacyPreviewMode = normalizeLegacyPreviewMode(
        await storage.getItem(LEGACY_PREVIEW_MODE_KEY),
      );
      const migratedSettings: DeviceSettings = {
        ...DEFAULT_DEVICE_SETTINGS,
        editorPreviewMode: legacyPreviewMode,
      };
      await save(migratedSettings);
      await storage.removeItem(LEGACY_PREVIEW_MODE_KEY);
      return migratedSettings;
    },
    save,
  };
}
