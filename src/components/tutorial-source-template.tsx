import { StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";
import { SHADERCRAFT_BLANK } from "../data/course/tutorial-exercise";

export type TutorialSourceState = "idle" | "incorrect" | "correct" | "skipped";

type TutorialSourceTemplateProps = {
  template: string;
  selectedFragment?: string;
  state?: TutorialSourceState;
};

const BLANK_LABEL = "Choose an answer";

function readableExpression(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

/** A read-only source listing that keeps a tutorial's single answer blank visible in context. */
export function TutorialSourceTemplate({
  template,
  selectedFragment,
  state = "idle",
}: TutorialSourceTemplateProps) {
  const blankIndex = template.indexOf(SHADERCRAFT_BLANK);
  const prefix = blankIndex >= 0 ? template.slice(0, blankIndex) : template;
  const suffix = blankIndex >= 0 ? template.slice(blankIndex + SHADERCRAFT_BLANK.length) : "";
  const fragment = selectedFragment ?? BLANK_LABEL;
  const source = `${prefix}${fragment}${suffix}`;

  return (
    <View
      accessible
      accessibilityLabel={`Source template: ${readableExpression(source)}`}
      style={styles.container}
      testID="tutorial-source-template"
    >
      <Text style={styles.eyebrow}>Complete the code</Text>
      <Text selectable style={styles.code}>
        {prefix}
        <Text
          style={[
            selectedFragment ? styles.selectedFragment : styles.blank,
            state === "incorrect" && styles.incorrect,
            state === "correct" && styles.correct,
            state === "skipped" && styles.revealed,
          ]}
        >
          {fragment}
        </Text>
        {suffix}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  eyebrow: {
    color: Colors.textSubtle,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  code: {
    color: Colors.text,
    fontFamily: "monospace",
    fontSize: 14,
    lineHeight: 24,
  },
  blank: {
    backgroundColor: Colors.surfaceRaised,
    color: Colors.cyan,
    fontStyle: "italic",
    textDecorationLine: "underline",
  },
  selectedFragment: {
    backgroundColor: Colors.surfaceRaised,
    color: Colors.text,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
  incorrect: { color: Colors.coral },
  correct: { color: Colors.accent },
  revealed: { color: Colors.accent },
});