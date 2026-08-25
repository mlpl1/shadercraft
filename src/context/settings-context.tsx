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

  useEffect(() => {
    let cancelled = false;

    async function hydrate(): Promise<void> {
      try {
        const loaded = await settingsRepository.load();
        if (cancelled) return;
        if (latestOptimisticVersionRef.current === 0) {
          durableSettingsRef.current = loaded;
          optimisticSettingsRef.current = loaded;
          setSettings(loaded);
        }
        setError(null);
      } catch (reason: unknown) {
        if (!cancelled) setError(asError(reason));
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [hydrationAttempt, settingsRepository]);

  const update = useCallback(
    (patch: DeviceSettingsPatch): Promise<void> => {
      const desired: DeviceSettings = {
        ...optimisticSettingsRef.current,
        ...patch,
        version: 1,
      };
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

  const retry = useCallback((): Promise<void> => {
    const failed = failedSettingsRef.current;
    if (failed) {
      const optimisticVersion = latestOptimisticVersionRef.current + 1;
      latestOptimisticVersionRef.current = optimisticVersion;
      optimisticSettingsRef.current = failed;
      setSettings(failed);
      setError(null);
      return persist(failed, optimisticVersion);
    }

    setHydrated(false);
    setError(null);
    setHydrationAttempt((previousAttempt) => previousAttempt + 1);
    return Promise.resolve();
  }, [persist]);

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