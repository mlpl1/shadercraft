import { Image } from "expo-image";
import { useEffect, useMemo, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";

const LOGO = require("../../assets/images/scanline-s.png");
const GLOW = require("../../assets/images/splash-glow.png");

/** Spacing of the ambient background grid, matching the design's 24px rhythm. */
const GRID_SIZE = 24;

/**
 * Deliberately not `Colors.background`: this is the exact colour baked into `scanline-s.png`, which
 * is opaque and has no alpha channel. Matching it is what makes the logo's square edges invisible
 * instead of showing as a lighter box. The native splash in `app.json` uses the same value, so the
 * handoff into this screen is seamless and the single step to the app's darker background happens
 * once, when the course mounts. If the logo asset is ever re-exported, re-sample its corner pixel
 * and update both places together.
 */
const SPLASH_BACKGROUND = "#111B1C";

const BAR_WIDTH = 120;
const BAR_TRAVEL = BAR_WIDTH * 2;

export type SplashPhase = {
  /** Stable machine-style name, rendered verbatim in the phase log. */
  id: string;
  /** True once the step has finished successfully. */
  done: boolean;
};

export type SplashScreenProps = {
  /** Startup steps in execution order; the first unfinished one is the active phase. */
  phases: readonly SplashPhase[];
  /** Real application version, shown beside the wordmark. */
  version: string;
  /** Active curriculum release id. */
  releaseId: string;
  /** Number of published lessons in that release. */
  lessonCount: number;
  /** Local SQLite schema version. */
  schemaVersion: number;
  /** When set, the screen shows this failure and a retry action instead of progress. */
  error?: Error;
  onRetry?: () => void;
};

/**
 * The launch screen, shown while the database opens, the curriculum release installs, and legacy
 * progress is imported — and the same surface that reports a startup failure with a retry action.
 *
 * Every readout is a real value: the phase log tracks the actual initialization steps, and the
 * release, lesson count, schema and version all come from the app rather than being decorative.
 */
export function SplashScreen({
  error,
  lessonCount,
  onRetry,
  phases,
  releaseId,
  schemaVersion,
  version,
}: SplashScreenProps) {
  const activePhase = phases.find((phase) => !phase.done) ?? phases.at(-1);

  return (
    <View style={styles.root}>
      <Grid />

      <View style={styles.center}>
        <Image contentFit="contain" source={LOGO} style={styles.logo} />

        <View style={styles.wordmarkRow}>
          <Text style={styles.wordmark}>SHADERCRAFT</Text>
          <Text style={styles.version}>v{version}</Text>
        </View>
      </View>

      {/*
        Painted after the logo, not before it. The logo asset is opaque, so a glow underneath would
        light up the area around its square while the square itself stayed flat — showing the box.
        Laying the glow over both instead washes them uniformly, which is what makes the edges
        vanish, and is closer to the additive blend the design uses. The status and telemetry below
        come after this layer so their text stays crisp.
      */}
      <Bloom />

      {error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorTitle}>Could not open Shadercraft</Text>
          <Text style={styles.errorBody}>{error.message}</Text>
          {onRetry ? (
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View style={styles.statusBlock}>
          <View style={styles.statusRow}>
            <PulseDot />
            <Text style={styles.statusLabel}>{activePhase?.id ?? "STARTING"}</Text>
          </View>
          <LoadingBar />
        </View>
      )}

      <View style={styles.telemetry}>
        <View>
          {phases.map((phase) => (
            <Text key={phase.id} style={styles.logLine}>
              {`> ${phase.id}${phase.done ? "  OK" : "  …"}`}
            </Text>
          ))}
        </View>
        <View>
          <Text style={styles.telemetryLine}>RELEASE: {releaseId}</Text>
          <Text style={styles.telemetryLine}>
            LESSONS: {lessonCount}   SCHEMA: v{schemaVersion}
          </Text>
        </View>
      </View>
    </View>
  );
}

/**
 * The design's radial glow. React Native has no radial gradient and no Android-capable blur without
 * another native dependency, and stacking translucent circles bands visibly — every ring edge is a
 * step, and at these low opacities each step is only a level or two of 8-bit alpha, which is exactly
 * where banding shows. So the falloff is a real alpha ramp baked into an asset instead.
 *
 * `splash-glow.png` is 512×512 32-bit ARGB, flat accent colour (#C7F464) with
 * `alpha = (1 - distanceFromCentre) ^ 1.9 * 0.16`, reaching zero at the circle's edge. Regenerate it
 * with those numbers if the accent ever changes.
 */
function Bloom() {
  return (
    <View pointerEvents="none" style={styles.bloomLayer}>
      <Image contentFit="contain" source={GLOW} style={styles.bloom} />
    </View>
  );
}

function Grid() {
  const { height, width } = useWindowDimensions();

  const lines = useMemo(() => {
    const columns = Array.from({ length: Math.ceil(width / GRID_SIZE) }, (_, index) => index);
    const rows = Array.from({ length: Math.ceil(height / GRID_SIZE) }, (_, index) => index);
    return { columns, rows };
  }, [height, width]);

  return (
    <View pointerEvents="none" style={styles.gridLayer}>
      {lines.columns.map((index) => (
        <View key={`c${index}`} style={[styles.gridColumn, { left: index * GRID_SIZE }]} />
      ))}
      {lines.rows.map((index) => (
        <View key={`r${index}`} style={[styles.gridRow, { top: index * GRID_SIZE }]} />
      ))}
    </View>
  );
}

function PulseDot() {
  // Lazy state rather than a ref: the value is read during render to build the animated style, and
  // reading `ref.current` there is exactly what the compiler's refs rule forbids.
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.3] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.8] }) },
          ],
        },
      ]}
    />
  );
}

function LoadingBar() {
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(progress, {
        duration: 2000,
        easing: Easing.inOut(Easing.ease),
        toValue: 1,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [progress]);

  return (
    <View style={styles.barTrack}>
      <Animated.View
        style={[
          styles.barFill,
          {
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-BAR_WIDTH / 2, BAR_TRAVEL],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  barFill: {
    backgroundColor: Colors.accent,
    height: 2,
    width: BAR_WIDTH / 2,
  },
  barTrack: {
    backgroundColor: "rgba(255,255,255,0.10)",
    height: 2,
    overflow: "hidden",
    width: BAR_WIDTH,
  },
  bloom: {
    height: 480,
    width: 480,
  },
  bloomLayer: {
    alignItems: "center",
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  dot: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.round,
    height: 7,
    width: 7,
  },
  errorBlock: {
    alignItems: "center",
    gap: Spacing.md,
    paddingBottom: Spacing.xxxl,
    paddingHorizontal: Spacing.xxl,
  },
  errorBody: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: "center",
  },
  errorTitle: {
    color: Colors.coral,
    fontSize: 17,
    fontWeight: "700",
  },
  gridColumn: {
    backgroundColor: "rgba(255,255,255,0.03)",
    bottom: 0,
    position: "absolute",
    top: 0,
    width: 1,
  },
  gridLayer: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  gridRow: {
    backgroundColor: "rgba(255,255,255,0.03)",
    height: 1,
    left: 0,
    position: "absolute",
    right: 0,
  },
  logLine: {
    color: "rgba(199,244,100,0.40)",
    fontFamily: "monospace",
    fontSize: 9,
    letterSpacing: 0.5,
    lineHeight: 14,
  },
  logo: {
    height: 176,
    opacity: 0.95,
    width: 176,
  },
  retryButton: {
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
  },
  retryButtonText: {
    color: Colors.background,
    fontWeight: "700",
  },
  root: {
    backgroundColor: SPLASH_BACKGROUND,
    flex: 1,
  },
  statusBlock: {
    alignItems: "center",
    gap: Spacing.md,
    paddingBottom: Spacing.xxxl,
  },
  statusLabel: {
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 11,
    letterSpacing: 1.6,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  telemetry: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: Spacing.xxl,
    paddingHorizontal: Spacing.lg,
  },
  telemetryLine: {
    color: "rgba(199,244,100,0.40)",
    fontFamily: "monospace",
    fontSize: 9,
    letterSpacing: 0.5,
    lineHeight: 14,
    textAlign: "right",
  },
  version: {
    color: "rgba(199,244,100,0.75)",
    fontFamily: "monospace",
    fontSize: 11,
    marginTop: 4,
  },
  wordmark: {
    color: Colors.accent,
    fontSize: 25,
    fontWeight: "700",
    letterSpacing: 7,
  },
  wordmarkRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.xxxl,
    paddingLeft: 7,
  },
});
