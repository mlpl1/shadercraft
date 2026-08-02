import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../components/app-icon";
import {
  LiveShaderPreview,
  type CoordinateMode,
  type ShaderPreviewMode,
} from "../components/live-shader-preview";
import { LessonCompletionSheet } from "../components/lesson-completion-sheet";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useProgress } from "../context/progress-context";
import {
  COLORS_FRAGMENT_OUTPUT_LESSON_ID,
  getModuleOneLesson,
  getNextModuleOneLesson,
  MODULE_ONE_LESSONS,
  type ModuleOneLessonId,
} from "../lib/curriculum";

const codeLinesByMode: Record<
  CoordinateMode,
  { number: number; code: string; accent?: boolean }[]
> = {
  normalized: [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;", accent: true },
    { number: 2, code: "" },
    { number: 3, code: "vec3 color = vec3(uv, 0.0);" },
    { number: 4, code: "fragColor = vec4(color, 1.0);" },
  ],
  centered: [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;" },
    { number: 2, code: "uv = uv * 2.0 - 1.0;", accent: true },
    { number: 3, code: "uv.x *= resolution.x / resolution.y;", accent: true },
    { number: 4, code: "" },
    { number: 5, code: "vec3 color = vec3(" },
    { number: 6, code: "  uv * 0.5 + 0.5," },
    { number: 7, code: "  0.0" },
    { number: 8, code: ");" },
    { number: 9, code: "fragColor = vec4(color, 1.0);" },
  ],
};

type ColorMode = "rgb-gradient" | "color-mix";

const colorCodeLines: Record<
  ColorMode,
  { number: number; code: string; accent?: boolean }[]
> = {
  "rgb-gradient": [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;" },
    { number: 2, code: "vec3 color = vec3(uv.x, uv.y, 0.2);", accent: true },
    { number: 3, code: "fragColor = vec4(color, 1.0);", accent: true },
  ],
  "color-mix": [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;" },
    { number: 2, code: "vec3 warm = vec3(1.0, 0.25, 0.12);" },
    { number: 3, code: "vec3 cool = vec3(0.12, 0.45, 1.0);" },
    { number: 4, code: "vec3 color = mix(warm, cool, uv.x);", accent: true },
    { number: 5, code: "fragColor = vec4(color, 1.0);", accent: true },
  ],
};

export default function LessonScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lessonId?: string }>();
  const requestedLesson = getModuleOneLesson(params.lessonId);
  const requestedLessonIndex = requestedLesson
    ? MODULE_ONE_LESSONS.findIndex((item) => item.id === requestedLesson.id)
    : -1;
  const lesson = requestedLessonIndex >= 0 && requestedLessonIndex < 2
    ? requestedLesson!
    : MODULE_ONE_LESSONS[0];
  const lessonId = lesson.id as ModuleOneLessonId;
  const lessonIndex = MODULE_ONE_LESSONS.findIndex((item) => item.id === lessonId);
  const isColorLesson = lessonId === COLORS_FRAGMENT_OUTPUT_LESSON_ID;
  const [coordinatePreset, setCoordinatePreset] =
    useState<CoordinateMode>("normalized");
  const [colorPreset, setColorPreset] = useState<ColorMode>("rgb-gradient");
  const [showCompletion, setShowCompletion] = useState(false);
  const {
    completeLesson: persistLessonCompletion,
    hasCompletedLesson,
    isHydrated,
    progressPercent,
    uncompleteLesson,
  } = useProgress();
  const isComplete = hasCompletedLesson(lessonId);
  const activeMode: ShaderPreviewMode = isColorLesson ? colorPreset : coordinatePreset;
  const codeLines = isColorLesson
    ? colorCodeLines[colorPreset]
    : codeLinesByMode[coordinatePreset];
  const nextLesson = getNextModuleOneLesson(lessonId);
  const nextImplementedLesson =
    nextLesson?.id === COLORS_FRAGMENT_OUTPUT_LESSON_ID ? nextLesson : undefined;

  const completeLesson = async () => {
    try {
      await persistLessonCompletion(lessonId);
      setShowCompletion(true);
    } catch {
      Alert.alert(
        "Progress not saved",
        "Shadercraft could not save this lesson. Please try again.",
      );
    }
  };

  const confirmUndoCompletion = () => {
    Alert.alert(
      "Mark lesson incomplete?",
      "This lesson will be removed from your completed progress. Later lessons stay saved, but the learning path will begin here again.",
      [
        { text: "Keep completed", style: "cancel" },
        {
          text: "Mark incomplete",
          style: "destructive",
          onPress: () => {
            void uncompleteLesson(lessonId).catch(() => {
              Alert.alert(
                "Progress not saved",
                "Shadercraft could not update this lesson. Please try again.",
              );
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
            accessibilityLabel="Back to home"
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
            <Text style={styles.moduleLabel}>Module 01</Text>
            <Text style={styles.headerTitle}>{lesson.shortTitle}</Text>
          </View>

          <Text style={styles.stepLabel}>{lessonIndex + 1} of {MODULE_ONE_LESSONS.length}</Text>
        </View>

        <View style={styles.lessonProgressTrack}>
          <View
            style={[
              styles.lessonProgressFill,
              { width: `${((lessonIndex + 1) / MODULE_ONE_LESSONS.length) * 100}%` },
            ]}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>Concept</Text>
            <Text style={styles.title}>{lesson.title}</Text>
            <Text style={styles.lede}>
              {isColorLesson
                ? "A fragment shader returns one color for every pixel. Learn how RGB channels, alpha, and color mixing turn numbers into an image."
                : "Fragment shaders run once per pixel. Before drawing shapes, turn each pixel position into a predictable coordinate you can reason about."}
            </Text>
          </View>

          <View style={styles.workspace}>
            <View style={styles.workspaceHeader}>
              <View>
                <Text style={styles.workspaceEyebrow}>Live workspace</Text>
                <Text style={styles.workspaceTitle}>Preview and source</Text>
              </View>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveLabel}>Running</Text>
              </View>
            </View>

            <View style={styles.previewCard}>
              <LiveShaderPreview mode={activeMode} />
              <View style={styles.previewFooter}>
                <View>
                  <Text style={styles.previewLabel}>
                    {isColorLesson ? "Fragment color" : "UV preview"}
                  </Text>
                  <Text style={styles.previewValue}>
                    {isColorLesson
                      ? colorPreset === "rgb-gradient"
                        ? "RGB channels · direct output"
                        : "mix() · warm to cool"
                      : coordinatePreset === "normalized"
                        ? "0.0 → 1.0 · screen space"
                        : "−1.0 → 1.0 · centered"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.tryItCard}>
              <View style={styles.tryItHeading}>
                <Text style={styles.tryItTitle}>Try it</Text>
                <Text style={styles.tryItHint}>
                  {isColorLesson ? "Change the color expression" : "Change the coordinate range"}
                </Text>
              </View>
              <View accessibilityRole="radiogroup" style={styles.presetControl}>
                {isColorLesson && (["rgb-gradient", "color-mix"] as const).map((preset) => {
                  const selected = colorPreset === preset;

                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={preset}
                      onPress={() => setColorPreset(preset)}
                      style={({ pressed }) => [
                        styles.preset,
                        selected && styles.selectedPreset,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.presetLabel, selected && styles.selectedPresetLabel]}>
                        {preset === "rgb-gradient" ? "RGB channels" : "Mix colors"}
                      </Text>
                      <Text style={[styles.presetValue, selected && styles.selectedPresetValue]}>
                        {preset === "rgb-gradient" ? "vec3(r, g, b)" : "mix(a, b, t)"}
                      </Text>
                    </Pressable>
                  );
                })}
                {!isColorLesson && (["normalized", "centered"] as const).map((preset) => {
                  const selected = coordinatePreset === preset;

                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={preset}
                      onPress={() => setCoordinatePreset(preset)}
                      style={({ pressed }) => [
                        styles.preset,
                        selected && styles.selectedPreset,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.presetLabel, selected && styles.selectedPresetLabel]}>
                        {preset === "normalized" ? "Normalized" : "Centered"}
                      </Text>
                      <Text style={[styles.presetValue, selected && styles.selectedPresetValue]}>
                        {preset === "normalized" ? "0 → 1" : "−1 → 1"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.codeCard}>
              <View style={styles.codeHeader}>
                <Text style={styles.codeFilename}>
                  {isColorLesson
                    ? colorPreset === "rgb-gradient"
                      ? "fragment_color.glsl"
                      : "color_mix.glsl"
                    : coordinatePreset === "normalized"
                      ? "normalized_uv.glsl"
                      : "centered_uv.glsl"}
                </Text>
                <Text style={styles.codeLanguage}>LIVE GLSL</Text>
              </View>
              <View style={styles.codeBody}>
                {codeLines.map((line) => (
                  <View key={line.number} style={styles.codeLine}>
                    <Text style={styles.lineNumber}>{line.number}</Text>
                    <Text style={[styles.codeText, line.accent && styles.codeAccent]}>
                      {line.code}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionNumber}>01</Text>
            <View style={styles.sectionCopy}>
              <Text style={styles.sectionTitle}>
                {isColorLesson ? "Build a color from channels" : "Normalize the fragment coordinate"}
              </Text>
              <Text style={styles.bodyCopy}>
                {isColorLesson
                  ? "Each RGB component usually lives between 0 and 1. The final alpha component controls opacity; use 1 for a fully opaque fragment."
                  : "Divide the current pixel by the viewport resolution. This turns raw pixel positions into a portable 0-to-1 range on every screen size."}
              </Text>
            </View>
          </View>

          <View style={styles.takeaway}>
            <AppIcon
              color={Colors.accent}
              fallback="✦"
              name={{ android: "lightbulb", ios: "lightbulb.fill", web: "lightbulb" }}
              size={22}
            />
            <View style={styles.takeawayCopy}>
              <Text style={styles.takeawayTitle}>Remember</Text>
              <Text style={styles.takeawayBody}>
                {isColorLesson
                  ? "vec3 stores red, green, and blue. vec4 adds alpha, which is why fragment output is commonly written as vec4(color, 1.0)."
                  : "Centered coordinates make symmetry easy. Correct the x-axis with the aspect ratio before measuring distance, or circles will stretch on wide screens."}
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.actionBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isComplete ? "Lesson completed. Tap to mark incomplete" : undefined
            }
            accessibilityState={{ disabled: !isHydrated }}
            disabled={!isHydrated}
            onPress={isComplete ? confirmUndoCompletion : completeLesson}
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
        lessonTitle={lesson.title}
        nextActionLabel={nextImplementedLesson ? "Continue to next lesson" : "View course"}
        onClose={() => setShowCompletion(false)}
        onNext={() => {
          setShowCompletion(false);
          if (nextImplementedLesson) {
            router.replace({ pathname: "/lesson", params: { lessonId: nextImplementedLesson.id } });
          } else {
            router.push("/course");
          }
        }}
        progressPercent={progressPercent}
        visible={showCompletion}
      />
    </>
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
  },
  backButton: {
    width: 44,
    height: 44,
    marginLeft: -10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    marginLeft: Spacing.xs,
  },
  moduleLabel: {
    color: Colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  headerTitle: {
    marginTop: 2,
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  stepLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  lessonProgressTrack: {
    height: 2,
    backgroundColor: Colors.border,
  },
  lessonProgressFill: {
    width: "17%",
    height: "100%",
    backgroundColor: Colors.accent,
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxxl,
  },
  intro: {
    marginBottom: Spacing.xxl,
  },
  workspace: {
    gap: Spacing.md,
  },
  workspaceHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  workspaceEyebrow: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  workspaceTitle: {
    marginTop: 3,
    color: Colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  eyebrow: {
    marginBottom: Spacing.sm,
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  title: {
    maxWidth: 360,
    color: Colors.text,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  lede: {
    marginTop: Spacing.md,
    color: Colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  previewCard: {
    overflow: "hidden",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  previewFooter: {
    minHeight: 64,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previewLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  previewValue: {
    marginTop: 3,
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 11,
  },
  liveBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: Radius.round,
    backgroundColor: "rgba(199,244,100,0.1)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.round,
    backgroundColor: Colors.accent,
  },
  liveLabel: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  section: {
    marginTop: Spacing.xxxl,
    flexDirection: "row",
    gap: Spacing.lg,
  },
  sectionNumber: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 12,
  },
  sectionCopy: {
    flex: 1,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  bodyCopy: {
    marginTop: Spacing.sm,
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 23,
  },
  codeCard: {
    overflow: "hidden",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#0C0F14",
  },
  codeHeader: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codeFilename: {
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 11,
  },
  codeLanguage: {
    color: Colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  codeBody: {
    paddingVertical: Spacing.md,
  },
  codeLine: {
    minHeight: 22,
    paddingRight: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
  },
  lineNumber: {
    width: 36,
    color: "#424B58",
    fontFamily: "monospace",
    fontSize: 11,
    textAlign: "right",
  },
  codeText: {
    flex: 1,
    marginLeft: Spacing.md,
    color: "#C9D1DA",
    fontFamily: "monospace",
    fontSize: 11,
  },
  codeAccent: {
    color: Colors.accent,
  },
  tryItCard: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tryItHeading: {
    marginBottom: Spacing.md,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  tryItTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  tryItHint: {
    color: Colors.textSubtle,
    fontSize: 11,
  },
  presetControl: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  preset: {
    flex: 1,
    minHeight: 64,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    justifyContent: "center",
  },
  selectedPreset: {
    borderColor: Colors.accent,
    backgroundColor: "rgba(199,244,100,0.08)",
  },
  presetLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  selectedPresetLabel: {
    color: Colors.text,
  },
  presetValue: {
    marginTop: 4,
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 11,
  },
  selectedPresetValue: {
    color: Colors.accent,
  },
  takeaway: {
    marginTop: Spacing.xxl,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: "rgba(199,244,100,0.08)",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  takeawayCopy: {
    flex: 1,
  },
  takeawayTitle: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "800",
  },
  takeawayBody: {
    marginTop: 5,
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  inlineCode: {
    color: Colors.text,
    fontFamily: "monospace",
  },
  actionBar: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
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
  completeLabel: {
    color: Colors.background,
    fontSize: 15,
    fontWeight: "800",
  },
  completedLabel: {
    color: Colors.accent,
  },
  pressed: {
    opacity: 0.68,
  },
});
