import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewToken,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { ShaderLibraryCard } from "../components/shader-library-card";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useData } from "../context/data-context";
import type { Sketch, SketchRepository } from "../data/sketches/sketch-repository";
import { STARTER_SKETCH_SOURCE, STARTER_SKETCH_TITLE } from "../data/sketches/starter-sketch";

const ALL_CATEGORY = "All";
const NEW_SKETCH_TITLE = "Untitled shader";

type LibraryScope = {
  profileId: string;
  repository: SketchRepository;
};

type LoadedSketches = {
  scope: LibraryScope;
  items: Sketch[];
};

export default function LibraryScreen() {
  const router = useRouter();
  const data = useData();
  const { profileId } = useAuth();
  const sketchRepository = data.status === "ready" ? data.sketchRepository : null;
  const scope = useMemo<LibraryScope | null>(
    () =>
      sketchRepository && profileId
        ? { profileId, repository: sketchRepository }
        : null,
    [profileId, sketchRepository],
  );
  const activeScopeRef = useRef(scope);
  activeScopeRef.current = scope;
  const loadRequestRef = useRef(0);
  const createRequestRef = useRef(0);
  const isFocusedRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);

  const [loadedSketches, setLoadedSketches] = useState<LoadedSketches | null>(null);
  const sketches = loadedSketches?.scope === scope ? loadedSketches.items : [];
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(ALL_CATEGORY);
  const [visibleSketchIds, setVisibleSketchIds] = useState<ReadonlySet<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!scope) return;

    const requestId = ++loadRequestRef.current;
    let cancelled = false;
    const isCurrent = () =>
      !cancelled &&
      isFocusedRef.current &&
      activeScopeRef.current === scope &&
      loadRequestRef.current === requestId;

    setLoadError(null);
    setIsLoading(true);

    void (async () => {
      try {
        const existing = await scope.repository.list(scope.profileId);
        if (existing.length === 0 && isCurrent()) {
          await scope.repository.create(
            scope.profileId,
            STARTER_SKETCH_TITLE,
            STARTER_SKETCH_SOURCE,
          );
        }

        const nextSketches =
          existing.length === 0
            ? await scope.repository.list(scope.profileId)
            : existing;
        if (isCurrent()) setLoadedSketches({ scope, items: nextSketches });
      } catch {
        if (isCurrent()) setLoadError("Could not load your shaders.");
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [scope]);

  const handleFocus = useCallback(() => {
    isFocusedRef.current = true;
    setIsFocused(true);
    const cleanupReload = reload();

    return () => {
      isFocusedRef.current = false;
      setIsFocused(false);
      loadRequestRef.current += 1;
      createRequestRef.current += 1;
      cleanupReload?.();
    };
  }, [reload]);

  useFocusEffect(handleFocus);

  useEffect(() => {
    setVisibleSketchIds(new Set());
    setQuery("");
    setSelectedCategory(ALL_CATEGORY);
    setLoadError(null);
    setCreateError(null);
    setIsLoading(true);
    setIsCreating(false);
  }, [scope]);

  const categories = useMemo(() => {
    const distinct = new Set(
      sketches
        .map((sketch) => sketch.metadata.category)
        .filter((category) => category !== ALL_CATEGORY),
    );
    return [ALL_CATEGORY, ...distinct];
  }, [sketches]);

  const filteredSketches = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return sketches.filter(
      (sketch) =>
        (selectedCategory === ALL_CATEGORY || sketch.metadata.category === selectedCategory) &&
        (normalizedQuery.length === 0 ||
          sketch.title.toLocaleLowerCase().includes(normalizedQuery)),
    );
  }, [query, selectedCategory, sketches]);

  const openSketch = useCallback(
    (sketchId: string) => {
      router.push({ pathname: "/editor", params: { sketchId } });
    },
    [router],
  );

  const createSketch = useCallback(async () => {
    if (!scope || isCreating) return;

    const requestId = ++createRequestRef.current;
    const isCurrent = () =>
      isFocusedRef.current &&
      activeScopeRef.current === scope &&
      createRequestRef.current === requestId;

    setCreateError(null);
    setIsCreating(true);
    try {
      const created = await scope.repository.create(
        scope.profileId,
        NEW_SKETCH_TITLE,
        STARTER_SKETCH_SOURCE,
      );
      if (isCurrent()) openSketch(created.id);
    } catch {
      if (isCurrent()) setCreateError("Could not create a shader. Try again.");
    } finally {
      if (isCurrent()) setIsCreating(false);
    }
  }, [isCreating, openSketch, scope]);

  const clearFilters = useCallback(() => {
    setQuery("");
    setSelectedCategory(ALL_CATEGORY);
  }, []);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<ViewToken<Sketch>> }) => {
      setVisibleSketchIds(
        new Set(
          viewableItems
            .filter((token) => token.isViewable)
            .map((token) => token.item.id),
        ),
      );
    },
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 20 }).current;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.appFrame}>
        <View style={styles.header}>
          <Text style={styles.terminalMark}>&gt;_</Text>
          <Text style={styles.wordmark}>MY_SHADERS</Text>
        </View>

        <View style={styles.actions}>
          <View style={styles.searchShell}>
            <Text pointerEvents="none" style={styles.searchIcon}>
              /
            </Text>
            <TextInput
              accessibilityLabel="Search shaders"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Search .frag files..."
              placeholderTextColor={Colors.textSubtle}
              selectionColor={Colors.electricBlue}
              style={styles.searchInput}
              value={query}
            />
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={isCreating || !sketchRepository || !profileId}
            onPress={() => void createSketch()}
            style={({ pressed }) => [
              styles.newButton,
              (pressed || isCreating) && styles.newButtonPressed,
            ]}
          >
            <Text style={styles.newButtonText}>{isCreating ? "Creating..." : "+  New Shader"}</Text>
          </Pressable>
          {createError ? <Text style={styles.actionError}>{createError}</Text> : null}
        </View>

        <ScrollView
          contentContainerStyle={styles.categoryContent}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categories}
        >
          {categories.map((category) => {
            const selected = category === selectedCategory;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={category}
                onPress={() => setSelectedCategory(category)}
                style={({ pressed }) => [
                  styles.categoryChip,
                  selected && styles.selectedCategoryChip,
                  pressed && styles.categoryChipPressed,
                ]}
              >
                <Text style={[styles.categoryLabel, selected && styles.selectedCategoryLabel]}>
                  {category}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {loadError && sketches.length > 0 ? (
          <View style={styles.refreshError}>
            <Text style={styles.refreshErrorText}>{loadError}</Text>
            <Pressable accessibilityRole="button" onPress={() => reload()}>
              <Text style={styles.refreshRetry}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        <FlatList
          contentContainerStyle={[
            styles.listContent,
            filteredSketches.length === 0 && styles.emptyListContent,
          ]}
          data={filteredSketches}
          extraData={isFocused ? visibleSketchIds : null}
          initialNumToRender={3}
          keyExtractor={(sketch) => sketch.id}
          keyboardShouldPersistTaps="handled"
          maxToRenderPerBatch={3}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              {isLoading ? (
                <Text style={styles.emptyBody}>Loading shaders...</Text>
              ) : loadError ? (
                <>
                  <Text style={styles.emptyTitle}>{loadError}</Text>
                  <Pressable accessibilityRole="button" onPress={() => reload()} style={styles.resetButton}>
                    <Text style={styles.resetButtonText}>Retry</Text>
                  </Pressable>
                </>
              ) : sketches.length === 0 ? (
                <Text style={styles.emptyBody}>Preparing your first shader...</Text>
              ) : (
                <>
                  <Text style={styles.emptyTitle}>No shaders match</Text>
                  <Text style={styles.emptyBody}>Try another title or category.</Text>
                  <Pressable accessibilityRole="button" onPress={clearFilters} style={styles.resetButton}>
                    <Text style={styles.resetButtonText}>Clear filters</Text>
                  </Pressable>
                </>
              )}
            </View>
          }
          onViewableItemsChanged={onViewableItemsChanged}
          overScrollMode="never"
          renderItem={({ item }) => (
            <ShaderLibraryCard
              active={isFocused && visibleSketchIds.has(item.id)}
              onPress={() => openSketch(item.id)}
              sketch={item}
            />
          )}
          showsVerticalScrollIndicator={false}
          updateCellsBatchingPeriod={50}
          viewabilityConfig={viewabilityConfig}
          windowSize={5}
        />

        <BottomNavigation activeItem="editor" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  appFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: Colors.background,
  },
  header: {
    minHeight: 64,
    paddingHorizontal: Spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  terminalMark: {
    color: Colors.acidGreen,
    fontFamily: "monospace",
    fontSize: 17,
    fontWeight: "900",
  },
  wordmark: {
    color: Colors.acidGreen,
    fontFamily: "monospace",
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  actions: {
    paddingTop: Spacing.xxl,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  searchShell: {
    position: "relative",
  },
  searchIcon: {
    position: "absolute",
    zIndex: 1,
    left: Spacing.md,
    top: 12,
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 17,
    fontWeight: "900",
  },
  searchInput: {
    minHeight: 44,
    paddingVertical: Spacing.sm,
    paddingLeft: 36,
    paddingRight: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceLowest,
    color: Colors.text,
    fontFamily: "monospace",
    fontSize: 13,
  },
  newButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    backgroundColor: Colors.acidGreen,
  },
  newButtonPressed: {
    opacity: 0.76,
  },
  newButtonText: {
    color: Colors.surfaceLowest,
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "900",
  },
  actionError: {
    color: Colors.coral,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
  },
  refreshError: {
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.md,
  },
  refreshErrorText: {
    flex: 1,
    color: Colors.coral,
    fontSize: 12,
  },
  refreshRetry: {
    color: Colors.electricBlue,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
  },
  categories: {
    flexGrow: 0,
    marginTop: Spacing.xl,
  },
  categoryContent: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  categoryChip: {
    minHeight: 34,
    paddingHorizontal: Spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.round,
    backgroundColor: Colors.surfaceLowest,
  },
  selectedCategoryChip: {
    borderColor: Colors.acidGreen,
    backgroundColor: "rgba(204,243,129,0.12)",
  },
  categoryChipPressed: {
    opacity: 0.72,
  },
  categoryLabel: {
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  selectedCategoryLabel: {
    color: Colors.acidGreen,
  },
  listContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxxl,
    gap: Spacing.lg,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyBody: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  resetButton: {
    marginTop: Spacing.sm,
    minHeight: 40,
    paddingHorizontal: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.electricBlue,
    borderRadius: Radius.sm,
  },
  resetButtonText: {
    color: Colors.electricBlue,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
  },
});
