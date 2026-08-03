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
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import bundledCourse from "../../assets/course/bundled-course.json";
import { Colors, Radius, Spacing } from "../constants/theme";
import type { CourseRepository } from "../data/course/course-repository";
import { SqliteCourseRepository } from "../data/course/sqlite-course-repository";
import { openShadercraftDatabase } from "../data/database/client";
import type { DatabaseDriver } from "../data/database/driver";
import { installBundledRelease } from "../data/database/seed";
import { importLegacyProgress } from "../data/progress/legacy-import";
import type { ProgressRepository } from "../data/progress/progress-repository";
import { SqliteProgressRepository } from "../data/progress/sqlite-progress-repository";

type DataState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | {
      status: "ready";
      courseRepository: CourseRepository;
      progressRepository: ProgressRepository;
    };

export type DataContextValue = DataState & { retry: () => void };

export const DataContext = createContext<DataContextValue | null>(null);

/**
 * Opens SQLite, installs the bundled curriculum release, builds the repositories, and runs the
 * one-time legacy progress import — strictly in that order, so nothing downstream ever observes a
 * repository backed by a database that failed migration or seeding. Renders its own loading/retry
 * UI and only mounts `children` once every step has succeeded; database initialization errors are
 * surfaced with a retry action rather than swallowed.
 */
export function DataProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<DataState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const driverRef = useRef<DatabaseDriver | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    async function initialize() {
      // 1. Open and migrate SQLite.
      const driver = await openShadercraftDatabase();
      driverRef.current = driver;

      // 2. Parse and install the bundled release.
      await installBundledRelease(driver, bundledCourse);

      // 3. Create the SQLite repositories.
      const courseRepository = new SqliteCourseRepository(driver);
      const progressRepository = new SqliteProgressRepository(driver, courseRepository);

      // 4. Run legacy progress import.
      await importLegacyProgress(AsyncStorage, progressRepository);

      // 5. Expose repositories only after all steps succeed.
      if (!cancelled) {
        setState({ status: "ready", courseRepository, progressRepository });
      }
    }

    initialize().catch(async (error: unknown) => {
      const driver = driverRef.current;
      driverRef.current = null;
      if (driver) {
        await driver.close().catch(() => undefined);
      }
      if (!cancelled) {
        setState({
          status: "error",
          error: error instanceof Error ? error : new Error("Database startup failed"),
        });
      }
    });

    return () => {
      cancelled = true;
      const driver = driverRef.current;
      driverRef.current = null;
      if (driver) {
        void driver.close();
      }
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((previousAttempt) => previousAttempt + 1);
  }, []);

  const value: DataContextValue = { ...state, retry };

  return (
    <DataContext.Provider value={value}>
      {state.status === "ready" ? children : <StartupStatus state={state} onRetry={retry} />}
    </DataContext.Provider>
  );
}

function StartupStatus({
  state,
  onRetry,
}: {
  state: Extract<DataState, { status: "loading" | "error" }>;
  onRetry: () => void;
}) {
  if (state.status === "error") {
    return (
      <View style={styles.startupContainer}>
        <Text style={styles.errorTitle}>Could not open Shadercraft</Text>
        <Text style={styles.startupText}>{state.error.message}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retryButton}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.startupContainer}>
      <ActivityIndicator color={Colors.accent} />
      <Text style={styles.startupText}>Preparing Shadercraft…</Text>
    </View>
  );
}

export function useData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useData must be used inside DataProvider");
  }
  return context;
}

const styles = StyleSheet.create({
  errorTitle: {
    color: Colors.coral,
    fontSize: 18,
    fontWeight: "700",
  },
  retryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  retryButtonText: {
    color: Colors.background,
    fontWeight: "700",
  },
  startupContainer: {
    alignItems: "center",
    backgroundColor: Colors.background,
    flex: 1,
    gap: 12,
    justifyContent: "center",
    padding: 24,
  },
  startupText: {
    color: Colors.textMuted,
    textAlign: "center",
  },
});
