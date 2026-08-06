import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";

import { Colors, Spacing } from "../constants/theme";
import { ShaderProgramHost, type HostCompileResult } from "../shaders/shader-program-host";

const DEFAULT_HEIGHT = 220;

type ShaderSandboxProps = {
  /** A `mainImage` body. The wrapper is added by `wrapMainImageBody`. */
  source: string;
  paused?: boolean;
  /** Increment to reset `iTime` to zero without remounting. */
  restartToken?: number;
  height?: number;
  onCompileResult?: (result: HostCompileResult) => void;
};

export function ShaderSandbox({
  source,
  paused = false,
  restartToken = 0,
  height = DEFAULT_HEIGHT,
  onCompileResult,
}: ShaderSandboxProps) {
  const hostRef = useRef<ShaderProgramHost | null>(null);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const startedAtRef = useRef(0);
  const pausedRef = useRef(paused);
  const sourceRef = useRef(source);
  const onCompileResultRef = useRef(onCompileResult);
  const [hasRendered, setHasRendered] = useState(false);

  // Kept in refs so a new source or a pause toggle never restarts the animation frame loop.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    onCompileResultRef.current = onCompileResult;
  }, [onCompileResult]);

  useEffect(() => {
    startedAtRef.current = globalThis.performance.now();
  }, [restartToken]);

  useEffect(() => {
    sourceRef.current = source;
    const host = hostRef.current;
    if (!host) return;

    const result = host.setBody(source);
    onCompileResultRef.current?.(result);
    if (host.hasProgram()) setHasRendered(true);
  }, [source]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      hostRef.current?.dispose();
      hostRef.current = null;
    };
  }, []);

  const createContext = (gl: ExpoWebGLRenderingContext) => {
    const host = new ShaderProgramHost(gl);
    hostRef.current = host;
    startedAtRef.current = globalThis.performance.now();

    const result = host.setBody(sourceRef.current);
    onCompileResultRef.current?.(result);
    if (host.hasProgram()) setHasRendered(true);

    // While paused the clock stops advancing but the shader keeps being drawn, so the last frame
    // stays on screen rather than the preview going blank.
    let frozenSeconds = 0;

    const render = () => {
      if (!mountedRef.current) return;

      if (!pausedRef.current) {
        frozenSeconds = (globalThis.performance.now() - startedAtRef.current) / 1000;
      }

      host.render(frozenSeconds, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.endFrameEXP();

      frameRef.current = requestAnimationFrame(render);
    };

    render();
  };

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
