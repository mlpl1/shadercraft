import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

import {
  createDeviceSettingsRepository,
  DEFAULT_DEVICE_SETTINGS,
  type DeviceSettings,
  type DeviceSettingsRepository,
} from "../data/settings/device-settings";

export type DeviceSettingsPatch = Partial<Omit<DeviceSettings, "version">>;

export type SettingsContextValue = {
  settings: DeviceSettings;
  hydrated: boolean;
  error: Error | null;
  update(patch: DeviceSettingsPatch): Promise<void>;
  retry(): Promise<void>;
};

export const SettingsContext = createContext<SettingsContextValue | null>(null);

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("Unable to save device settings");
}

export function SettingsProvider({
  children,
  repository,
}: PropsWithChildren<{ repository?: DeviceSettingsRepository }>) {
  const [settingsRepository] = useState<DeviceSettingsRepository>(
    () => repository ?? createDeviceSettingsRepository(AsyncStorage),
  );
  const [settings, setSettings] = useState<DeviceSettings>(DEFAULT_DEVICE_SETTINGS);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [hydrationAttempt, setHydrationAttempt] = useState(0);
  const durableSettingsRef = useRef<DeviceSettings>(DEFAULT_DEVICE_SETTINGS);
  const optimisticSettingsRef = useRef<DeviceSettings>(DEFAULT_DEVICE_SETTINGS);
  const failedSettingsRef = useRef<DeviceSettings | null>(null);
  const pendingPatchRef = useRef<DeviceSettingsPatch | null>(null);
  const pendingUpdateRef = useRef<{ resolve: () => void; reject: (error: Error) => void }[]>([]);
  const hydratedRef = useRef(false);
  const latestOptimisticVersionRef = useRef(0);
  const latestDurableVersionRef = useRef(0);

  const persist = useCallback(
    async (record: DeviceSettings, optimisticVersion: number): Promise<void> => {
      try {
        await settingsRepository.save(record);
        if (optimisticVersion > latestDurableVersionRef.current) {
          durableSettingsRef.current = record;
          latestDurableVersionRef.current = optimisticVersion;
        }
        if (optimisticVersion === latestOptimisticVersionRef.current) {
          failedSettingsRef.current = null;
          setError(null);
          setSettings(record);
        }
      } catch (reason: unknown) {
        const saveError = asError(reason);
        if (optimisticVersion === latestOptimisticVersionRef.current) {
          optimisticSettingsRef.current = durableSettingsRef.current;
          failedSettingsRef.current = record;
          setSettings(durableSettingsRef.current);
          setError(saveError);
        }
        throw saveError;
      }
    },
    [settingsRepository],
  );

  const startUpdate = useCallback(
    (desired: DeviceSettings): Promise<void> => {
      const optimisticVersion = latestOptimisticVersionRef.current + 1;
      latestOptimisticVersionRef.current = optimisticVersion;
      optimisticSettingsRef.current = desired;
      failedSettingsRef.current = null;
      setSettings(desired);
      setError(null);
      return persist(desired, optimisticVersion);
    },
    [persist],
  );

  useEffect(() => {
    let cancelled = false;

    async function hydrate(): Promise<void> {
      try {
        const loaded = await settingsRepository.load();
        if (cancelled) return;

        durableSettingsRef.current = loaded;
        latestDurableVersionRef.current = latestOptimisticVersionRef.current;
        const pendingPatch = pendingPatchRef.current;
        const pendingUpdates = pendingUpdateRef.current;
        pendingPatchRef.current = null;
        pendingUpdateRef.current = [];

        if (pendingPatch) {
          const desired: DeviceSettings = { ...loaded, ...pendingPatch, version: 1 };
          void startUpdate(desired).then(
            () => pendingUpdates.forEach(({ resolve }) => resolve()),
            (reason: unknown) => {
              const saveError = asError(reason);
              pendingUpdates.forEach(({ reject }) => reject(saveError));
            },
          );
        } else if (latestOptimisticVersionRef.current === 0) {
          optimisticSettingsRef.current = loaded;
          setSettings(loaded);
          setError(null);
        }
      } catch (reason: unknown) {
        if (!cancelled) {
          const loadError = asError(reason);
          const pendingUpdates = pendingUpdateRef.current;
          pendingPatchRef.current = null;
          pendingUpdateRef.current = [];
          pendingUpdates.forEach(({ reject }) => reject(loadError));
          setError(loadError);
        }
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
          setHydrated(true);
        }
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [hydrationAttempt, settingsRepository, startUpdate]);

  const update = useCallback(
    (patch: DeviceSettingsPatch): Promise<void> => {
      if (!hydratedRef.current) {
        const desired: DeviceSettings = {
          ...optimisticSettingsRef.current,
          ...patch,
          version: 1,
        };
        optimisticSettingsRef.current = desired;
        pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
        failedSettingsRef.current = null;
        setSettings(desired);
        setError(null);
        return new Promise<void>((resolve, reject) => {
          pendingUpdateRef.current.push({ resolve, reject });
        });
      }

      return startUpdate({ ...optimisticSettingsRef.current, ...patch, version: 1 });
    },
    [startUpdate],
  );

  const retry = useCallback((): Promise<void> => {
    const failed = failedSettingsRef.current;
    if (failed) return startUpdate(failed);

    hydratedRef.current = false;
    setHydrated(false);
    setError(null);
    setHydrationAttempt((previousAttempt) => previousAttempt + 1);
    return Promise.resolve();
  }, [startUpdate]);

  return (
    <SettingsContext.Provider value={{ settings, hydrated, error, update, retry }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used inside SettingsProvider");
  }
  return context;
}