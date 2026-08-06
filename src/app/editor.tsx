import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { GlslInput } from "../components/glsl-input";
import { ShaderSandbox } from "../components/shader-sandbox";
import { Colors, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useData } from "../context/data-context";
import type { Sketch } from "../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE, STARTER_SKETCH_TITLE } from "../data/sketches/starter-sketch";
import type { HostCompileResult } from "../shaders/shader-program-host";
import type { CompileError } from "../shaders/shader-source";

/** How long after the last keystroke the shader recompiles. */
const COMPILE_DEBOUNCE_MS = 300;

/**
 * How long after the last keystroke the sketch is written to SQLite. Deliberately longer than the
 * compile debounce: seeing the result of an edit matters more urgently than persisting it.
 */
const AUTOSAVE_DEBOUNCE_MS = 800;

export default function EditorScreen() {
  const data = useData();
  const { profileId } = useAuth();
  const sketchRepository = data.status === "ready" ? data.sketchRepository : null;

  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [compiledSource, setCompiledSource] = useState("");
  const [errors, setErrors] = useState<CompileError[]>([]);
  const [showingLastWorking, setShowingLastWorking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const compileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSourceRef = useRef<string | null>(null);
  /** Read by the unmount flush, which must not close over a stale sketch. */
  const sketchRef = useRef<Sketch | null>(null);

  useEffect(() => {
    sketchRef.current = sketch;
  }, [sketch]);

  useEffect(() => {
    if (!sketchRepository || !profileId) return;

    let cancelled = false;

    void (async () => {
      const existing = await sketchRepository.list(profileId);
      const opened =
        existing[0] ??
        (await sketchRepository.create(profileId, STARTER_SKETCH_TITLE, STARTER_SKETCH_SOURCE));

      if (cancelled) return;
      setSketch(opened);
      setCompiledSource(opened.source);
    })();

    return () => {
      cancelled = true;
    };
  }, [profileId, sketchRepository]);

  const flushSave = useCallback(async () => {
    const pending = pendingSourceRef.current;
    const target = sketchRef.current;
    if (pending === null || !sketchRepository || !profileId || !target) return;

    pendingSourceRef.current = null;

    try {
      await sketchRepository.updateSource(profileId, target.id, pending);
      setSaveError(null);
    } catch {
      // The buffer is untouched, so the learner keeps typing and the next autosave retries. Losing
      // work to a failed write would be the worst bug available here.
      setSaveError("Could not save. Your code is still here.");
    }
  }, [profileId, sketchRepository]);

  // Persist whatever is pending when the screen goes away, rather than losing the last edit to a
  // debounce that never elapsed.
  useEffect(
    () => () => {
      if (compileTimer.current) clearTimeout(compileTimer.current);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      void flushSave();
    },
    [flushSave],
  );

  const handleChange = useCallback(
    (next: string) => {
      pendingSourceRef.current = next;

      if (compileTimer.current) clearTimeout(compileTimer.current);
      compileTimer.current = setTimeout(() => setCompiledSource(next), COMPILE_DEBOUNCE_MS);

      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void flushSave(), AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const handleCompileResult = useCallback((result: HostCompileResult) => {
    if (result.ok) {
      setErrors([]);
      setShowingLastWorking(false);
      return;
    }

    setErrors(result.errors);
    setShowingLastWorking(result.showingLastWorking);
  }, []);

  if (!sketch) {
    return (
      <SafeAreaView edges={["top"]} style={styles.screen}>
        <View style={styles.loading}>
          <Text style={styles.loadingText}>Opening editor…</Text>
        </View>
        <BottomNavigation activeItem="editor" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Editor</Text>
        <Text numberOfLines={1} style={styles.title}>
          {sketch.title}
        </Text>
      </View>

      <ShaderSandbox height={200} onCompileResult={handleCompileResult} source={compiledSource} />

      {showingLastWorking && (
        <Text style={styles.staleBadge}>Showing the last version that compiled</Text>
      )}
      {saveError !== null && <Text style={styles.saveError}>{saveError}</Text>}

      <GlslInput errors={errors} initialValue={sketch.source} onChange={handleChange} />

      <BottomNavigation activeItem="editor" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  eyebrow: {
    color: Colors.textSubtle,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "600",
  },
  staleBadge: {
    backgroundColor: Colors.surfaceRaised,
    color: Colors.textMuted,
    fontSize: 11,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xs,
  },
  saveError: {
    color: Colors.coral,
    fontSize: 12,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xs,
  },
  loading: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
});
