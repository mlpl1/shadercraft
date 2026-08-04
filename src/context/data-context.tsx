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
import Constants from "expo-constants";

import bundledCourse from "../../assets/course/bundled-course.json";
import { SplashScreen } from "../components/splash-screen";
import type { CourseRepository } from "../data/course/course-repository";
import { SqliteCourseRepository } from "../data/course/sqlite-course-repository";
import { openShadercraftDatabase } from "../data/database/client";
import type { DatabaseDriver } from "../data/database/driver";
import { LATEST_SCHEMA_VERSION } from "../data/database/migrations";
import { installBundledRelease } from "../data/database/seed";
import { importLegacyProgress } from "../data/progress/legacy-import";
import type { ProgressRepository } from "../data/progress/progress-repository";
import { SqliteProgressRepository } from "../data/progress/sqlite-progress-repository";

/**
 * The real initialization steps, in execution order. The splash screen renders these verbatim as
 * its phase log, so the names are user-visible: keep them accurate to what each step does.
 */
const STARTUP_PHASES = ["OPEN_DATABASE", "INSTALL_RELEASE", "IMPORT_PROGRESS"] as const;

/**
 * On a warm start every step is a fast no-op, so without a floor the launch screen would flash past
 * unread. Tests pass 0 to stay deterministic.
 */
const DEFAULT_MINIMUM_SPLASH_MS = 900;

const PUBLISHED_LESSON_COUNT = bundledCourse.modules.reduce(
  (total, module) => total + module.lessons.length,
  0,
);

type DataState =
  | { status: "loading"; completedPhases: number }
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
export function DataProvider({
  children,
  minimumSplashMs = DEFAULT_MINIMUM_SPLASH_MS,
}: PropsWithChildren<{ minimumSplashMs?: number }>) {
  const [state, setState] = useState<DataState>({ status: "loading", completedPhases: 0 });
  const [attempt, setAttempt] = useState(0);
  const driverRef = useRef<DatabaseDriver | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", completedPhases: 0 });
    const startedAt = Date.now();

    function completePhase(completedPhases: number) {
      if (!cancelled) {
        setState({ status: "loading", completedPhases });
      }
    }

    async function initialize() {
      // 1. Open and migrate SQLite.
      const driver = await openShadercraftDatabase();
      driverRef.current = driver;
      completePhase(1);

      // 2. Parse and install the bundled release.
      await installBundledRelease(driver, bundledCourse);
      completePhase(2);

      // 3. Create the SQLite repositories.
      const courseRepository = new SqliteCourseRepository(driver);
      const progressRepository = new SqliteProgressRepository(driver, courseRepository);

      // 4. Run legacy progress import.
      await importLegacyProgress(AsyncStorage, progressRepository);
      completePhase(3);

      // Hold the launch screen long enough to be legible on a warm start, where every step above
      // is a fast no-op. This delays only the handoff — all the real work is already done.
      const remaining = minimumSplashMs - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }

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
  }, [attempt, minimumSplashMs]);

  const retry = useCallback(() => {
    setAttempt((previousAttempt) => previousAttempt + 1);
  }, []);

  const value: DataContextValue = { ...state, retry };

  return (
    <DataContext.Provider value={value}>
      {state.status === "ready" ? (
        children
      ) : (
        <SplashScreen
          error={state.status === "error" ? state.error : undefined}
          lessonCount={PUBLISHED_LESSON_COUNT}
          onRetry={retry}
          phases={STARTUP_PHASES.map((id, index) => ({
            done: state.status === "loading" && index < state.completedPhases,
            id,
          }))}
          releaseId={bundledCourse.id}
          schemaVersion={LATEST_SCHEMA_VERSION}
          version={Constants.expoConfig?.version ?? "0.0.0"}
        />
      )}
    </DataContext.Provider>
  );
}

export function useData(): DataContextValue {
  const context = useContext(DataContext);
  if (!context) {
    throw new Error("useData must be used inside DataProvider");
  }
  return context;
}
