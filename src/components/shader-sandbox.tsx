import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";

import { Colors, Spacing } from "../constants/theme";
import { useSettings } from "../context/settings-context";
import { shouldPresentFrame } from "../data/settings/frame-scheduler";
import type { ShaderParameterDefinition } from "../data/sketches/sketch-metadata";
import { ShaderProgramHost, type HostCompileResult } from "../shaders/shader-program-host";

const DEFAULT_HEIGHT = 220;
const EMPTY_PARAMETERS: readonly ShaderParameterDefinition[] = [];

type ShaderSandboxProps = {
  /** A `mainImage` body. The wrapper is added by `wrapMainImageBody`. */
  source: string;
  /** Optional GLSL declared above `mainImage`, for a stage whose shader defines its own functions. */
  helpers?: string;
  parameters?: readonly ShaderParameterDefinition[];
  paused?: boolean;
  /**
   * `false` stops the render loop entirely — no animation frame, no draw, no `endFrameEXP`. Used for
   * a preview scrolled off-screen, where drawing is pure waste.
   *
   * Deliberately distinct from `paused`, which freezes `iTime` but keeps drawing so a visible
   * preview holds its last frame rather than going blank.
   */
  active?: boolean;
  /** Increment to reset `iTime` to zero without remounting. */
  restartToken?: number;
  height?: number;
  onCompileResult?: (result: HostCompileResult) => void;
};

export function ShaderSandbox({
  source,
  helpers,
  parameters = EMPTY_PARAMETERS,
  paused = false,
  active = true,
  restartToken = 0,
  height = DEFAULT_HEIGHT,
  onCompileResult,
}: ShaderSandboxProps) {
  const { settings } = useSettings();
  const parameterValues = useMemo(
    () => Object.fromEntries(parameters.map(({ key, value }) => [key, value])),
    [parameters],
  );
  const parameterDefinitionSignature = useMemo(
    () =>
      JSON.stringify(
        parameters.map(({ key, label, min, max, step, defaultValue }) => [
          key,
          label,
          min,
          max,
          step,
          defaultValue,
        ]),
      ),
    [parameters],
  );
  const hostRef = useRef<ShaderProgramHost | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const startedAtRef = useRef(0);
  const lastPresentedAtRef = useRef(Number.NEGATIVE_INFINITY);
  const pausedRef = useRef(paused);
  const activeRef = useRef(active);
  const previewPerformanceRef = useRef(settings.previewPerformance);
  /** Set once the context exists, so the effect below can restart a loop that stopped itself. */
  const renderRef = useRef<(() => void) | null>(null);
  const sourceRef = useRef(source);
  const helpersRef = useRef(helpers);
  const parametersRef = useRef(parameters);
  const parameterValuesRef = useRef(parameterValues);
  const parameterDefinitionSignatureRef = useRef(parameterDefinitionSignature);
  const compiledParameterDefinitionSignatureRef = useRef(parameterDefinitionSignature);
  const onCompileResultRef = useRef(onCompileResult);
  const [hasRendered, setHasRendered] = useState(false);

  parametersRef.current = parameters;
  parameterValuesRef.current = parameterValues;
  parameterDefinitionSignatureRef.current = parameterDefinitionSignature;

  // Kept in refs so a new source or a pause toggle never restarts the animation frame loop.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    previewPerformanceRef.current = settings.previewPerformance;
  }, [settings.previewPerformance]);

  useEffect(() => {
    const wasActive = activeRef.current;
    activeRef.current = active;

    // The loop stops scheduling itself when inactive, so becoming active again has to restart it.
    // The null check on `frameRef` is what stops a re-render with unchanged `active` double-scheduling.
    if (active && !wasActive && frameRef.current === null) {
      renderRef.current?.();
    }
  }, [active]);

  useEffect(() => {
    onCompileResultRef.current = onCompileResult;
  }, [onCompileResult]);

  useEffect(() => {
    startedAtRef.current = globalThis.performance.now();
    lastPresentedAtRef.current = Number.NEGATIVE_INFINITY;
  }, [restartToken]);

  useEffect(() => {
    sourceRef.current = source;
    helpersRef.current = helpers;
    const host = hostRef.current;
    if (!host) return;

    const result = host.setBody(source, helpers, parametersRef.current);
    compiledParameterDefinitionSignatureRef.current = parameterDefinitionSignatureRef.current;
    onCompileResultRef.current?.(result);
    if (host.hasProgram()) setHasRendered(true);
  }, [source, helpers]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || parameterDefinitionSignature === compiledParameterDefinitionSignatureRef.current) return;

    const result = host.setBody(sourceRef.current, helpersRef.current, parametersRef.current);
    compiledParameterDefinitionSignatureRef.current = parameterDefinitionSignature;
    onCompileResultRef.current?.(result);
    if (host.hasProgram()) setHasRendered(true);
  }, [parameterDefinitionSignature]);

  useEffect(() => {
    hostRef.current?.setParameterValues(parameterValues);
  }, [parameterValues]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      hostRef.current?.dispose();
      hostRef.current = null;
    };
  }, []);

  // Memoized so its identity is stable across re-renders (e.g. the one triggered by
  // `setHasRendered`). `GLView` only ever creates one native surface per mount, but a test double
  // that fires `onContextCreate` from a `useEffect` keyed on this callback would otherwise re-fire —
  // and re-create the render loop — on every unrelated re-render.
  const createContext = useCallback((gl: ExpoWebGLRenderingContext) => {
    const host = new ShaderProgramHost(gl);
    hostRef.current = host;
    startedAtRef.current = globalThis.performance.now();
    lastPresentedAtRef.current = Number.NEGATIVE_INFINITY;

    const result = host.setBody(sourceRef.current, helpersRef.current, parametersRef.current);
    compiledParameterDefinitionSignatureRef.current = parameterDefinitionSignatureRef.current;
    host.setParameterValues(parameterValuesRef.current);
    onCompileResultRef.current?.(result);
    if (host.hasProgram()) setHasRendered(true);

    // While paused the clock stops advancing but the shader keeps being drawn, so the last frame
    // stays on screen rather than the preview going blank.
    let frozenSeconds = 0;

    const render = (timestampMs: number) => {
      if (!mountedRef.current) return;

      if (!activeRef.current) {
        // Stop without rescheduling. `frameRef` going null is what the effect above tests.
        frameRef.current = null;
        return;
      }

      if (shouldPresentFrame(previewPerformanceRef.current, timestampMs, lastPresentedAtRef.current)) {
        lastPresentedAtRef.current = timestampMs;
        if (!pausedRef.current) {
          frozenSeconds = (globalThis.performance.now() - startedAtRef.current) / 1000;
        }

        host.render(frozenSeconds, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.endFrameEXP();
      }

      frameRef.current = requestAnimationFrame(render);
    };

    const requestNextFrame = () => {
      frameRef.current = requestAnimationFrame(render);
    };

    renderRef.current = requestNextFrame;
    if (activeRef.current) requestNextFrame();
  }, []);

  return (
    <View style={[styles.container, { height }]} testID="shader-sandbox">
      <GLView onContextCreate={createContext} style={styles.glView} />
      {!hasRendered && (
        <View pointerEvents="none" style={styles.placeholder}>
          <Text style={styles.placeholderText}>Preview starts once your shader compiles</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surfaceRaised,
    overflow: "hidden",
    position: "relative",
  },
  glView: {
    flex: 1,
  },
  placeholder: {
    // Written out rather than spreading `StyleSheet.absoluteFillObject`, which RN 0.86 no longer
    // declares — only the non-spreadable `absoluteFill` registered style remains.
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
    alignItems: "center",
    backgroundColor: Colors.surfaceRaised,
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  placeholderText: {
    color: Colors.textSubtle,
    fontSize: 13,
    textAlign: "center",
  },
});
