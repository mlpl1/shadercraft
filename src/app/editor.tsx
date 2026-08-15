import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, BackHandler, PanResponder, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { usePreventRemove, type NavigationAction } from "expo-router/react-navigation";
import type { SymbolViewProps } from "expo-symbols";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../components/app-icon";
import { BottomNavigation } from "../components/bottom-navigation";
import { GlslInput } from "../components/glsl-input";
import { PreviewControls } from "../components/preview-controls";
import { ShaderFileDrawer } from "../components/shader-file-drawer";
import { clampPreviewHeight } from "./editor-layout";
import { loadPreviewMode, type PreviewMode } from "../data/preview-preferences";
import { ShaderParametersPanel } from "../components/shader-parameters-panel";
import { ShaderSandbox } from "../components/shader-sandbox";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useData } from "../context/data-context";
import type {
  ShaderParameterDefinition,
  SketchMetadata,
} from "../data/sketches/sketch-metadata";
import type { Sketch, SketchRepository } from "../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE, STARTER_SKETCH_TITLE } from "../data/sketches/starter-sketch";
import type { HostCompileResult } from "../shaders/shader-program-host";
import type { CompileError } from "../shaders/shader-source";

const COMPILE_DEBOUNCE_MS = 300;
const SOURCE_AUTOSAVE_DEBOUNCE_MS = 800;
const METADATA_AUTOSAVE_DEBOUNCE_MS = 500;
const PREVIEW_HEIGHT = 220;

type EditorScope = {
  profileId: string;
  repository: SketchRepository;
};

type LoadedEditor = {
  scope: EditorScope;
  sketch: Sketch;
  sketches: Sketch[];
};

type ScopedMessage = {
  message: string;
  scope: EditorScope;
};

type RequestToken = {
  requestId: number;
  scope: EditorScope;
};

type PendingSource = {
  revision: number;
  scope: EditorScope;
  sketchId: string;
  source: string;
};

type PendingMetadata = {
  metadata: SketchMetadata;
  revision: number;
  scope: EditorScope;
  sketchId: string;
};

export default function EditorScreen() {
  const navigation = useNavigation();
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
  const scopeRegistryRef = useRef(
    new WeakMap<SketchRepository, Map<string, EditorScope>>(),
  );
  const scope = useMemo<EditorScope | null>(() => {
    if (!sketchRepository || !profileId) return null;

    let repositoryScopes = scopeRegistryRef.current.get(sketchRepository);
    if (!repositoryScopes) {
      repositoryScopes = new Map();
      scopeRegistryRef.current.set(sketchRepository, repositoryScopes);
    }

    let stableScope = repositoryScopes.get(profileId);
    if (!stableScope) {
      stableScope = { profileId, repository: sketchRepository };
      repositoryScopes.set(profileId, stableScope);
    }
    return stableScope;
  }, [profileId, sketchRepository]);

  const [loadedEditor, setLoadedEditor] = useState<LoadedEditor | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { height: windowHeight } = useWindowDimensions();
  const [workspaceHeight, setWorkspaceHeight] = useState(0);
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("responsive");
  const previewModeChangedRef = useRef(false);
  useEffect(() => { void import("../data/preview-preferences").then(({ loadPreviewMode }) => loadPreviewMode().then((mode) => { if (!previewModeChangedRef.current) setPreviewMode(mode); })); }, []);
  const [previewHeight, setPreviewHeight] = useState(PREVIEW_HEIGHT);
  const displayedPreviewHeight = workspaceHeight > 0 && previewMode === "responsive" ? Math.max(120, workspaceHeight * 0.4) : previewMode === "square" && workspaceWidth > 0 ? workspaceWidth : previewMode === "wide" && workspaceWidth > 0 ? workspaceWidth * 0.5625 : previewHeight;
  const previewStartHeightRef = useRef(PREVIEW_HEIGHT);
  const previewWasDraggedRef = useRef(false);
  const dividerPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { previewWasDraggedRef.current = true; previewStartHeightRef.current = previewHeight; },
    onPanResponderMove: (_event, gesture) => {
      setPreviewHeight(clampPreviewHeight(previewStartHeightRef.current + gesture.dy, workspaceHeight || windowHeight));
    },
  }), [previewHeight, windowHeight, workspaceHeight]);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [compiledSource, setCompiledSource] = useState("");
  const [errors, setErrors] = useState<CompileError[]>([]);
  const [showingLastWorking, setShowingLastWorking] = useState(false);
  const [sourceSaveErrorState, setSourceSaveErrorState] = useState(
    () => new Map<EditorScope, string>(),
  );
  const [metadataSaveErrorState, setMetadataSaveErrorState] = useState(
    () => new Map<EditorScope, string>(),
  );
  const [loadErrorState, setLoadErrorState] = useState<ScopedMessage | null>(null);
  const [mutationErrorState, setMutationErrorState] = useState<ScopedMessage | null>(null);
  const [orderingRefreshErrorScope, setOrderingRefreshErrorScope] =
    useState<EditorScope | null>(null);
  const [loadBusyScope, setLoadBusyScope] = useState<EditorScope | null>(null);
  const [actionBusyScope, setActionBusyScope] = useState<EditorScope | null>(null);
  const [loadRetry, setLoadRetry] = useState(0);
  const [paused, setPaused] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [restartToken, setRestartToken] = useState(0);
  const [removalGuardActive, setRemovalGuardActive] = useState(false);
  const [capturedRemovalAction, setCapturedRemovalAction] =
    useState<NavigationAction | null>(null);
  const [readyRemovalAction, setReadyRemovalAction] = useState<NavigationAction | null>(null);
  const [libraryReturnScope, setLibraryReturnScope] = useState<EditorScope | null>(null);
  const [directBackScope, setDirectBackScope] = useState<EditorScope | null>(null);

  const activeEditor = loadedEditor?.scope === scope ? loadedEditor : null;
  const sketch = activeEditor?.sketch ?? null;
  const sketches = activeEditor?.sketches ?? [];
  const sourceSaveError = scope ? (sourceSaveErrorState.get(scope) ?? null) : null;
  const metadataSaveError = scope ? (metadataSaveErrorState.get(scope) ?? null) : null;
  const loadError = loadErrorState?.scope === scope ? loadErrorState.message : null;
  const mutationError =
    mutationErrorState?.scope === scope ? mutationErrorState.message : null;
  const orderingRefreshError =
    orderingRefreshErrorScope === scope
      ? "The change was saved, but the file list could not refresh."
      : null;
  const editorActionBusy = actionBusyScope === scope;
  const editorBusy = loadBusyScope === scope || editorActionBusy;

  const compileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceSaveTimersRef = useRef(
    new WeakMap<EditorScope, ReturnType<typeof setTimeout>>(),
  );
  const metadataSaveTimersRef = useRef(
    new WeakMap<EditorScope, ReturnType<typeof setTimeout>>(),
  );
  const pendingSourceRef = useRef(new WeakMap<EditorScope, PendingSource>());
  const pendingMetadataRef = useRef(new WeakMap<EditorScope, PendingMetadata>());
  const sourceRevisionRef = useRef(0);
  const metadataRevisionRef = useRef(0);
  const sourceSaveQueueRef = useRef(new WeakMap<EditorScope, Promise<boolean>>());
  const metadataSaveQueueRef = useRef(new WeakMap<EditorScope, Promise<boolean>>());
  const sourceSaveWorkRef = useRef(new WeakMap<EditorScope, number>());
  const metadataSaveWorkRef = useRef(new WeakMap<EditorScope, number>());
  const requestGenerationRef = useRef(0);
  const previousScopeRef = useRef(scope);
  const activeScopeRef = useRef(scope);
  const routeSketchIdRef = useRef(routeSketchId);
  const editorRef = useRef<LoadedEditor | null>(activeEditor);
  const sketchRef = useRef<Sketch | null>(sketch);
  const loadBusyRef = useRef<RequestToken | null>(null);
  const actionBusyRef = useRef<RequestToken | null>(null);
  const removalFlushRef = useRef<Promise<void> | null>(null);
  const capturedRemovalActionRef = useRef<NavigationAction | null>(null);
  const directBackRequestRef = useRef<EditorScope | null>(null);
  const mountedRef = useRef(true);

  if (previousScopeRef.current !== scope) {
    previousScopeRef.current = scope;
    requestGenerationRef.current += 1;
  }
  activeScopeRef.current = scope;
  routeSketchIdRef.current = routeSketchId;
  editorRef.current = activeEditor;
  sketchRef.current = sketch;

  const isScopeCurrent = useCallback(
    (targetScope: EditorScope) =>
      mountedRef.current && activeScopeRef.current === targetScope,
    [],
  );

  const isRequestCurrent = useCallback(
    (targetScope: EditorScope, requestId: number) =>
      mountedRef.current &&
      activeScopeRef.current === targetScope &&
      requestGenerationRef.current === requestId,
    [],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    setDrawerOpen(false);
    setParametersOpen(false);
    setRemovalGuardActive(false);
    setCapturedRemovalAction(null);
    setReadyRemovalAction(null);
    setDirectBackScope(null);
    capturedRemovalActionRef.current = null;
    removalFlushRef.current = null;
    directBackRequestRef.current = null;
  }, [scope]);

  const refreshSketches = useCallback(
    async (targetScope: EditorScope, requestId: number) => {
      const next = await targetScope.repository.list(targetScope.profileId);
      if (isRequestCurrent(targetScope, requestId)) {
        setLoadedEditor((current) =>
          current?.scope === targetScope ? { ...current, sketches: next } : current,
        );
        setOrderingRefreshErrorScope((errorScope) =>
          errorScope === targetScope ? null : errorScope,
        );
      }
      return next;
    },
    [isRequestCurrent],
  );

  const releaseRemovalGuardIfSaved = useCallback(
    (targetScope: EditorScope) => {
      if (
        isScopeCurrent(targetScope) &&
        !pendingSourceRef.current.has(targetScope) &&
        !pendingMetadataRef.current.has(targetScope) &&
        (sourceSaveWorkRef.current.get(targetScope) ?? 0) === 0 &&
        (metadataSaveWorkRef.current.get(targetScope) ?? 0) === 0
      ) {
        setRemovalGuardActive(false);
      }
    },
    [isScopeCurrent],
  );

  const flushSourceSave = useCallback(
    async (targetScope?: EditorScope | null): Promise<boolean> => {
      const flushScope = targetScope ?? activeScopeRef.current;
      if (!flushScope) return true;

      const saveTimer = sourceSaveTimersRef.current.get(flushScope);
      if (saveTimer) {
        clearTimeout(saveTimer);
        sourceSaveTimersRef.current.delete(flushScope);
      }

      while (true) {
        const pending = pendingSourceRef.current.get(flushScope) ?? null;
        if (pending) {
          pendingSourceRef.current.delete(flushScope);
          sourceSaveWorkRef.current.set(
            flushScope,
            (sourceSaveWorkRef.current.get(flushScope) ?? 0) + 1,
          );
          const requestId = requestGenerationRef.current;
          const previousWrite =
            sourceSaveQueueRef.current.get(flushScope) ?? Promise.resolve(true);

          const queuedWrite = previousWrite.then(async () => {
            try {
              await pending.scope.repository.updateSource(
                pending.scope.profileId,
                pending.sketchId,
                pending.source,
              );
              if (mountedRef.current) {
                setSourceSaveErrorState((current) => {
                  if (!current.has(pending.scope)) return current;
                  const next = new Map(current);
                  next.delete(pending.scope);
                  return next;
                });
              }
            } catch {
              const latest = pendingSourceRef.current.get(pending.scope);
              if (!latest || latest.revision <= pending.revision) {
                pendingSourceRef.current.set(pending.scope, pending);
              }
              if (mountedRef.current) {
                setSourceSaveErrorState((current) => {
                  const next = new Map(current);
                  next.set(pending.scope, "Could not save. Your code is still here.");
                  return next;
                });
              }
              return false;
            } finally {
              const remainingWork =
                (sourceSaveWorkRef.current.get(flushScope) ?? 1) - 1;
              if (remainingWork > 0) {
                sourceSaveWorkRef.current.set(flushScope, remainingWork);
              } else {
                sourceSaveWorkRef.current.delete(flushScope);
              }
              releaseRemovalGuardIfSaved(pending.scope);
            }

            if (isRequestCurrent(pending.scope, requestId)) {
              try {
                await refreshSketches(pending.scope, requestId);
              } catch {
                // The write succeeded. A later drawer action will try the ordering read again.
              }
            }
            return true;
          });

          sourceSaveQueueRef.current.set(flushScope, queuedWrite);
        }

        const queuedWrite = sourceSaveQueueRef.current.get(flushScope);
        if (!queuedWrite) return true;
        const saved = await queuedWrite;
        if (!saved) {
          if (
            sourceSaveQueueRef.current.get(flushScope) === queuedWrite &&
            !pendingSourceRef.current.has(flushScope) &&
            (sourceSaveWorkRef.current.get(flushScope) ?? 0) === 0
          ) {
            sourceSaveQueueRef.current.delete(flushScope);
          }
          return false;
        }
        if (
          !pendingSourceRef.current.has(flushScope) &&
          sourceSaveQueueRef.current.get(flushScope) === queuedWrite
        ) {
          return true;
        }
      }
    },
    [isRequestCurrent, isScopeCurrent, refreshSketches, releaseRemovalGuardIfSaved],
  );

  const flushMetadataSave = useCallback(
    async (targetScope?: EditorScope | null): Promise<boolean> => {
      const flushScope = targetScope ?? activeScopeRef.current;
      if (!flushScope) return true;

      const saveTimer = metadataSaveTimersRef.current.get(flushScope);
      if (saveTimer) {
        clearTimeout(saveTimer);
        metadataSaveTimersRef.current.delete(flushScope);
      }

      while (true) {
        const pending = pendingMetadataRef.current.get(flushScope) ?? null;
        if (pending) {
          pendingMetadataRef.current.delete(flushScope);
          metadataSaveWorkRef.current.set(
            flushScope,
            (metadataSaveWorkRef.current.get(flushScope) ?? 0) + 1,
          );
          const requestId = requestGenerationRef.current;
          const previousWrite =
            metadataSaveQueueRef.current.get(flushScope) ?? Promise.resolve(true);

          const queuedWrite = previousWrite.then(async () => {
            try {
              await pending.scope.repository.updateMetadata(
                pending.scope.profileId,
                pending.sketchId,
                pending.metadata,
              );
              if (mountedRef.current) {
                setMetadataSaveErrorState((current) => {
                  if (!current.has(pending.scope)) return current;
                  const next = new Map(current);
                  next.delete(pending.scope);
                  return next;
                });
              }
            } catch {
              const latest = pendingMetadataRef.current.get(pending.scope);
              if (!latest || latest.revision <= pending.revision) {
                pendingMetadataRef.current.set(pending.scope, pending);
              }
              if (mountedRef.current) {
                setMetadataSaveErrorState((current) => {
                  const next = new Map(current);
                  next.set(
                    pending.scope,
                    "Could not save parameters. Your values are still here.",
                  );
                  return next;
                });
              }
              return false;
            } finally {
              const remainingWork =
                (metadataSaveWorkRef.current.get(flushScope) ?? 1) - 1;
              if (remainingWork > 0) {
                metadataSaveWorkRef.current.set(flushScope, remainingWork);
              } else {
                metadataSaveWorkRef.current.delete(flushScope);
              }
              releaseRemovalGuardIfSaved(pending.scope);
            }

            if (isRequestCurrent(pending.scope, requestId)) {
              try {
                await refreshSketches(pending.scope, requestId);
              } catch {
                // The values are saved even if this ordering refresh could not complete.
              }
            }
            return true;
          });

          metadataSaveQueueRef.current.set(flushScope, queuedWrite);
        }

        const queuedWrite = metadataSaveQueueRef.current.get(flushScope);
        if (!queuedWrite) return true;
        const saved = await queuedWrite;
        if (!saved) {
          if (
            metadataSaveQueueRef.current.get(flushScope) === queuedWrite &&
            !pendingMetadataRef.current.has(flushScope) &&
            (metadataSaveWorkRef.current.get(flushScope) ?? 0) === 0
          ) {
            metadataSaveQueueRef.current.delete(flushScope);
          }
          return false;
        }
        if (
          !pendingMetadataRef.current.has(flushScope) &&
          metadataSaveQueueRef.current.get(flushScope) === queuedWrite
        ) {
          return true;
        }
      }
    },
    [isRequestCurrent, isScopeCurrent, refreshSketches, releaseRemovalGuardIfSaved],
  );

  const flushAllSaves = useCallback(
    async (targetScope?: EditorScope | null): Promise<boolean> => {
      const flushScope = targetScope ?? activeScopeRef.current;
      if (!flushScope) return true;

      while (true) {
        const sourceSaved = await flushSourceSave(flushScope);
        const metadataSaved = await flushMetadataSave(flushScope);
        if (!sourceSaved || !metadataSaved) return false;
        if (
          !pendingSourceRef.current.has(flushScope) &&
          !pendingMetadataRef.current.has(flushScope) &&
          (sourceSaveWorkRef.current.get(flushScope) ?? 0) === 0 &&
          (metadataSaveWorkRef.current.get(flushScope) ?? 0) === 0
        ) {
          return true;
        }
      }
    },
    [flushMetadataSave, flushSourceSave],
  );
  const restoreActiveRoute = useCallback(
    (targetScope: EditorScope) => {
      const current = editorRef.current;
      if (!isScopeCurrent(targetScope) || current?.scope !== targetScope) return;
      if (routeSketchIdRef.current === current.sketch.id) return;

      routeSketchIdRef.current = current.sketch.id;
      router.setParams({ sketchId: current.sketch.id });
    },
    [isScopeCurrent, router],
  );

  const activateSketch = useCallback(
    (
      targetScope: EditorScope,
      requestId: number,
      next: Sketch,
      nextSketches: Sketch[],
    ) => {
      if (!isRequestCurrent(targetScope, requestId)) return false;

      if (compileTimer.current) {
        clearTimeout(compileTimer.current);
        compileTimer.current = null;
      }
      const pendingSource = pendingSourceRef.current.get(targetScope);
      const pendingMetadata = pendingMetadataRef.current.get(targetScope);
      let activatedSketch = next;
      if (pendingSource?.sketchId === next.id) {
        activatedSketch = { ...activatedSketch, source: pendingSource.source };
      }
      if (pendingMetadata?.sketchId === next.id) {
        activatedSketch = { ...activatedSketch, metadata: pendingMetadata.metadata };
      }
      const activatedSketches = nextSketches.map((candidate) =>
        candidate.id === activatedSketch.id ? activatedSketch : candidate,
      );
      setRemovalGuardActive(Boolean(pendingSource || pendingMetadata));

      const snapshot = {
        scope: targetScope,
        sketch: activatedSketch,
        sketches: activatedSketches,
      };
      editorRef.current = snapshot;
      sketchRef.current = activatedSketch;
      setLoadedEditor(snapshot);
      setCompiledSource(activatedSketch.source);
      setErrors([]);
      setShowingLastWorking(false);
      if (!pendingSource) {
        setSourceSaveErrorState((current) => {
          if (!current.has(targetScope)) return current;
          const cleared = new Map(current);
          cleared.delete(targetScope);
          return cleared;
        });
      }
      if (!pendingMetadata) {
        setMetadataSaveErrorState((current) => {
          if (!current.has(targetScope)) return current;
          const cleared = new Map(current);
          cleared.delete(targetScope);
          return cleared;
        });
      }
      setLoadErrorState(null);
      setMutationErrorState(null);
      setParametersOpen(false);

      if (routeSketchIdRef.current !== next.id) {
        routeSketchIdRef.current = next.id;
        router.setParams({ sketchId: next.id });
      }
      return true;
    },
    [isRequestCurrent, router],
  );

  useEffect(() => {
    if (!scope) return;

    const current = editorRef.current;
    if (current?.scope === scope && routeSketchId && current.sketch.id === routeSketchId) {
      return;
    }

    const requestId = ++requestGenerationRef.current;
    const request = { requestId, scope };
    loadBusyRef.current = request;
    setLoadBusyScope(scope);
    setLoadErrorState(null);
    let cancelled = false;
    const currentRequest = () => !cancelled && isRequestCurrent(scope, requestId);

    void (async () => {
      try {
        if (current?.scope === scope) {
          const saved = await flushAllSaves();
          if (!currentRequest()) return;
          if (!saved) {
            restoreActiveRoute(scope);
            return;
          }
        }

        const existing = await scope.repository.list(scope.profileId);
        if (!currentRequest()) return;

        const requested = routeSketchId
          ? await scope.repository.get(scope.profileId, routeSketchId)
          : null;
        if (!currentRequest()) return;

        let opened = requested ?? existing[0] ?? null;
        let all = existing;
        if (!opened) {
          opened = await scope.repository.create(
            scope.profileId,
            STARTER_SKETCH_TITLE,
            STARTER_SKETCH_SOURCE,
          );
          if (!currentRequest()) return;
          all = await scope.repository.list(scope.profileId);
          if (!currentRequest()) return;
        }

        if (current?.scope === scope) {
          const saved = await flushAllSaves();
          if (!currentRequest()) return;
          if (!saved) {
            restoreActiveRoute(scope);
            return;
          }
        }
        const activated = activateSketch(scope, requestId, opened, all);
        if (
          activated &&
          (pendingSourceRef.current.has(scope) ||
            pendingMetadataRef.current.has(scope))
        ) {
          void flushAllSaves(scope);
        }
      } catch {
        if (currentRequest()) {
          setLoadErrorState({ message: "Could not load the editor. Try again.", scope });
          restoreActiveRoute(scope);
        }
      } finally {
        if (loadBusyRef.current === request) {
          loadBusyRef.current = null;
          setLoadBusyScope((busyScope) => (busyScope === scope ? null : busyScope));
        }
      }
    })();

    return () => {
      cancelled = true;
      if (requestGenerationRef.current === requestId) requestGenerationRef.current += 1;
    };
  }, [
    activateSketch,
    flushAllSaves,
    isRequestCurrent,
    loadRetry,
    restoreActiveRoute,
    routeSketchId,
    scope,
  ]);

  useEffect(
    () => () => {
      if (compileTimer.current) clearTimeout(compileTimer.current);
      void flushAllSaves(scope);
    },
    [flushAllSaves, scope],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState !== "inactive" && nextAppState !== "background") return;

      void flushAllSaves()
        .then((saved) => {
          if (!saved) {
            console.warn(
              "Could not finish saving editor changes while the app is in the background.",
            );
          }
        })
        .catch(() => {
          console.warn(
            "Could not finish saving editor changes while the app is in the background.",
          );
        });
    });

    return () => subscription.remove();
  }, [flushAllSaves]);

  const leaveDirectEntry = useCallback(() => {
    const targetScope = activeScopeRef.current;
    if (!targetScope || directBackRequestRef.current) return;

    directBackRequestRef.current = targetScope;
    setParametersOpen(false);
    setDrawerOpen(false);
    setDirectBackScope(targetScope);
  }, []);

  useEffect(() => {
    if (!directBackScope) return;
    if (!isScopeCurrent(directBackScope)) {
      if (directBackRequestRef.current === directBackScope) {
        directBackRequestRef.current = null;
      }
      setDirectBackScope(null);
      return;
    }
    if (parametersOpen || drawerOpen) return;

    setDirectBackScope(null);
    void (async () => {
      try {
        if (
          !(await flushAllSaves(directBackScope)) ||
          !isScopeCurrent(directBackScope)
        ) {
          return;
        }
        router.replace("/library");
      } finally {
        if (directBackRequestRef.current === directBackScope) {
          directBackRequestRef.current = null;
        }
      }
    })();
  }, [
    directBackScope,
    drawerOpen,
    flushAllSaves,
    isScopeCurrent,
    parametersOpen,
    router,
  ]);
  const handleEditorBack = useCallback(() => {
    if (editorActionBusy) return;
    if (!router.canGoBack()) {
      leaveDirectEntry();
      return;
    }
    router.back();
  }, [editorActionBusy, leaveDirectEntry, router]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (parametersOpen) {
        setParametersOpen(false);
        return true;
      }
      if (drawerOpen) {
        if (!editorActionBusy) setDrawerOpen(false);
        return true;
      }
      if (!router.canGoBack()) {
        leaveDirectEntry();
        return true;
      }
      return false;
    });

    return () => subscription.remove();
  }, [drawerOpen, editorActionBusy, leaveDirectEntry, parametersOpen, router]);

  usePreventRemove(removalGuardActive || drawerOpen || parametersOpen, ({ data: { action } }) => {
    if (
      editorActionBusy ||
      capturedRemovalActionRef.current ||
      removalFlushRef.current
    ) {
      return;
    }

    capturedRemovalActionRef.current = action;
    setCapturedRemovalAction(action);
    setParametersOpen(false);
    setDrawerOpen(false);
  });

  useEffect(() => {
    if (
      drawerOpen ||
      parametersOpen ||
      !capturedRemovalAction ||
      removalFlushRef.current
    ) {
      return;
    }

    const action = capturedRemovalAction;
    const removalFlush = (async () => {
      let actionReady = false;
      try {
        if (!(await flushAllSaves()) || !mountedRef.current) return;
        actionReady = true;
        setRemovalGuardActive(false);
        setReadyRemovalAction(action);
      } finally {
        removalFlushRef.current = null;
        capturedRemovalActionRef.current = null;
        setCapturedRemovalAction(null);
        if (!actionReady) setReadyRemovalAction(null);
      }
    })();
    removalFlushRef.current = removalFlush;
  }, [capturedRemovalAction, drawerOpen, flushAllSaves, parametersOpen]);

  useEffect(() => {
    if (
      removalGuardActive ||
      drawerOpen ||
      parametersOpen ||
      !readyRemovalAction
    ) {
      return;
    }

    const action = readyRemovalAction;
    setReadyRemovalAction(null);
    navigation.dispatch(action);
  }, [drawerOpen, navigation, parametersOpen, readyRemovalAction, removalGuardActive]);

  useEffect(() => {
    if (!libraryReturnScope) return;
    if (!isScopeCurrent(libraryReturnScope)) {
      setLibraryReturnScope(null);
      return;
    }
    if (drawerOpen || parametersOpen) return;

    setLibraryReturnScope(null);
    router.replace("/library");
  }, [drawerOpen, isScopeCurrent, libraryReturnScope, parametersOpen, router]);

  const handleSourceChange = useCallback(
    (next: string) => {
      const current = editorRef.current;
      if (!current || !isScopeCurrent(current.scope)) return;

      setRemovalGuardActive(true);
      sourceRevisionRef.current += 1;
      pendingSourceRef.current.set(current.scope, {
        revision: sourceRevisionRef.current,
        scope: current.scope,
        sketchId: current.sketch.id,
        source: next,
      });

      if (compileTimer.current) clearTimeout(compileTimer.current);
      compileTimer.current = setTimeout(() => {
        compileTimer.current = null;
        if (isScopeCurrent(current.scope)) setCompiledSource(next);
      }, COMPILE_DEBOUNCE_MS);

      const previousSaveTimer = sourceSaveTimersRef.current.get(current.scope);
      if (previousSaveTimer) clearTimeout(previousSaveTimer);
      const saveTimer = setTimeout(() => {
        sourceSaveTimersRef.current.delete(current.scope);
        void flushSourceSave(current.scope);
      }, SOURCE_AUTOSAVE_DEBOUNCE_MS);
      sourceSaveTimersRef.current.set(current.scope, saveTimer);
    },
    [flushSourceSave, isScopeCurrent],
  );

  const handleParametersChange = useCallback(
    (parameters: ShaderParameterDefinition[]) => {
      const current = editorRef.current;
      if (!current || !isScopeCurrent(current.scope)) return;

      const metadata: SketchMetadata = { ...current.sketch.metadata, parameters };
      const nextSketch = { ...current.sketch, metadata };
      const nextEditor = {
        ...current,
        sketch: nextSketch,
        sketches: current.sketches.map((item) =>
          item.id === nextSketch.id ? { ...item, metadata } : item,
        ),
      };
      editorRef.current = nextEditor;
      sketchRef.current = nextSketch;
      setLoadedEditor(nextEditor);
      setRemovalGuardActive(true);
      metadataRevisionRef.current += 1;
      pendingMetadataRef.current.set(current.scope, {
        metadata,
        revision: metadataRevisionRef.current,
        scope: current.scope,
        sketchId: nextSketch.id,
      });

      const previousSaveTimer = metadataSaveTimersRef.current.get(current.scope);
      if (previousSaveTimer) clearTimeout(previousSaveTimer);
      const saveTimer = setTimeout(() => {
        metadataSaveTimersRef.current.delete(current.scope);
        void flushMetadataSave(current.scope);
      }, METADATA_AUTOSAVE_DEBOUNCE_MS);
      metadataSaveTimersRef.current.set(current.scope, saveTimer);
    },
    [flushMetadataSave, isScopeCurrent],
  );

  const refreshAfterMutation = useCallback(
    async (
      targetScope: EditorScope,
      requestId: number,
      localFallback: Sketch[],
    ): Promise<Sketch[] | null> => {
      try {
        const refreshed = await targetScope.repository.list(targetScope.profileId);
        if (!isRequestCurrent(targetScope, requestId)) return null;
        setOrderingRefreshErrorScope((errorScope) =>
          errorScope === targetScope ? null : errorScope,
        );
        return refreshed;
      } catch {
        if (!isRequestCurrent(targetScope, requestId)) return null;
        setOrderingRefreshErrorScope(targetScope);
        return localFallback;
      }
    },
    [isRequestCurrent],
  );

  const runEditorAction = useCallback(
    async (
      targetScope: EditorScope,
      errorMessage: string,
      operation: (requestId: number) => Promise<void>,
    ) => {
      if (
        !isScopeCurrent(targetScope) ||
        actionBusyRef.current?.scope === targetScope ||
        loadBusyRef.current?.scope === targetScope
      ) {
        return;
      }

      const requestId = ++requestGenerationRef.current;
      const request = { requestId, scope: targetScope };
      actionBusyRef.current = request;
      setActionBusyScope(targetScope);
      setMutationErrorState(null);

      try {
        await operation(requestId);
      } catch {
        if (isRequestCurrent(targetScope, requestId)) {
          setMutationErrorState({ message: errorMessage, scope: targetScope });
        }
      } finally {
        if (actionBusyRef.current === request) {
          actionBusyRef.current = null;
          setActionBusyScope((busyScope) => (busyScope === targetScope ? null : busyScope));
        }
      }
    },
    [isRequestCurrent, isScopeCurrent],
  );

  const openSketch = useCallback(
    async (id: string) => {
      if (!scope) return;

      await runEditorAction(
        scope,
        "Could not open that shader. Your current shader is unchanged.",
        async (requestId) => {
          if (!(await flushAllSaves()) || !isRequestCurrent(scope, requestId)) return;

          const next = await scope.repository.get(scope.profileId, id);
          if (!isRequestCurrent(scope, requestId)) return;
          if (!next) throw new Error("Sketch not found");

          const all = await scope.repository.list(scope.profileId);
          if (!isRequestCurrent(scope, requestId)) return;
          if (!(await flushAllSaves()) || !isRequestCurrent(scope, requestId)) return;

          if (activateSketch(scope, requestId, next, all)) setDrawerOpen(false);
        },
      );
    },
    [activateSketch, flushAllSaves, isRequestCurrent, runEditorAction, scope],
  );

  const createSketch = useCallback(async () => {
    if (!scope) return;

    await runEditorAction(
      scope,
      "Could not create a shader. Your current shader is unchanged.",
      async (requestId) => {
        if (!(await flushAllSaves(scope)) || !isRequestCurrent(scope, requestId)) return;

        const current = editorRef.current;
        if (current?.scope !== scope) return;
        const created = await scope.repository.create(
          scope.profileId,
          STARTER_SKETCH_TITLE,
          STARTER_SKETCH_SOURCE,
        );
        if (!isRequestCurrent(scope, requestId)) return;

        const localFallback = [
          created,
          ...current.sketches.filter((item) => item.id !== created.id),
        ];
        const refreshed = await refreshAfterMutation(
          scope,
          requestId,
          localFallback,
        );
        if (!refreshed || !isRequestCurrent(scope, requestId)) return;
        const all = refreshed.some((item) => item.id === created.id)
          ? refreshed.map((item) => (item.id === created.id ? created : item))
          : [created, ...refreshed];

        if (activateSketch(scope, requestId, created, all)) setDrawerOpen(false);
      },
    );
  }, [
    activateSketch,
    flushAllSaves,
    isRequestCurrent,
    refreshAfterMutation,
    runEditorAction,
    scope,
  ]);

  const renameSketch = useCallback(
    async (id: string, title: string) => {
      if (!scope) return;

      await runEditorAction(
        scope,
        "Could not rename that shader. Its current title is unchanged.",
        async (requestId) => {
          if (!(await flushAllSaves(scope)) || !isRequestCurrent(scope, requestId)) return;

          await scope.repository.rename(scope.profileId, id, title);
          if (!isRequestCurrent(scope, requestId)) return;

          const current = editorRef.current;
          if (current?.scope !== scope) return;
          const localFallback = current.sketches.map((item) =>
            item.id === id ? { ...item, title } : item,
          );
          const refreshed = await refreshAfterMutation(
            scope,
            requestId,
            localFallback,
          );
          if (!refreshed || !isRequestCurrent(scope, requestId)) return;

          const nextSketch =
            current.sketch.id === id ? { ...current.sketch, title } : current.sketch;
          const nextEditor = {
            scope,
            sketch: nextSketch,
            sketches: refreshed.map((item) =>
              item.id === id ? { ...item, title } : item,
            ),
          };
          editorRef.current = nextEditor;
          sketchRef.current = nextSketch;
          setLoadedEditor(nextEditor);
        },
      );
    },
    [
      flushAllSaves,
      isRequestCurrent,
      refreshAfterMutation,
      runEditorAction,
      scope,
    ],
  );

  const deleteSketch = useCallback(
    async (id: string) => {
      if (!scope) return;

      await runEditorAction(
        scope,
        "Could not delete that shader. Your current shader is unchanged.",
        async (requestId) => {
          if (!(await flushAllSaves(scope)) || !isRequestCurrent(scope, requestId)) return;

          await scope.repository.delete(scope.profileId, id);
          if (!isRequestCurrent(scope, requestId)) return;

          const current = editorRef.current;
          if (current?.scope !== scope) return;
          const localRemaining = current.sketches.filter((item) => item.id !== id);
          const refreshed = await refreshAfterMutation(
            scope,
            requestId,
            localRemaining,
          );
          if (!refreshed || !isRequestCurrent(scope, requestId)) return;
          const remaining = refreshed.filter((item) => item.id !== id);

          if (current.sketch.id !== id) {
            const nextEditor = { ...current, sketches: remaining };
            editorRef.current = nextEditor;
            setLoadedEditor(nextEditor);
            return;
          }

          if (remaining[0]) {
            if (activateSketch(scope, requestId, remaining[0], remaining)) {
              setDrawerOpen(false);
            }
            return;
          }

          editorRef.current = null;
          sketchRef.current = null;
          setLoadedEditor(null);
          setDrawerOpen(false);
          setParametersOpen(false);
          setLibraryReturnScope(scope);
        },
      );
    },
    [
      activateSketch,
      flushAllSaves,
      isRequestCurrent,
      refreshAfterMutation,
      runEditorAction,
      scope,
    ],
  );

  const retryOrderingRefresh = useCallback(async () => {
    if (!scope || orderingRefreshErrorScope !== scope) return;

    await runEditorAction(
      scope,
      "Could not refresh the file list. Try again.",
      async (requestId) => {
        const refreshed = await scope.repository.list(scope.profileId);
        if (!isRequestCurrent(scope, requestId)) return;

        const current = editorRef.current;
        if (current?.scope !== scope) return;
        const nextEditor = { ...current, sketches: refreshed };
        editorRef.current = nextEditor;
        setLoadedEditor(nextEditor);
        setOrderingRefreshErrorScope((errorScope) =>
          errorScope === scope ? null : errorScope,
        );
      },
    );
  }, [
    isRequestCurrent,
    orderingRefreshErrorScope,
    runEditorAction,
    scope,
  ]);
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
          {loadError ? (
            <>
              <Text accessibilityRole="alert" style={styles.loadingError}>
                {loadError}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setLoadRetry((retry) => retry + 1)}
                style={styles.retryButton}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.loadingText}>Opening editor…</Text>
          )}
        </View>
        <BottomNavigation activeItem="editor" onBeforeNavigate={flushAllSaves} />
      </SafeAreaView>
    );
  }
  const hasEditorMessage =
    showingLastWorking ||
    sourceSaveError !== null ||
    metadataSaveError !== null ||
    loadError !== null ||
    mutationError !== null ||
    orderingRefreshError !== null ||
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

        <View onLayout={(event) => { const { height, width } = event.nativeEvent.layout; setWorkspaceHeight(height); setWorkspaceWidth(width); if (!previewWasDraggedRef.current && previewMode === "responsive") setPreviewHeight(clampPreviewHeight(height * 0.4, height)); }} style={styles.workspace}>
          {!collapsed && (
            <View style={[styles.preview, { height: displayedPreviewHeight }]} testID="preview-workspace">
              <ShaderSandbox
                height={displayedPreviewHeight}
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

          <View style={styles.divider} testID="workspace-divider" {...dividerPanResponder.panHandlers}>
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
                {loadError !== null && <Text style={styles.saveError}>{loadError}</Text>}
                {mutationError !== null && (
                  <Text accessibilityRole="alert" style={styles.saveError}>
                    {mutationError}
                  </Text>
                )}
                {orderingRefreshError !== null && (
                  <View>
                    <Text accessibilityRole="alert" style={styles.saveError}>
                      {orderingRefreshError}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={editorBusy}
                      onPress={() => void retryOrderingRefresh()}
                      style={({ pressed }) => [
                        styles.orderingRetryButton,
                        pressed && styles.headerActionPressed,
                      ]}
                    >
                      <Text style={styles.orderingRetryButtonText}>Retry file order</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            )}

            <GlslInput
              editable={!editorActionBusy}
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

        <BottomNavigation activeItem="editor" onBeforeNavigate={flushAllSaves} />

        <ShaderFileDrawer
          activeSketchId={sketch.id}
          busy={editorBusy}
          onClose={() => !editorActionBusy && setDrawerOpen(false)}
          onCreate={() => void createSketch()}
          onDelete={(id) => void deleteSketch(id)}
          onRename={(id, title) => void renameSketch(id, title)}
          onSelect={(id) => void openSketch(id)}
          sketches={sketches}
          visible={drawerOpen}
          previewMode={previewMode}
          onPreviewModeChange={(mode) => { previewModeChangedRef.current = true; setPreviewMode(mode); void import("../data/preview-preferences").then(({ savePreviewMode }) => savePreviewMode(mode)); }}
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
    flexShrink: 0,
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
  orderingRetryButton: {
    alignSelf: "flex-start",
    borderColor: Colors.electricBlue,
    borderRadius: Radius.sm,
    borderWidth: 1,
    marginBottom: Spacing.xs,
    marginHorizontal: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  orderingRetryButtonText: {
    color: Colors.electricBlue,
    fontSize: 11,
    fontWeight: "700",
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
    gap: Spacing.md,
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  loadingError: {
    color: Colors.coral,
    fontSize: 14,
    textAlign: "center",
  },
  retryButton: {
    borderColor: Colors.electricBlue,
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  retryButtonText: {
    color: Colors.electricBlue,
    fontSize: 13,
    fontWeight: "700",
  },
  loadingText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
});
