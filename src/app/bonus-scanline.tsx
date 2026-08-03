import { useState } from "react";
import {
  Image,
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
  type ShaderPreviewMode,
} from "../components/live-shader-preview";
import { Colors, Radius, Spacing } from "../constants/theme";

type LogoMode = "logo-scanlines" | "logo-ribbon" | "logo-cutout" | "logo-final";

const presets: Array<{ label: string; mode: LogoMode; value: string }> = [
  { label: "Scanlines", mode: "logo-scanlines", value: "fract(y × 17)" },
  { label: "S envelope", mode: "logo-ribbon", value: "3 contour zones" },
  { label: "Cutout", mode: "logo-cutout", value: "envelope × lines" },
  { label: "Final look", mode: "logo-final", value: "flowing thickness" },
];

const codeByMode: Record<LogoMode, string[]> = {
  "logo-scanlines": [
    "float stripe = abs(fract((p.y + 0.70) * 17.0) - 0.5);",
    "float row = floor((p.y + 0.70) * 17.0);",
    "float rowY = (row + 0.5) / 17.0 - 0.70;",
    "float phase = (rowY + 0.68) / 1.36;",
    "float bowl = 0.5 - 0.5 * cos(2.0 * TAU * phase);",
    "float halfWidth = mix(0.10, 0.34, bowl);",
    "float lines = 1.0 - smoothstep(halfWidth, halfWidth + 0.035, stripe);",
    "vec3 color = mix(background, lime, lines);",
  ],
  "logo-ribbon": [
    "if (p.y > 0.27)      bounds = upperBowl(p.y);",
    "else if (p.y > -0.27) bounds = middleSweep(p.y);",
    "else                   bounds = lowerBowl(p.y);",
    "float envelope = inside(p.x, bounds.x, bounds.y);",
  ],
  "logo-cutout": [
    "float sMask = envelope * lines;",
    "sMask *= 1.0 - smoothstep(0.70, 0.77, abs(p.y));",
    "vec3 color = mix(background, lime, sMask);",
  ],
  "logo-final": [
    "float row = floor((p.y + 0.70) * 17.0);",
    "float noise = fract(sin(row * 91.73) * 43758.5453);",
    "float noise2 = fract(sin((row + 19.0) * 73.17) * 24634.6);",
    "bounds.x += (noise - 0.5) * 0.035;",
    "bounds.y += (noise2 - 0.5) * 0.04;",
    "float rowY = (row + 0.5) / 17.0 - 0.70;",
    "float phase = (rowY + 0.68) / 1.36 - u_time * 0.08;",
    "float bowl = 0.5 - 0.5 * cos(2.0 * TAU * phase);",
    "vec3 ink = mix(green, lime, uv.y);",
    "vec3 color = background + ink * sMask + ink * glow * 0.10;",
  ],
};

const highlightedLinesByMode: Record<LogoMode, number[]> = {
  "logo-scanlines": [1],
  "logo-ribbon": [1, 2, 3],
  "logo-cutout": [1],
  "logo-final": [7, 8],
};

const explanations = [
  {
    title: "Build horizontal scanlines",
    body: "Multiply y by 17 to produce roughly 26 rows across the mark’s height, then use fract to repeat a 0-to-1 ramp. A sine-shaped thickness profile makes the top, waist, and bottom rows fine while giving both bowls heavier strokes—the same rhythm visible in the reference.",
  },
  {
    title: "Describe S with three envelopes",
    body: "The reference is not one bent ribbon. Its upper bowl stays broad, its middle sweep grows from a short left stroke into a short right stroke, and its lower bowl becomes broad again. Compute separate left and right boundaries for those three vertical zones.",
  },
  {
    title: "Intersect both masks",
    body: "The scanlines cover the whole canvas and the envelope is solid. Multiplying their masks keeps only pixels that belong to both, cutting the three-part S silhouette into horizontal strokes.",
  },
  {
    title: "Break the digital perfection",
    body: "Hash the integer row number to vary the two edges independently, then add a restrained lime gradient and soft secondary mask. In the final preset, time advances a repeating vertical phase so the thin bands visibly travel through the fixed S contour and loop without a jump.",
  },
];

export default function BonusScanlineScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<LogoMode>("logo-final");
  const activePreset = presets.find((preset) => preset.mode === mode)!;

  return (
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
            <Text style={styles.headerEyebrow}>Bonus tutorial</Text>
            <Text style={styles.headerTitle}>Recreate the Scanline S</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>From asset to procedure</Text>
            <Text style={styles.title}>Draw the logo with math</Text>
            <Text style={styles.lede}>
              Rebuild the visual language of the Shadercraft icon without sampling its pixels.
              You’ll combine a repeated line mask with a measured three-part envelope, then add controlled
              imperfection and glow.
            </Text>
          </View>

          <View style={styles.referenceCard}>
            <Image
              accessibilityLabel="Original Shadercraft Scanline S logo"
              source={require("../../assets/images/scanline-s.png")}
              style={styles.referenceImage}
            />
            <View style={styles.referenceCopy}>
              <Text style={styles.referenceEyebrow}>Reference asset</Text>
              <Text style={styles.referenceTitle}>Observe before coding</Text>
              <Text style={styles.referenceBody}>
                The mark has four useful clues: horizontal repetition, an S-shaped envelope,
                tapered edges, and small differences between rows.
              </Text>
            </View>
          </View>

          <View style={styles.workspace}>
            <View style={styles.workspaceHeader}>
              <View>
                <Text style={styles.workspaceEyebrow}>Live construction</Text>
                <Text style={styles.workspaceTitle}>{activePreset.label}</Text>
              </View>
              <Text style={styles.workspaceValue}>{activePreset.value}</Text>
            </View>

            <View style={styles.previewCard}>
              <LiveShaderPreview previewKey={mode as ShaderPreviewMode} />
            </View>

            <View accessibilityRole="radiogroup" style={styles.presets}>
              {presets.map((preset) => {
                const selected = preset.mode === mode;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={preset.mode}
                    onPress={() => setMode(preset.mode)}
                    style={({ pressed }) => [
                      styles.preset,
                      selected && styles.selectedPreset,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.presetLabel, selected && styles.selectedPresetLabel]}>
                      {preset.label}
                    </Text>
                    <Text style={[styles.presetValue, selected && styles.selectedPresetValue]}>
                      {preset.value}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.codeCard}>
              <View style={styles.codeHeader}>
                <Text style={styles.codeFilename}>scanline_s.glsl</Text>
                <Text style={styles.codeLanguage}>LIVE GLSL</Text>
              </View>
              {codeByMode[mode].map((line, index) => (
                <View key={line} style={styles.codeLine}>
                  <Text style={styles.lineNumber}>{index + 1}</Text>
                  <Text
                    style={[
                      styles.codeText,
                      highlightedLinesByMode[mode].includes(index + 1) && styles.codeAccent,
                    ]}
                  >
                    {line}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.breakdownHeader}>
            <Text style={styles.eyebrow}>Concept breakdown</Text>
            <Text style={styles.breakdownTitle}>Four masks, one recognizable mark</Text>
          </View>

          {explanations.map((item, index) => (
            <View key={item.title} style={styles.section}>
              <Text style={styles.sectionNumber}>{String(index + 1).padStart(2, "0")}</Text>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>{item.title}</Text>
                <Text style={styles.sectionBody}>{item.body}</Text>
              </View>
            </View>
          ))}

          <View style={styles.challengeCard}>
            <Text style={styles.challengeEyebrow}>Make it yours</Text>
            <Text style={styles.challengeTitle}>Three useful experiments</Text>
            <Text style={styles.challengeBody}>
              Change 17.0 to alter line density. Smooth the two contour transitions for a more
              conventional glyph, or exaggerate each row’s edge offset for a glitchier mark.
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
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
    minHeight: 66,
    paddingHorizontal: Spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
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
  headerCopy: { marginLeft: Spacing.md },
  headerEyebrow: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  headerTitle: { marginTop: 2, color: Colors.text, fontSize: 16, fontWeight: "800" },
  content: { padding: Spacing.xl, paddingBottom: 48 },
  intro: { paddingTop: Spacing.lg },
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
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1,
  },
  lede: { marginTop: Spacing.md, color: Colors.textMuted, fontSize: 15, lineHeight: 23 },
  referenceCard: {
    marginTop: Spacing.xl,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    flexDirection: "row",
    alignItems: "center",
  },
  referenceImage: { width: 112, height: 112, borderRadius: Radius.md },
  referenceCopy: { flex: 1, marginLeft: Spacing.lg },
  referenceEyebrow: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  referenceTitle: { marginTop: 5, color: Colors.text, fontSize: 16, fontWeight: "800" },
  referenceBody: { marginTop: 5, color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
  workspace: { marginTop: Spacing.xl, gap: Spacing.md },
  workspaceHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  workspaceEyebrow: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  workspaceTitle: { marginTop: 3, color: Colors.text, fontSize: 20, fontWeight: "800" },
  workspaceValue: { color: Colors.accent, fontFamily: "monospace", fontSize: 10 },
  previewCard: {
    overflow: "hidden",
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  preset: {
    flex: 1,
    flexBasis: "46%",
    minHeight: 64,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    justifyContent: "center",
  },
  selectedPreset: { borderColor: Colors.accent, backgroundColor: "rgba(199,244,100,0.08)" },
  presetLabel: { color: Colors.textMuted, fontSize: 13, fontWeight: "800" },
  selectedPresetLabel: { color: Colors.text },
  presetValue: { marginTop: 4, color: Colors.textSubtle, fontFamily: "monospace", fontSize: 10 },
  selectedPresetValue: { color: Colors.accent },
  codeCard: {
    overflow: "hidden",
    paddingBottom: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#0C0F14",
  },
  codeHeader: {
    minHeight: 42,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codeFilename: { color: Colors.textMuted, fontFamily: "monospace", fontSize: 10 },
  codeLanguage: { color: Colors.textSubtle, fontSize: 9, fontWeight: "900" },
  codeLine: { minHeight: 22, paddingRight: Spacing.md, flexDirection: "row" },
  lineNumber: { width: 34, color: "#424B58", fontFamily: "monospace", fontSize: 10, textAlign: "right" },
  codeText: { flex: 1, marginLeft: Spacing.md, color: "#C9D1DA", fontFamily: "monospace", fontSize: 10 },
  codeAccent: { color: Colors.accent },
  breakdownHeader: {
    marginTop: 44,
    paddingTop: Spacing.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  breakdownTitle: { marginTop: Spacing.sm, color: Colors.text, fontSize: 26, fontWeight: "900" },
  section: { marginTop: Spacing.xxl, flexDirection: "row", gap: Spacing.lg },
  sectionNumber: { color: Colors.textSubtle, fontFamily: "monospace", fontSize: 11 },
  sectionCopy: { flex: 1 },
  sectionTitle: { color: Colors.text, fontSize: 19, fontWeight: "800" },
  sectionBody: { marginTop: Spacing.sm, color: Colors.textMuted, fontSize: 14, lineHeight: 22 },
  challengeCard: {
    marginTop: Spacing.xxl,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: "rgba(199,244,100,0.08)",
  },
  challengeEyebrow: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  challengeTitle: { marginTop: 5, color: Colors.text, fontSize: 18, fontWeight: "800" },
  challengeBody: { marginTop: Spacing.sm, color: Colors.textMuted, fontSize: 13, lineHeight: 20 },
  pressed: { opacity: 0.75, transform: [{ scale: 0.98 }] },
});
