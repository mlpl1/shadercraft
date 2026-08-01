import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../components/app-icon";
import {
  LiveShaderPreview,
  type CoordinateMode,
} from "../components/live-shader-preview";
import { Colors, Radius, Spacing } from "../constants/theme";

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

export default function LessonScreen() {
  const router = useRouter();
  const [coordinatePreset, setCoordinatePreset] =
    useState<CoordinateMode>("normalized");
  const [isComplete, setIsComplete] = useState(false);
  const codeLines = codeLinesByMode[coordinatePreset];

  const completeLesson = () => {
    setIsComplete(true);
    Alert.alert(
      "Lesson complete",
      "Nice work. Centering & Aspect Ratio is now ready for you.",
    );
  };

  return (
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
            <Text style={styles.headerTitle}>Coordinate systems</Text>
          </View>

          <Text style={styles.stepLabel}>1 of 6</Text>
        </View>

        <View style={styles.lessonProgressTrack}>
          <View style={styles.lessonProgressFill} />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>Concept</Text>
            <Text style={styles.title}>Coordinate Systems &amp; UV Space</Text>
            <Text style={styles.lede}>
              Fragment shaders run once per pixel. Before drawing shapes, turn each pixel
              position into a predictable coordinate you can reason about.
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
              <LiveShaderPreview mode={coordinatePreset} />
              <View style={styles.previewFooter}>
                <View>
                  <Text style={styles.previewLabel}>UV preview</Text>
                  <Text style={styles.previewValue}>
                    {coordinatePreset === "normalized"
                      ? "0.0 → 1.0 · screen space"
                      : "−1.0 → 1.0 · centered"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.tryItCard}>
              <View style={styles.tryItHeading}>
                <Text style={styles.tryItTitle}>Try it</Text>
                <Text style={styles.tryItHint}>Change the coordinate range</Text>
              </View>
              <View accessibilityRole="radiogroup" style={styles.presetControl}>
                {(["normalized", "centered"] as const).map((preset) => {
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
                  {coordinatePreset === "normalized"
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
              <Text style={styles.sectionTitle}>Normalize the fragment coordinate</Text>
              <Text style={styles.bodyCopy}>
                Divide the current pixel by the viewport resolution. This turns raw pixel
                positions into a portable 0-to-1 range on every screen size.
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
                Centered coordinates make symmetry easy. Correct the x-axis with the aspect
                ratio before measuring distance, or circles will stretch on wide screens.
              </Text>
            </View>
          </View>
        </ScrollView>

        <View style={styles.actionBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isComplete }}
            disabled={isComplete}
            onPress={completeLesson}
            style={({ pressed }) => [
              styles.completeButton,
              isComplete && styles.completedButton,
              pressed && styles.pressed,
            ]}
          >
            {isComplete && (
              <AppIcon
                color={Colors.background}
                fallback="✓"
                name={{ android: "check", ios: "checkmark", web: "check" }}
                size={20}
              />
            )}
            <Text style={styles.completeLabel}>
              {isComplete ? "Lesson completed" : "Mark lesson complete"}
            </Text>
          </Pressable>
        </View>
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
    opacity: 0.72,
  },
  completeLabel: {
    color: Colors.background,
    fontSize: 15,
    fontWeight: "800",
  },
  pressed: {
    opacity: 0.68,
  },
});
