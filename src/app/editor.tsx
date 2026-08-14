import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { SymbolViewProps } from "expo-symbols";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../components/app-icon";
import { BottomNavigation } from "../components/bottom-navigation";
import { GlslInput } from "../components/glsl-input";
import { PreviewControls } from "../components/preview-controls";
import { ShaderFileDrawer } from "../components/shader-file-drawer";
import { ShaderParametersPanel } from "../components/shader-parameters-panel";
import { ShaderSandbox } from "../components/shader-sandbox";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useData } from "../context/data-context";
import type {
  ShaderParameterDefinition,
  SketchMetadata,
} from "../data/sketches/sketch-metadata";
import type { Sketch } from "../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE, STARTER_SKETCH_TITLE } from "../data/sketches/starter-sketch";
import type { HostCompileResult } from "../shaders/shader-program-host";
import type { CompileError } from "../shaders/shader-source";

const COMPILE_DEBOUNCE_MS = 300;
const SOURCE_AUTOSAVE_DEBOUNCE_MS = 800;
const METADATA_AUTOSAVE_DEBOUNCE_MS = 500;
const PREVIEW_HEIGHT = 220;

type PendingSource = {
  sketchId: string;
  source: string;
};

type PendingMetadata = {
  sketchId: string;
  metadata: SketchMetadata;
};

export default function EditorScreen() {
  const router = useRouter();
  const { sketchId: routeSketchIdValue } = useLocalSearchParams<{
    sketchId?: string | string[];
  }>();
  const routeSketchId = Array.isArray(routeSketchIdValue)
    ? routeSketchIdValue[0]
    : routeSketchIdValue;
  const data = useData();
  const { profileId } = useAuth();
  const sketchRepository = data.status === "ready" ? data.sketchRepository : null;

  const [sketch, setSketch] = useState<Sketch | null>(null);
  const [sketches, setSketches] = useState<Sketch[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [compiledSource, setCompiledSource] = useState("");
  const [errors, setErrors] = useState<CompileError[]>([]);
  const [showingLastWorking, setShowingLastWorking] = useState(false);
  const [sourceSaveError, setSourceSaveError] = useState<string | null>(null);
  const [metadataSaveError, setMetadataSaveError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [restartToken, setRestartToken] = useState(0);

  const compileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metadataSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSourceRef = useRef<PendingSource | null>(null);
  const pendingMetadataRef = useRef<PendingMetadata | null>(null);
  const sketchRef = useRef<Sketch | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshSketches = useCallback(async () => {
    if (!sketchRepository || !profileId) return [];

    const next = await sketchRepository.list(profileId);
    if (mountedRef.current) setSketches(next);
    return next;
  }, [profileId, sketchRepository]);

  const flushSourceSave = useCallback(async (): Promise<boolean> => {
    if (sourceSaveTimer.current) {
      clearTimeout(sourceSaveTimer.current);
      sourceSaveTimer.current = null;
    }

    const pending = pendingSourceRef.current;
    if (!pending || !sketchRepository || !profileId) return true;
    pendingSourceRef.current = null;

    try {
      await sketchRepository.updateSource(profileId, pending.sketchId, pending.source);
      if (mountedRef.current) setSourceSaveError(null);
    } catch {
      if (pendingSourceRef.current === null) pendingSourceRef.current = pending;
      if (mountedRef.current) setSourceSaveError("Could not save. Your code is still here.");
      return false;
    }

    if (mountedRef.current) {
      try {
        await refreshSketches();
      } catch {
        // The write succeeded. A later drawer action will try the ordering read again.
      }
    }
    return true;
  }, [profileId, refreshSketches, sketchRepository]);

  const flushMetadataSave = useCallback(async (): Promise<boolean> => {
    if (metadataSaveTimer.current) {
      clearTimeout(metadataSaveTimer.current);
      metadataSaveTimer.current = null;
    }

    const pending = pendingMetadataRef.current;
    if (!pending || !sketchRepository || !profileId) return true;
    pendingMetadataRef.current = null;

    try {
      await sketchRepository.updateMetadata(profileId, pending.sketchId, pending.metadata);
      if (mountedRef.current) setMetadataSaveError(null);
    } catch {
      if (pendingMetadataRef.current === null) pendingMetadataRef.current = pending;
      if (mountedRef.current) {
        setMetadataSaveError("Could not save parameters. Your values are still here.");
      }
      return false;
    }

    if (mountedRef.current) {
      try {
        await refreshSketches();
      } catch {
        // The values are saved even if this ordering refresh could not complete.
      }
    }
    return true;
  }, [profileId, refreshSketches, sketchRepository]);

  const flushAllSaves = useCallback(async (): Promise<boolean> => {
    const sourceSaved = await flushSourceSave();
    const metadataSaved = await flushMetadataSave();
    return sourceSaved && metadataSaved;
  }, [flushMetadataSave, flushSourceSave]);

  const activateSketch = useCallback((next: Sketch) => {
    if (compileTimer.current) {
      clearTimeout(compileTimer.current);
      compileTimer.current = null;
    }
    pendingSourceRef.current = null;
    pendingMetadataRef.current = null;
    sketchRef.current = next;
    setSketch(next);
    setCompiledSource(next.source);
    setErrors([]);
    setShowingLastWorking(false);
    setSourceSaveError(null);
    setMetadataSaveError(null);
    setParametersOpen(false);
  }, []);

  useEffect(() => {
    if (!sketchRepository || !profileId) return;

    let cancelled = false;
    setSketch(null);
    sketchRef.current = null;
    setSketches([]);

    void (async () => {
      if (!(await flushAllSaves())) return;

      const existing = await sketchRepository.list(profileId);
      const requested = routeSketchId
        ? await sketchRepository.get(profileId, routeSketchId)
        : null;
      const opened =
        requested ??
        existing[0] ??
        (await sketchRepository.create(profileId, STARTER_SKETCH_TITLE, STARTER_SKETCH_SOURCE));
      const all = existing.length === 0
        ? await sketchRepository.list(profileId)
        : existing;

      if (cancelled) return;
      setSketches(all);
      activateSketch(opened);
    })();

    return () => {
      cancelled = true;
    };
  }, [activateSketch, flushAllSaves, profileId, routeSketchId, sketchRepository]);

  useEffect(
    () => () => {
      if (compileTimer.current) clearTimeout(compileTimer.current);
      if (sourceSaveTimer.current) clearTimeout(sourceSaveTimer.current);
      if (metadataSaveTimer.current) clearTimeout(metadataSaveTimer.current);

      const pendingSource = pendingSourceRef.current;
      const pendingMetadata = pendingMetadataRef.current;
      pendingSourceRef.current = null;
      pendingMetadataRef.current = null;

      if (!sketchRepository || !profileId) return;
      void (async () => {
        if (pendingSource) {
          try {
            await sketchRepository.updateSource(
              profileId,
              pendingSource.sketchId,
              pendingSource.source,
            );
          } catch {
            // The route is gone, so there is nowhere to display a retry warning.
          }
        }
        if (pendingMetadata) {
          try {
            await sketchRepository.updateMetadata(
              profileId,
              pendingMetadata.sketchId,
              pendingMetadata.metadata,
            );
          } catch {
            // The in-memory values existed until unmount; persistence failure is intentionally safe.
          }
        }
      })();
    },
    [profileId, sketchRepository],
  );

  useEffect(() => {
    if (!parametersOpen && !drawerOpen) return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (parametersOpen) {
        setParametersOpen(false);
        return true;
      }
      if (drawerOpen) {
        setDrawerOpen(false);
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [drawerOpen, parametersOpen]);

  const handleSourceChange = useCallback(
    (next: string) => {
      const active = sketchRef.current;
      if (!active) return;

      pendingSourceRef.current = { sketchId: active.id, source: next };

      if (compileTimer.current) clearTimeout(compileTimer.current);
      compileTimer.current = setTimeout(() => {
        compileTimer.current = null;
        setCompiledSource(next);
      }, COMPILE_DEBOUNCE_MS);

      if (sourceSaveTimer.current) clearTimeout(sourceSaveTimer.current);
      sourceSaveTimer.current = setTimeout(() => {
        sourceSaveTimer.current = null;
        void flushSourceSave();
      }, SOURCE_AUTOSAVE_DEBOUNCE_MS);
    },
    [flushSourceSave],
  );

  const handleParametersChange = useCallback(
    (parameters: ShaderParameterDefinition[]) => {
      const active = sketchRef.current;
      if (!active) return;

      const metadata: SketchMetadata = { ...active.metadata, parameters };
      const next = { ...active, metadata };
      sketchRef.current = next;
      setSketch(next);
      setSketches((current) =>
        current.map((item) => (item.id === next.id ? { ...item, metadata } : item)),
      );
      pendingMetadataRef.current = { sketchId: next.id, metadata };

      if (metadataSaveTimer.current) clearTimeout(metadataSaveTimer.current);
      metadataSaveTimer.current = setTimeout(() => {
        metadataSaveTimer.current = null;
        void flushMetadataSave();
      }, METADATA_AUTOSAVE_DEBOUNCE_MS);
    },
    [flushMetadataSave],
  );

  const openSketch = useCallback(
    async (id: string) => {
      if (!(await flushAllSaves()) || !sketchRepository || !profileId) return;

      const next = await sketchRepository.get(profileId, id);
      if (!next) return;

      setSketches(await sketchRepository.list(profileId));
      activateSketch(next);
      setDrawerOpen(false);
    },
    [activateSketch, flushAllSaves, profileId, sketchRepository],
  );

  const createSketch = useCallback(async () => {
    if (!(await flushAllSaves()) || !sketchRepository || !profileId) return;

    const created = await sketchRepository.create(
      profileId,
      STARTER_SKETCH_TITLE,
      STARTER_SKETCH_SOURCE,
    );
    setSketches(await sketchRepository.list(profileId));
    activateSketch(created);
    setDrawerOpen(false);
  }, [activateSketch, flushAllSaves, profileId, sketchRepository]);

  const renameSketch = useCallback(
    async (id: string, title: string) => {
      if (!(await flushAllSaves()) || !sketchRepository || !profileId) return;

      await sketchRepository.rename(profileId, id, title);
      setSketches(await sketchRepository.list(profileId));
      const active = sketchRef.current;
      if (active?.id === id) {
        const next = { ...active, title };
        sketchRef.current = next;
        setSketch(next);
      }
    },
    [flushAllSaves, profileId, sketchRepository],
  );

  const deleteSketch = useCallback(
    async (id: string) => {
      if (!(await flushAllSaves()) || !sketchRepository || !profileId) return;

      await sketchRepository.delete(profileId, id);
      const remaining = await sketchRepository.list(profileId);
      setSketches(remaining);

      if (sketchRef.current?.id !== id) return;

      if (remaining[0]) {
        activateSketch(remaining[0]);
        setDrawerOpen(false);
        return;
      }

      sketchRef.current = null;
      setSketch(null);
      setDrawerOpen(false);
      setParametersOpen(false);
      router.replace("/library");
    },
    [activateSketch, flushAllSaves, profileId, router, sketchRepository],
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

  const hasEditorMessage =
    showingLastWorking ||
    sourceSaveError !== null ||
    metadataSaveError !== null ||
    sketch.metadataWarning !== null;

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <View style={styles.appFrame}>
        <View style={styles.header} testID="editor-header">
          <View style={styles.fileIdentity}>
            <HeaderAction
              fallback="☰"
              label="Open shader files"
              name={{ android: "menu", ios: "line.3.horizontal", web: "menu" }}
              onPress={() => {
                setParametersOpen(false);
                setDrawerOpen(true);
              }}
              testID="open-sketch-list"
            />
            <Text numberOfLines={1} style={styles.title}>
              {sketch.title}
            </Text>
          </View>

          <View style={styles.headerActions}>
            <HeaderAction
              active={parametersOpen}
              fallback="≋"
              label="Open shader parameters"
              name={{ android: "tune", ios: "slider.horizontal.3", web: "tune" }}
              onPress={() => setParametersOpen(true)}
              testID="open-shader-parameters"
            />
            <PreviewControls
              collapsed={collapsed}
              onRestart={() => setRestartToken((token) => token + 1)}
              onToggleCollapse={() => setCollapsed((value) => !value)}
              onTogglePause={() => setPaused((value) => !value)}
              paused={paused}
            />
          </View>
        </View>

        <View style={styles.workspace}>
          {!collapsed && (
            <View style={styles.preview} testID="preview-workspace">
              <ShaderSandbox
                height={PREVIEW_HEIGHT}
                onCompileResult={handleCompileResult}
                parameters={sketch.metadata.parameters}
                paused={paused}
                restartToken={restartToken}
                source={compiledSource}
              />
              <View pointerEvents="none" style={styles.previewStatus}>
                <View style={[styles.statusDot, paused && styles.statusDotPaused]} />
                <Text style={styles.previewStatusText}>{paused ? "Paused" : "Live"}</Text>
              </View>
            </View>
          )}

          <View style={styles.divider} testID="workspace-divider">
            <View style={styles.dividerHandle} />
          </View>

          <View style={styles.editorArea}>
            {hasEditorMessage && (
              <View style={styles.messageStack}>
                {sketch.metadataWarning !== null && (
                  <Text style={styles.metadataWarning}>{sketch.metadataWarning}</Text>
                )}
                {showingLastWorking && !collapsed && (
                  <Text style={styles.staleBadge}>Showing the last version that compiled</Text>
                )}
                {sourceSaveError !== null && (
                  <Text style={styles.saveError}>{sourceSaveError}</Text>
                )}
                {metadataSaveError !== null && (
                  <Text style={styles.saveError}>{metadataSaveError}</Text>
                )}
              </View>
            )}

            <GlslInput
              errors={errors}
              initialValue={sketch.source}
              key={sketch.id}
              onChange={handleSourceChange}
            />

            {parametersOpen && (
              <View style={styles.parametersOverlay}>
                <ShaderParametersPanel
                  onChange={handleParametersChange}
                  onClose={() => setParametersOpen(false)}
                  parameters={sketch.metadata.parameters}
                />
              </View>
            )}
          </View>
        </View>

        <BottomNavigation activeItem="editor" />

        <ShaderFileDrawer
          activeSketchId={sketch.id}
          onClose={() => setDrawerOpen(false)}
          onCreate={() => void createSketch()}
          onDelete={(id) => void deleteSketch(id)}
          onRename={(id, title) => void renameSketch(id, title)}
          onSelect={(id) => void openSketch(id)}
          sketches={sketches}
          visible={drawerOpen}
        />
      </View>
    </SafeAreaView>
  );
}

function HeaderAction({
  active = false,
  fallback,
  label,
  name,
  onPress,
  testID,
}: {
  active?: boolean;
  fallback: string;
  label: string;
  name: SymbolViewProps["name"];
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerAction,
        active && styles.headerActionActive,
        pressed && styles.headerActionPressed,
      ]}
      testID={testID}
    >
      <AppIcon
        color={active ? Colors.acidGreen : Colors.textMuted}
        fallback={fallback}
        name={name}
        size={21}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: Colors.background,
    flex: 1,
  },
  appFrame: {
    alignSelf: "center",
    backgroundColor: Colors.background,
    flex: 1,
    maxWidth: 520,
    width: "100%",
  },
  header: {
    alignItems: "center",
    borderBottomColor: Colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 64,
    paddingHorizontal: Spacing.md,
  },
  fileIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: Spacing.sm,
    minWidth: 0,
  },
  title: {
    color: Colors.acidGreen,
    flex: 1,
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  headerAction: {
    alignItems: "center",
    borderRadius: Radius.round,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  headerActionActive: {
    backgroundColor: "rgba(204, 243, 129, 0.10)",
  },
  headerActionPressed: {
    backgroundColor: Colors.surfaceHigh,
  },
  workspace: {
    flex: 1,
    minHeight: 0,
  },
  preview: {
    backgroundColor: Colors.surfaceLowest,
    height: PREVIEW_HEIGHT,
    overflow: "hidden",
    position: "relative",
  },
  previewStatus: {
    alignItems: "center",
    backgroundColor: "rgba(14, 14, 16, 0.78)",
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: Spacing.sm,
    flexDirection: "row",
    gap: Spacing.xs,
    left: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    position: "absolute",
  },
  previewStatusText: {
    color: Colors.acidGreen,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  statusDot: {
    backgroundColor: Colors.acidGreen,
    borderRadius: Radius.round,
    height: 6,
    width: 6,
  },
  statusDotPaused: {
    backgroundColor: Colors.electricBlue,
  },
  divider: {
    alignItems: "center",
    backgroundColor: Colors.surfaceHigh,
    borderBottomColor: Colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    height: 16,
    justifyContent: "center",
  },
  dividerHandle: {
    backgroundColor: Colors.textSubtle,
    borderRadius: Radius.round,
    height: 3,
    width: 44,
  },
  editorArea: {
    backgroundColor: Colors.surfaceLowest,
    flex: 1,
    minHeight: 0,
    position: "relative",
  },
  messageStack: {
    borderBottomColor: Colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metadataWarning: {
    color: Colors.electricBlue,
    fontSize: 11,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  staleBadge: {
    color: Colors.textMuted,
    fontSize: 11,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  saveError: {
    color: Colors.coral,
    fontSize: 11,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  parametersOverlay: {
    bottom: Spacing.sm,
    left: Spacing.md,
    maxHeight: "88%",
    position: "absolute",
    right: Spacing.md,
    zIndex: 20,
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
