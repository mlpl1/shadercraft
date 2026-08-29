import { StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";
import { ShaderSandbox } from "./shader-sandbox";

export type TutorialFeedbackState = "idle" | "incorrect" | "correct" | "skipped";

type TutorialFeedbackProps = {
  state: TutorialFeedbackState;
  targetSource: string;
  learnerSource: string | null;
  helpers?: string;
  explanation?: string;
};

const PREVIEW_HEIGHT = 116;

export function TutorialFeedback({ state, targetSource, learnerSource, helpers, explanation }: TutorialFeedbackProps) {
  if (state === "idle" || !learnerSource) {
    return (
      <View style={styles.targetOnly}>
        <Text style={styles.label}>Target</Text>
        <View style={styles.previewFrame}>
          <ShaderSandbox height={PREVIEW_HEIGHT} helpers={helpers} source={targetSource} />
        </View>
      </View>
    );
  }
  const title = state === "incorrect" ? "Not quite" : state === "skipped" ? "Skipped" : "Correct";
  const message = explanation ?? (
    state === "incorrect"
      ? "That result came from your confirmed answer. Try another option and confirm again."
      : state === "skipped"
        ? "Review the filled code and compare the output before continuing."
        : "The confirmed code produces the target output."
  );
  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text accessibilityRole="alert" style={[styles.title, state === "incorrect" ? styles.error : styles.success]}>{title}</Text>
        {state === "correct" ? <Text style={styles.match}>Output match</Text> : null}
      </View>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.previews}>
        <View style={styles.preview}>
          <Text style={styles.label}>Target</Text>
          <View style={styles.previewFrame}><ShaderSandbox height={PREVIEW_HEIGHT} helpers={helpers} source={targetSource} /></View>
        </View>
        <View style={styles.preview}>
          <Text style={styles.label}>Yours</Text>
          <View style={styles.previewFrame}><ShaderSandbox height={PREVIEW_HEIGHT} helpers={helpers} source={learnerSource} /></View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  targetOnly: { gap: Spacing.xs },
  container: { backgroundColor: Colors.surfaceRaised, borderColor: Colors.border, borderRadius: Radius.md, borderWidth: 1, gap: Spacing.md, padding: Spacing.lg },
  headingRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  title: { fontSize: 16, fontWeight: "800" },
  error: { color: Colors.coral },
  success: { color: Colors.accent },
  match: { color: Colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  message: { color: Colors.textMuted, fontSize: 14, lineHeight: 20 },
  previews: { flexDirection: "row", gap: Spacing.sm },
  preview: { flex: 1, gap: Spacing.xs },
  label: { color: Colors.textSubtle, fontSize: 11, fontWeight: "800", letterSpacing: 0.6, textTransform: "uppercase" },
  previewFrame: { borderRadius: Radius.md, overflow: "hidden" },
});