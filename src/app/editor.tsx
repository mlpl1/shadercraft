import { useCallback, useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { GlslInput } from "../components/glsl-input";
import { PreviewControls } from "../components/preview-controls";
import { ShaderSandbox } from "../components/shader-sandbox";
import { SketchListSheet } from "../components/sketch-list-sheet";
import { Colors, Radius, Spacing } from "../constants/theme";
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
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [isListOpen, setIsListOpen] = useState(false);
  const [compiledSource, setCompiledSource] = useState("");
  const [errors, setErrors] = useState<CompileError[]>([]);
  const [showingLastWorking, setShowingLastWorking] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [restartToken, setRestartToken] = useState(0);

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

      // Re-read rather than reusing `existing`: on a first run the create above inserted a row the
      // list call could not have seen. Every await finishes before the cancellation guard, so an
      // unmount mid-load cannot land state on a dead component.
      const all = existing.length > 0 ? existing : await sketchRepository.list(profileId);

      if (cancelled) return;
      setSketches(all);
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

  /**
   * Every mutation flushes the pending autosave first, then re-reads the list so ordering stays
   * correct — `updatedAt DESC` is only meaningful once the write it depends on has landed.
   */
  const openSketch = useCallback(
    async (id: string) => {
      await flushSave();
      if (!sketchRepository || !profileId) return;

      const next = await sketchRepository.get(profileId, id);
      if (!next) return;

      setSketches(await sketchRepository.list(profileId));
      setSketch(next);
      setCompiledSource(next.source);
      setErrors([]);
      setIsListOpen(false);
    },
    [flushSave, profileId, sketchRepository],
  );

  const createSketch = useCallback(async () => {
    await flushSave();
    if (!sketchRepository || !profileId) return;

    const created = await sketchRepository.create(
      profileId,
      STARTER_SKETCH_TITLE,
      STARTER_SKETCH_SOURCE,
    );

    setSketches(await sketchRepository.list(profileId));
    setSketch(created);
    setCompiledSource(created.source);
    setErrors([]);
    setIsListOpen(false);
  }, [flushSave, profileId, sketchRepository]);

  const renameSketch = useCallback(
    async (id: string, title: string) => {
      if (!sketchRepository || !profileId) return;

      await sketchRepository.rename(profileId, id, title);
      setSketches(await sketchRepository.list(profileId));
      setSketch((current) => (current && current.id === id ? { ...current, title } : current));
    },
    [profileId, sketchRepository],
  );

  const deleteSketch = useCallback(
    async (id: string) => {
      if (!sketchRepository || !profileId) return;

      // A pending autosave for the sketch being deleted must not resurrect it after the delete.
      if (sketchRef.current?.id === id) pendingSourceRef.current = null;

      await sketchRepository.delete(profileId, id);
      const remaining = await sketchRepository.list(profileId);
      setSketches(remaining);

      // Deleting the open sketch would leave the editor with nothing to show, so fall through to
      // whatever is now most recent.
      if (sketchRef.current?.id === id && remaining[0]) {
        setSketch(remaining[0]);
        setCompiledSource(remaining[0].source);
        setErrors([]);
      }
    },
    [profileId, sketchRepository],
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
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Editor</Text>
          <Text numberOfLines={1} style={styles.title}>
            {sketch.title}
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Sketches"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setIsListOpen(true)}
          style={({ pressed }) => [styles.headerAction, pressed && styles.headerActionPressed]}
          testID="open-sketch-list"
        >
          <Text style={styles.headerActionText}>Sketches</Text>
        </Pressable>
      </View>

      <PreviewControls
        collapsed={collapsed}
        onRestart={() => setRestartToken((token) => token + 1)}
        onToggleCollapse={() => setCollapsed((value) => !value)}
        onTogglePause={() => setPaused((value) => !value)}
        paused={paused}
      />

      {/* Collapsing unmounts the sandbox, which releases the GL context and stops the frame loop —
          the point of the control is to reclaim the screen and the GPU, not just to hide pixels. */}
      {!collapsed && (
        <ShaderSandbox
          height={200}
          onCompileResult={handleCompileResult}
          paused={paused}
          restartToken={restartToken}
          source={compiledSource}
        />
      )}

      {showingLastWorking && !collapsed && (
        <Text style={styles.staleBadge}>Showing the last version that compiled</Text>
      )}
      {saveError !== null && <Text style={styles.saveError}>{saveError}</Text>}

      {/* `key` forces a remount when the open sketch changes: GlslInput seeds its buffer from
          `initialValue` once, so without this, switching sketches would leave the old text on screen. */}
      <GlslInput
        errors={errors}
        initialValue={sketch.source}
        key={sketch.id}
        onChange={handleChange}
      />

      <BottomNavigation activeItem="editor" />

      <Modal
        animationType="slide"
        onRequestClose={() => setIsListOpen(false)}
        transparent
        visible={isListOpen}
      >
        <View style={styles.modalBackdrop}>
          <SketchListSheet
            activeSketchId={sketch.id}
            onClose={() => setIsListOpen(false)}
            onCreate={() => void createSketch()}
            onDelete={(id) => void deleteSketch(id)}
            onRename={(id, title) => void renameSketch(id, title)}
            onSelect={(id) => void openSketch(id)}
            sketches={sketches}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  headerText: {
    flex: 1,
  },
  headerAction: {
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  headerActionPressed: {
    backgroundColor: Colors.surfaceRaised,
  },
  headerActionText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  modalBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    flex: 1,
    justifyContent: "flex-end",
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
