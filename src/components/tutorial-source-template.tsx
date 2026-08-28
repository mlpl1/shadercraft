import { StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";
import { SHADERCRAFT_BLANK } from "../data/course/tutorial-exercise";

type TutorialSourceTemplateProps = {
  template: string;
  selectedFragment?: string;
};

const BLANK_LABEL = "Choose an answer";

function readableExpression(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

/** A read-only source listing that keeps a tutorial's single answer blank visible in context. */
export function TutorialSourceTemplate({
  template,
  selectedFragment,
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
      <Text selectable style={styles.code}>
        {prefix}
        <Text style={selectedFragment ? styles.selectedFragment : styles.blank}>{fragment}</Text>
        {suffix}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  code: {
    color: Colors.text,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: 20,
  },
  blank: {
    color: Colors.textMuted,
    fontStyle: "italic",
    textDecorationLine: "underline",
  },
  selectedFragment: {
    color: Colors.accent,
    fontWeight: "800",
    textDecorationLine: "underline",
  },
});
