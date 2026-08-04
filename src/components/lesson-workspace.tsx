import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "./app-icon";
import { LessonCompletionSheet } from "./lesson-completion-sheet";
import { LiveShaderPreview } from "./live-shader-preview";
import { Colors, Radius, Spacing } from "../constants/theme";
import type { CourseLesson, LessonPreset } from "../data/course/types";

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
  presetIndex: number;
  restartToken: number;
  failedAction: FailedAction | null;
  isCompletionVisible: boolean;
};

function freshState(lesson: CourseLesson): WorkspaceState {
  return {
    failedAction: null,
    isCompletionVisible: false,
    lessonId: lesson.id,
    presetIndex: defaultPresetIndex(lesson),
    restartToken: 0,
  };
}

function byPosition<T extends { position: number }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.position - right.position);
}

/** The lesson's authored opening preset, falling back to its lowest-positioned one. */
function defaultPresetIndex(lesson: CourseLesson): number {
  const index = byPosition(lesson.presets).findIndex(
    (preset) => preset.id === lesson.defaultPresetId,
  );
  return index >= 0 ? index : 0;
}

/** Only an explicit boolean `true` enables the restart control; other values are ignored. */
function isRestartable(preset: LessonPreset): boolean {
  return preset.previewParameters.restartable === true;
}

/** Presets animate unless authored otherwise, so content without the parameter keeps running. */
function isAnimated(preset: LessonPreset): boolean {
  return preset.previewParameters.animated !== false;
}

/**
 * Renders one course lesson: its concept copy, the live GLSL workspace (preview, preset switcher,
 * highlighted source), and the completion action. Every piece of content comes from the supplied
 * `CourseLesson`, so this component works for every published lesson of every module. Progress
 * writes are owned by the caller; a rejected write is surfaced here as a retryable error.
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

  const update = (patch: Partial<WorkspaceState>) => {
    setState((previous) => ({
      ...(previous.lessonId === lesson.id ? previous : freshState(lesson)),
      ...patch,
    }));
  };

  const presets = byPosition(lesson.presets);
  const sections = byPosition(lesson.sections);
  const preset = presets[workspace.presetIndex] ?? presets[0];
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
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>Concept</Text>
              <Text style={styles.title}>{lesson.title}</Text>
              <Text style={styles.lede}>{lesson.intro}</Text>
            </View>

            <View style={styles.workspace}>
              <View style={styles.workspaceHeader}>
                <View>
                  <Text style={styles.workspaceEyebrow}>Live workspace</Text>
                  <Text style={styles.workspaceTitle}>Preview and source</Text>
                </View>
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveLabel}>{isAnimated(preset) ? "Running" : "Paused"}</Text>
                </View>
              </View>

              <View style={styles.previewCard}>
                <LiveShaderPreview
                  previewKey={preset.previewKey}
                  restartToken={workspace.restartToken}
                />
                <View style={styles.previewFooter}>
                  <Text style={styles.previewLabel}>{lesson.previewCaption}</Text>
                  <Text style={styles.previewValue}>
                    {preset.label} · {preset.value}
                  </Text>
                </View>
              </View>

              <View style={styles.tryCard}>
                <Text style={styles.tryTitle}>Try it</Text>
                <Text style={styles.tryHint}>{lesson.tryHint}</Text>
                <View accessibilityRole="radiogroup" style={styles.presets}>
                  {presets.map((option, index) => {
                    const selected = option.id === preset.id;

                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        key={option.id}
                        onPress={() => update({ presetIndex: index })}
                        style={({ pressed }) => [
                          styles.preset,
                          selected && styles.selectedPreset,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={[styles.presetLabel, selected && styles.selectedPresetLabel]}>
                          {option.label}
                        </Text>
                        <Text style={[styles.presetValue, selected && styles.selectedPresetValue]}>
                          {option.value}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {isRestartable(preset) && (
                  <Pressable
                    accessibilityLabel="Restart animation timeline"
                    accessibilityRole="button"
                    onPress={() => update({ restartToken: workspace.restartToken + 1 })}
                    style={({ pressed }) => [styles.restartButton, pressed && styles.pressed]}
                  >
                    <AppIcon
                      color={Colors.accent}
                      fallback="↻"
                      name={{ android: "refresh", ios: "arrow.counterclockwise", web: "refresh" }}
                      size={17}
                    />
                    <Text style={styles.restartLabel}>Restart timeline</Text>
                  </Pressable>
                )}
              </View>

              <View style={styles.codeCard}>
                <View style={styles.codeHeader}>
                  <Text style={styles.codeFilename}>{preset.filename}</Text>
                  <Text style={styles.codeLanguage}>LIVE GLSL</Text>
                </View>
                <View style={styles.codeBody}>
                  {preset.codeLines.map((line, index) => (
                    <View key={`${index}-${line}`} style={styles.codeLine}>
                      <Text style={styles.lineNumber}>{index + 1}</Text>
                      <Text
                        style={[
                          styles.codeText,
                          preset.highlightedLines.includes(index + 1) && styles.codeAccent,
                        ]}
                      >
                        {line}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <View style={styles.conceptHeader}>
              <Text style={styles.eyebrow}>Concept breakdown</Text>
              <Text style={styles.conceptTitle}>{lesson.conceptTitle}</Text>
              <Text style={styles.conceptLede}>{lesson.conceptLede}</Text>
            </View>

            {sections.map((section, index) => (
              <View key={section.id} style={styles.section}>
                <Text style={styles.sectionNumber}>{String(index + 1).padStart(2, "0")}</Text>
                <View style={styles.sectionCopy}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.sectionBody}>{section.body}</Text>
                </View>
              </View>
            ))}

            <View style={styles.takeaway}>
              <AppIcon
                color={Colors.accent}
                fallback="✦"
                name={{ android: "lightbulb", ios: "lightbulb.fill", web: "lightbulb" }}
                size={22}
              />
              <View style={styles.takeawayCopy}>
                <Text style={styles.takeawayTitle}>Remember</Text>
                <Text style={styles.takeawayBody}>{lesson.takeaway}</Text>
              </View>
            </View>

            <View style={styles.readyCard}>
              <Text style={styles.readyEyebrow}>Checkpoint</Text>
              <Text style={styles.readyTitle}>Ready to experiment?</Text>
              <Text style={styles.readyBody}>
                Switch between every preset and connect the code changes to what you see in the live
                preview. You can review this lesson again after completing it.
              </Text>
            </View>
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
  workspace: { marginTop: 34, gap: Spacing.lg },
  workspaceHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  workspaceEyebrow: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  workspaceTitle: { marginTop: 3, color: Colors.text, fontSize: 20, fontWeight: "800" },
  liveBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: Radius.round,
    backgroundColor: "rgba(199,244,100,0.1)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: { width: 6, height: 6, borderRadius: Radius.round, backgroundColor: Colors.accent },
  liveLabel: { color: Colors.accent, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  previewCard: {
    overflow: "hidden",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  previewFooter: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previewLabel: { color: Colors.text, fontSize: 12, fontWeight: "800" },
  previewValue: { color: Colors.accent, fontFamily: "monospace", fontSize: 10 },
  tryCard: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tryTitle: { color: Colors.text, fontSize: 16, fontWeight: "800" },
  tryHint: { marginTop: 3, marginBottom: Spacing.md, color: Colors.textSubtle, fontSize: 11 },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  preset: {
    flex: 1,
    flexBasis: "46%",
    minHeight: 64,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    justifyContent: "center",
  },
  selectedPreset: { borderColor: Colors.accent, backgroundColor: "rgba(199,244,100,0.08)" },
  presetLabel: { color: Colors.textMuted, fontSize: 13, fontWeight: "800" },
  selectedPresetLabel: { color: Colors.text },
  presetValue: {
    marginTop: 4,
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 10,
  },
  selectedPresetValue: { color: Colors.accent },
  restartButton: {
    marginTop: Spacing.md,
    minHeight: 42,
    paddingHorizontal: Spacing.md,
    alignSelf: "flex-start",
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  restartLabel: { color: Colors.accent, fontSize: 12, fontWeight: "800" },
  codeCard: {
    overflow: "hidden",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#0C0F14",
  },
  codeHeader: {
    minHeight: 42,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codeFilename: { color: Colors.textMuted, fontFamily: "monospace", fontSize: 10 },
  codeLanguage: { color: Colors.textSubtle, fontSize: 9, fontWeight: "900" },
  codeBody: { paddingVertical: Spacing.md },
  codeLine: {
    minHeight: 25,
    paddingHorizontal: Spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  lineNumber: {
    width: 24,
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 18,
  },
  codeText: {
    flex: 1,
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 18,
  },
  codeAccent: { color: Colors.accent },
  conceptHeader: {
    marginTop: 44,
    paddingTop: Spacing.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  conceptTitle: {
    marginTop: Spacing.sm,
    color: Colors.text,
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  conceptLede: { marginTop: Spacing.sm, color: Colors.textMuted, fontSize: 15, lineHeight: 22 },
  section: { marginTop: Spacing.xxl, flexDirection: "row", gap: Spacing.md },
  sectionNumber: { color: Colors.textSubtle, fontFamily: "monospace", fontSize: 11 },
  sectionCopy: { flex: 1 },
  sectionTitle: { color: Colors.text, fontSize: 20, fontWeight: "800" },
  sectionBody: { marginTop: Spacing.sm, color: Colors.textMuted, fontSize: 14, lineHeight: 22 },
  takeaway: {
    marginTop: Spacing.xxl,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: "rgba(199,244,100,0.08)",
    flexDirection: "row",
    gap: Spacing.md,
  },
  takeawayCopy: { flex: 1 },
  takeawayTitle: { color: Colors.accent, fontSize: 13, fontWeight: "900" },
  takeawayBody: { marginTop: 5, color: Colors.textMuted, fontSize: 13, lineHeight: 20 },
  readyCard: {
    marginTop: Spacing.xxl,
    padding: Spacing.xl,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
  },
  readyEyebrow: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  readyTitle: {
    marginTop: Spacing.sm,
    color: Colors.text,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  readyBody: {
    marginTop: Spacing.sm,
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
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
