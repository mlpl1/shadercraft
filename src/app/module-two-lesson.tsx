import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../components/app-icon";
import { LessonCompletionSheet } from "../components/lesson-completion-sheet";
import { LiveShaderPreview } from "../components/live-shader-preview";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useProgress } from "../context/progress-context";
import {
  getCurrentModuleTwoLesson,
  getModuleTwoLesson,
  getNextModuleTwoLesson,
  isModuleTwoLessonUnlocked,
  MODULE_TWO_LESSONS,
  type ModuleTwoLessonId,
} from "../lib/curriculum";
import { MODULE_TWO_CONTENT } from "../lib/module-two-content";

export default function ModuleTwoLessonScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lessonId?: string }>();
  const {
    completeLesson,
    hasCompletedLesson,
    isHydrated,
    progress,
    progressPercent,
    uncompleteLesson,
  } = useProgress();
  const requestedLesson = getModuleTwoLesson(params.lessonId);
  const lesson =
    requestedLesson &&
    isModuleTwoLessonUnlocked(requestedLesson.id, progress.completedLessonIds)
      ? requestedLesson
      : getCurrentModuleTwoLesson(progress.completedLessonIds);
  const lessonId = lesson.id as ModuleTwoLessonId;
  const lessonIndex = MODULE_TWO_LESSONS.findIndex((item) => item.id === lessonId);
  const content = MODULE_TWO_CONTENT[lessonId];
  const [presetSelection, setPresetSelection] = useState({ lessonId, index: 0 });
  const [showCompletion, setShowCompletion] = useState(false);
  const presetIndex = presetSelection.lessonId === lessonId ? presetSelection.index : 0;
  const preset = content.presets[presetIndex] ?? content.presets[0];
  const isComplete = hasCompletedLesson(lessonId);
  const nextLesson = getNextModuleTwoLesson(lessonId);
  const isFinalLesson = lessonIndex === MODULE_TWO_LESSONS.length - 1;

  const markComplete = async () => {
    try {
      await completeLesson(lessonId);
      setShowCompletion(true);
    } catch {
      Alert.alert("Progress not saved", "Shadercraft could not save this lesson. Try again.");
    }
  };

  const confirmUndo = () => {
    Alert.alert(
      "Mark lesson incomplete?",
      "This lesson will be removed from your completed progress. Later saved lessons will remain completed.",
      [
        { text: "Keep completed", style: "cancel" },
        {
          text: "Mark incomplete",
          style: "destructive",
          onPress: () => {
            void uncompleteLesson(lessonId).catch(() => {
              Alert.alert("Progress not saved", "Shadercraft could not update this lesson.");
            });
          },
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
              onPress={() => router.back()}
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
              <Text style={styles.moduleLabel}>Module 02</Text>
              <Text style={styles.headerTitle}>{lesson.shortTitle}</Text>
            </View>
            <Text style={styles.stepLabel}>{lessonIndex + 1} of 5</Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((lessonIndex + 1) / 5) * 100}%` }]} />
          </View>

          <ScrollView
            contentContainerStyle={styles.content}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.intro}>
              <Text style={styles.eyebrow}>Shape synthesis</Text>
              <Text style={styles.title}>{lesson.title}</Text>
              <Text style={styles.lede}>{content.intro}</Text>
            </View>

            <View style={styles.workspace}>
              <View style={styles.workspaceHeader}>
                <View>
                  <Text style={styles.workspaceEyebrow}>Live workspace</Text>
                  <Text style={styles.workspaceTitle}>{preset.label}</Text>
                </View>
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveLabel}>Running</Text>
                </View>
              </View>

              <View style={styles.previewCard}>
                <LiveShaderPreview mode={preset.mode} />
                <View style={styles.previewFooter}>
                  <Text style={styles.previewLabel}>Shape field</Text>
                  <Text style={styles.previewValue}>{preset.value}</Text>
                </View>
              </View>

              <View style={styles.tryCard}>
                <Text style={styles.tryTitle}>Try it</Text>
                <Text style={styles.tryHint}>{content.tryHint}</Text>
                <View accessibilityRole="radiogroup" style={styles.presets}>
                  {content.presets.map((option, index) => {
                    const selected = index === presetIndex;
                    return (
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        key={option.mode}
                        onPress={() => setPresetSelection({ lessonId, index })}
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
              </View>

              <View style={styles.codeCard}>
                <View style={styles.codeHeader}>
                  <Text style={styles.codeFilename}>{preset.filename}</Text>
                  <Text style={styles.codeLanguage}>LIVE GLSL</Text>
                </View>
                <View style={styles.codeBody}>
                  {preset.code.map((line, index) => (
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
              <Text style={styles.conceptTitle}>{content.conceptTitle}</Text>
              <Text style={styles.conceptLede}>{content.conceptLede}</Text>
            </View>

            {content.sections.map((section, index) => (
              <View key={section.title} style={styles.section}>
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
                <Text style={styles.takeawayBody}>{content.takeaway}</Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.actionBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !isHydrated }}
              disabled={!isHydrated}
              onPress={isComplete ? confirmUndo : markComplete}
              style={({ pressed }) => [
                styles.completeButton,
                isComplete && styles.completedButton,
                pressed && styles.pressed,
              ]}
            >
              {isComplete && (
                <AppIcon
                  color={Colors.accent}
                  fallback="✓"
                  name={{ android: "check", ios: "checkmark", web: "check" }}
                  size={20}
                />
              )}
              <Text style={[styles.completeLabel, isComplete && styles.completedLabel]}>
                {!isHydrated
                  ? "Loading progress…"
                  : isComplete
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
            ? "Module 02 is complete. Color & Light is now unlocked in your learning path."
            : undefined
        }
        lessonTitle={lesson.title}
        nextActionLabel={nextLesson ? "Continue to next lesson" : "Explore Module 03"}
        onClose={() => setShowCompletion(false)}
        onNext={() => {
          setShowCompletion(false);
          if (nextLesson) {
            router.replace({
              pathname: "/module-two-lesson",
              params: { lessonId: nextLesson.id },
            });
          } else {
            router.replace("/course");
          }
        }}
        progressPercent={progressPercent}
        visible={showCompletion}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  appFrame: { flex: 1, width: "100%", maxWidth: 520, alignSelf: "center", backgroundColor: Colors.background },
  header: { minHeight: 64, paddingHorizontal: Spacing.xl, flexDirection: "row", alignItems: "center" },
  backButton: { width: 40, height: 40, borderRadius: Radius.round, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, marginLeft: Spacing.md },
  moduleLabel: { color: Colors.accent, fontFamily: "monospace", fontSize: 9, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  headerTitle: { marginTop: 2, color: Colors.text, fontSize: 15, fontWeight: "800" },
  stepLabel: { color: Colors.textMuted, fontFamily: "monospace", fontSize: 10 },
  progressTrack: { height: 3, backgroundColor: Colors.surfaceRaised },
  progressFill: { height: "100%", backgroundColor: Colors.accent },
  content: { padding: Spacing.xl, paddingBottom: 48 },
  intro: { paddingTop: Spacing.lg },
  eyebrow: { color: Colors.accent, fontFamily: "monospace", fontSize: 9, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  title: { marginTop: Spacing.sm, color: Colors.text, fontSize: 31, fontWeight: "900", letterSpacing: -0.9, lineHeight: 37 },
  lede: { marginTop: Spacing.md, color: Colors.textMuted, fontSize: 15, lineHeight: 23 },
  workspace: { marginTop: Spacing.xxl, gap: Spacing.md },
  workspaceHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  workspaceEyebrow: { color: Colors.textSubtle, fontFamily: "monospace", fontSize: 8, fontWeight: "800", textTransform: "uppercase" },
  workspaceTitle: { marginTop: 3, color: Colors.text, fontSize: 20, fontWeight: "800" },
  liveBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: Radius.round, backgroundColor: "rgba(199,244,100,0.1)", flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: Radius.round, backgroundColor: Colors.accent },
  liveLabel: { color: Colors.accent, fontSize: 9, fontWeight: "900", textTransform: "uppercase" },
  previewCard: { overflow: "hidden", borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  previewFooter: { minHeight: 58, paddingHorizontal: Spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  previewLabel: { color: Colors.text, fontSize: 12, fontWeight: "800" },
  previewValue: { color: Colors.accent, fontFamily: "monospace", fontSize: 10 },
  tryCard: { padding: Spacing.lg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  tryTitle: { color: Colors.text, fontSize: 16, fontWeight: "800" },
  tryHint: { marginTop: 3, marginBottom: Spacing.md, color: Colors.textSubtle, fontSize: 11 },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  preset: { flex: 1, flexBasis: "46%", minHeight: 64, paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background, justifyContent: "center" },
  selectedPreset: { borderColor: Colors.accent, backgroundColor: "rgba(199,244,100,0.08)" },
  presetLabel: { color: Colors.textMuted, fontSize: 13, fontWeight: "800" },
  selectedPresetLabel: { color: Colors.text },
  presetValue: { marginTop: 4, color: Colors.textSubtle, fontFamily: "monospace", fontSize: 10 },
  selectedPresetValue: { color: Colors.accent },
  codeCard: { overflow: "hidden", borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: "#0C0F14" },
  codeHeader: { minHeight: 42, paddingHorizontal: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  codeFilename: { color: Colors.textMuted, fontFamily: "monospace", fontSize: 10 },
  codeLanguage: { color: Colors.textSubtle, fontSize: 9, fontWeight: "900" },
  codeBody: { paddingVertical: Spacing.md },
  codeLine: { minHeight: 22, paddingRight: Spacing.md, flexDirection: "row" },
  lineNumber: { width: 34, color: "#424B58", fontFamily: "monospace", fontSize: 10, textAlign: "right" },
  codeText: { flex: 1, marginLeft: Spacing.md, color: "#C9D1DA", fontFamily: "monospace", fontSize: 10 },
  codeAccent: { color: Colors.accent },
  conceptHeader: { marginTop: 44, paddingTop: Spacing.xxl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  conceptTitle: { marginTop: Spacing.sm, color: Colors.text, fontSize: 27, fontWeight: "900", letterSpacing: -0.7 },
  conceptLede: { marginTop: Spacing.sm, color: Colors.textMuted, fontSize: 15, lineHeight: 22 },
  section: { marginTop: Spacing.xxl, flexDirection: "row", gap: Spacing.lg },
  sectionNumber: { color: Colors.textSubtle, fontFamily: "monospace", fontSize: 11 },
  sectionCopy: { flex: 1 },
  sectionTitle: { color: Colors.text, fontSize: 20, fontWeight: "800" },
  sectionBody: { marginTop: Spacing.sm, color: Colors.textMuted, fontSize: 14, lineHeight: 22 },
  takeaway: { marginTop: Spacing.xxl, padding: Spacing.lg, borderRadius: Radius.lg, backgroundColor: "rgba(199,244,100,0.08)", flexDirection: "row", gap: Spacing.md },
  takeawayCopy: { flex: 1 },
  takeawayTitle: { color: Colors.accent, fontSize: 13, fontWeight: "900" },
  takeawayBody: { marginTop: 5, color: Colors.textMuted, fontSize: 13, lineHeight: 20 },
  actionBar: { padding: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border, backgroundColor: Colors.background },
  completeButton: { minHeight: 52, borderRadius: Radius.md, backgroundColor: Colors.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm },
  completedButton: { borderWidth: 1, borderColor: Colors.accent, backgroundColor: "rgba(199,244,100,0.08)" },
  completeLabel: { color: Colors.background, fontSize: 15, fontWeight: "900" },
  completedLabel: { color: Colors.accent },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
});
