import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "./app-icon";
import { LessonCompletionSheet } from "./lesson-completion-sheet";
import { LessonStageBlock } from "./lesson-stage-block";
import { computeStageVisibility, type StageBounds } from "./lesson-stage-visibility";
import { Colors, Radius, Spacing } from "../constants/theme";
import type { CourseLesson } from "../data/course/types";

export type LessonWorkspaceProps = {
  lesson: CourseLesson;
  moduleTitle: string;
  /** 1-based curriculum position of the lesson's module, shown as the zero-padded header numeral. */
  modulePosition: number;
  lessonIndex: number;
  lessonCount: number;
  completed: boolean;
  hydrated: boolean;
  progressPercent: number;
  onComplete(): Promise<void>;
  onUndo(): Promise<void>;
  onBack(): void;
  onNext(): void;
};

type FailedAction = "complete" | "undo";

type WorkspaceState = {
  /** The lesson the rest of this state belongs to, so switching lesson starts fresh. */
  lessonId: string;
  failedAction: FailedAction | null;
  isCompletionVisible: boolean;
};

function freshState(lesson: CourseLesson): WorkspaceState {
  return {
    failedAction: null,
    isCompletionVisible: false,
    lessonId: lesson.id,
  };
}

type StageVisibilityState = {
  /** The lesson this mount/visibility state was computed for, so switching lesson starts fresh. */
  lessonId: string;
  /**
   * Which blocks have a mounted preview, and which are on screen. `mounted` is one-way: a block
   * that scrolls out keeps its context and only loses its render loop, so scrolling back is free.
   */
  mounted: boolean[];
  visible: boolean[];
};

function freshVisibility(lesson: CourseLesson, stageCount: number): StageVisibilityState {
  return {
    lessonId: lesson.id,
    // Block 0 mounts unconditionally so an opened lesson is never blank while layout settles.
    mounted: Array.from({ length: stageCount }, (_stage, index) => index === 0),
    visible: Array.from({ length: stageCount }, (_stage, index) => index === 0),
  };
}

function byPosition<T extends { position: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.position - right.position);
}

/**
 * Renders one course lesson as a single scrolling page: its concept copy, every stage's live GLSL
 * preview and source in reading order, and the completion action. Every piece of content comes from
 * the supplied `CourseLesson`, so this component works for every published lesson of every module.
 * Progress writes are owned by the caller; a rejected write is surfaced here as a retryable error.
 */
export function LessonWorkspace({
  completed,
  hydrated,
  lesson,
  lessonCount,
  lessonIndex,
  modulePosition,
  moduleTitle,
  onBack,
  onComplete,
  onNext,
  onUndo,
  progressPercent,
}: LessonWorkspaceProps) {
  const [state, setState] = useState<WorkspaceState>(() => freshState(lesson));
  const workspace = state.lessonId === lesson.id ? state : freshState(lesson);

  const update = (
    patch: Partial<WorkspaceState> | ((previous: WorkspaceState) => Partial<WorkspaceState>),
  ) => {
    setState((previous) => {
      const base = previous.lessonId === lesson.id ? previous : freshState(lesson);
      return { ...base, ...(typeof patch === "function" ? patch(base) : patch) };
    });
  };

  const stages = byPosition(lesson.stages);

  const [visibilityState, setVisibilityState] = useState<StageVisibilityState>(() =>
    freshVisibility(lesson, stages.length),
  );
  // Reconciled at render time — same idiom as `workspace` above — so a lesson change is never
  // committed against the previous lesson's mount/visibility booleans. A passive `useEffect` runs
  // only after that first mismatched render has already committed, which is too late: it would
  // mount (and then immediately unmount) a real `GLView` for an index that only existed in the old
  // lesson's stage count.
  const visibility =
    visibilityState.lessonId === lesson.id ? visibilityState : freshVisibility(lesson, stages.length);

  // Pre-sized so every index is always occupied. React Native gives no ordering guarantee between
  // sibling `onLayout` callbacks, so without this a block that reports before an earlier-index block
  // would leave a hole at that earlier index; `computeStageVisibility`'s `for...of` destructures each
  // element and throws on a hole. `height: 0` already reads as "unmeasured" to that function, so a
  // freshly seeded entry is indistinguishable from one that just hasn't been measured yet.
  const boundsRef = useRef<StageBounds[]>(stages.map(() => ({ top: 0, height: 0 })));
  const scrollYRef = useRef(0);
  const viewportHeightRef = useRef(0);

  // A new lesson invalidates every measurement. Reusing them would drive mount decisions from the
  // previous lesson's geometry — the same shape of bug as the stage index that used to leak here.
  // `visibility` itself no longer needs resetting here — it is reconciled at render time above — but
  // these refs aren't rendered, so a passive effect is the right place for them.
  useEffect(() => {
    boundsRef.current = stages.map(() => ({ top: 0, height: 0 }));
    scrollYRef.current = 0;
  }, [lesson.id, stages.length]);

  const recomputeVisibility = useCallback(() => {
    const { shouldMount, isVisible } = computeStageVisibility(
      boundsRef.current,
      scrollYRef.current,
      viewportHeightRef.current,
    );

    setVisibilityState((previous) => {
      const base = previous.lessonId === lesson.id ? previous : freshVisibility(lesson, stages.length);
      const mounted = shouldMount.map((next, index) => next || base.mounted[index] === true);
      // Length-checked first: `.every()` alone only walks the *new* array's indices, so a shorter
      // array (not every block measured yet, or a lesson change mid-flight) would silently ignore
      // `base`'s trailing elements — and an empty new array would look vacuously "same" — letting
      // a genuinely stale `base` be returned instead of the fresh state.
      const sameMounted =
        mounted.length === base.mounted.length &&
        mounted.every((value, index) => value === base.mounted[index]);
      const sameVisible =
        isVisible.length === base.visible.length &&
        isVisible.every((value, index) => value === base.visible[index]);

      // Returning `base` unchanged tells React to skip the re-render when nothing moved. Without
      // this the component would re-render on every scroll frame, which is exactly the cost this
      // layout must not add.
      return sameMounted && sameVisible ? base : { lessonId: lesson.id, mounted, visible: isVisible };
    });
  }, [lesson, stages.length]);

  const moduleNumeral = `Module ${String(modulePosition).padStart(2, "0")}`;
  const isFinalLesson = lessonIndex >= lessonCount - 1;
  const lessonProgressWidth = `${((lessonIndex + 1) / Math.max(lessonCount, 1)) * 100}%` as const;

  const markComplete = async () => {
    update({ failedAction: null });
    try {
      await onComplete();
      update({ failedAction: null, isCompletionVisible: true });
    } catch {
      update({ failedAction: "complete", isCompletionVisible: false });
    }
  };

  const markIncomplete = async () => {
    update({ failedAction: null });
    try {
      await onUndo();
    } catch {
      update({ failedAction: "undo" });
    }
  };

  const confirmUndo = () => {
    Alert.alert(
      "Mark lesson incomplete?",
      "This lesson will be removed from your completed progress. Later saved lessons will remain completed.",
      [
        { style: "cancel", text: "Keep completed" },
        {
          onPress: () => {
            void markIncomplete();
          },
          style: "destructive",
          text: "Mark incomplete",
        },
      ],
    );
  };

  return (
    <>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <View style={styles.appFrame}>
          <View style={styles.header}>
            <Pressable
              accessibilityLabel="Back"
              accessibilityRole="button"
              hitSlop={10}
              onPress={onBack}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <AppIcon
                color={Colors.text}
                fallback="‹"
                name={{ android: "arrow_back", ios: "chevron.left", web: "arrow_back" }}
                size={22}
              />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.moduleLabel}>{moduleNumeral}</Text>
              <Text style={styles.headerTitle}>{lesson.shortTitle}</Text>
            </View>
            <Text style={styles.stepLabel}>
              {lessonIndex + 1} of {lessonCount}
            </Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: lessonProgressWidth }]} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            onLayout={(event) => {
              viewportHeightRef.current = event.nativeEvent.layout.height;
              recomputeVisibility();
            }}
            onScroll={(event) => {
              scrollYRef.current = event.nativeEvent.contentOffset.y;
              recomputeVisibility();
            }}
            overScrollMode="never"
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            testID="lesson-scroll"
          >
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>Concept</Text>
              <Text style={styles.title}>{lesson.title}</Text>
              <Text style={styles.lede}>{lesson.intro}</Text>
            </View>

            {stages.map((item, index) => (
              <View
                key={item.id}
                onLayout={(event) => {
                  boundsRef.current[index] = {
                    top: event.nativeEvent.layout.y,
                    height: event.nativeEvent.layout.height,
                  };
                  recomputeVisibility();
                }}
                testID={`stage-block-${index}`}
              >
                <LessonStageBlock
                  isMounted={visibility.mounted[index] === true}
                  isVisible={visibility.visible[index] === true}
                  position={index + 1}
                  stage={item}
                />
              </View>
            ))}

            <Text style={styles.takeaway}>{lesson.takeaway}</Text>
            {lesson.tryThis !== undefined && <Text style={styles.tryThis}>{lesson.tryThis}</Text>}
          </ScrollView>

          <View style={styles.actionBar}>
            {workspace.failedAction && (
              <View style={styles.errorPanel}>
                <Text style={styles.errorTitle}>Progress not saved</Text>
                <Text style={styles.errorBody}>
                  {workspace.failedAction === "complete"
                    ? "Shadercraft could not save this lesson."
                    : "Shadercraft could not update this lesson."}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    void (workspace.failedAction === "complete" ? markComplete() : markIncomplete());
                  }}
                  style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
                >
                  <Text style={styles.retryLabel}>Retry</Text>
                </Pressable>
              </View>
            )}

            <Pressable
              accessibilityLabel={
                completed ? "Lesson completed. Tap to mark incomplete" : undefined
              }
              accessibilityRole="button"
              accessibilityState={{ disabled: !hydrated }}
              disabled={!hydrated}
              onPress={
                completed
                  ? confirmUndo
                  : () => {
                      void markComplete();
                    }
              }
              style={({ pressed }) => [
                styles.completeButton,
                completed && styles.completedButton,
                pressed && styles.pressed,
              ]}
            >
              {completed && (
                <AppIcon
                  color={Colors.accent}
                  fallback="✓"
                  name={{ android: "check", ios: "checkmark", web: "check" }}
                  size={20}
                />
              )}
              <Text style={[styles.completeLabel, completed && styles.completedLabel]}>
                {!hydrated
                  ? "Loading progress…"
                  : completed
                    ? "Completed · Tap to undo"
                    : "Mark lesson complete"}
              </Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <LessonCompletionSheet
        completionMessage={
          isFinalLesson
            ? `${moduleTitle} is complete. Continue in the course to see what unlocks next.`
            : undefined
        }
        lessonTitle={lesson.title}
        nextActionLabel={isFinalLesson ? "Return to course" : "Continue to next lesson"}
        onClose={() => update({ isCompletionVisible: false })}
        onNext={() => {
          update({ isCompletionVisible: false });
          onNext();
        }}
        progressPercent={progressPercent}
        visible={workspace.isCompletionVisible}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
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
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: { flex: 1, marginLeft: Spacing.md },
  moduleLabel: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  headerTitle: { marginTop: 2, color: Colors.text, fontSize: 15, fontWeight: "800" },
  stepLabel: { color: Colors.textMuted, fontFamily: "monospace", fontSize: 10 },
  progressTrack: { height: 3, backgroundColor: Colors.surfaceRaised },
  progressFill: { height: "100%", backgroundColor: Colors.accent },
  content: { paddingHorizontal: Spacing.xl, paddingBottom: 56 },
  intro: { paddingTop: 38 },
  eyebrow: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    marginTop: Spacing.sm,
    color: Colors.text,
    fontSize: 31,
    fontWeight: "900",
    letterSpacing: -0.9,
    lineHeight: 37,
  },
  lede: { marginTop: Spacing.md, color: Colors.textMuted, fontSize: 15, lineHeight: 23 },
  takeaway: {
    marginTop: Spacing.xxl,
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  tryThis: {
    marginTop: Spacing.md,
    color: Colors.accent,
    fontSize: 13,
    lineHeight: 20,
  },
  actionBar: {
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
    gap: Spacing.sm,
  },
  errorPanel: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.coral,
    backgroundColor: Colors.surface,
    gap: Spacing.xs,
  },
  errorTitle: { color: Colors.coral, fontSize: 13, fontWeight: "900" },
  errorBody: { color: Colors.textMuted, fontSize: 12, lineHeight: 18 },
  retryButton: {
    marginTop: Spacing.xs,
    minHeight: 38,
    paddingHorizontal: Spacing.lg,
    alignSelf: "flex-start",
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  retryLabel: { color: Colors.background, fontSize: 13, fontWeight: "800" },
  completeButton: {
    minHeight: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  completedButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: "rgba(199,244,100,0.08)",
  },
  completeLabel: { color: Colors.background, fontSize: 15, fontWeight: "900" },
  completedLabel: { color: Colors.accent },
  pressed: { opacity: 0.72 },
});
