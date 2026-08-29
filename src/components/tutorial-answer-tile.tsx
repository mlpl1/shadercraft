import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";

export type TutorialAnswerStatus = "idle" | "pending" | "incorrect" | "correct" | "revealed";

type TutorialAnswerTileProps = {
  marker: string;
  fragment: string;
  selected: boolean;
  status: TutorialAnswerStatus;
  disabled: boolean;
  onPress: () => void;
};

const statusLabel: Record<TutorialAnswerStatus, string | null> = {
  idle: null,
  pending: "Selected",
  incorrect: "Incorrect answer",
  correct: "Correct answer",
  revealed: "Answer revealed",
};

export function TutorialAnswerTile({ marker, fragment, selected, status, disabled, onPress }: TutorialAnswerTileProps) {
  const label = statusLabel[status];
  const accessibilityLabel = fragment;
  const accessibilityHint = `${marker}${label ? `. ${label}` : ""}`;
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        status === "pending" && styles.pending,
        status === "incorrect" && styles.incorrect,
        (status === "correct" || status === "revealed") && styles.correct,
        disabled && !selected && styles.deemphasized,
        pressed && styles.pressed,
      ]}
    >
      <View style={[
        styles.marker,
        status === "pending" && styles.markerPending,
        status === "incorrect" && styles.markerIncorrect,
        (status === "correct" || status === "revealed") && styles.markerCorrect,
      ]}>
        <Text style={[styles.markerText, status !== "idle" && selected && styles.markerTextActive]}>{marker}</Text>
      </View>
      <Text style={styles.fragment}>{fragment}</Text>
      {label ? <Text style={styles.status}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  pending: { borderColor: Colors.cyan, borderWidth: 2 },
  incorrect: { borderColor: Colors.coral, borderWidth: 2 },
  correct: { borderColor: Colors.accent, borderWidth: 2 },
  deemphasized: { opacity: 0.48 },
  pressed: { opacity: 0.74 },
  marker: {
    alignItems: "center",
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.sm,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  markerPending: { backgroundColor: Colors.cyan },
  markerIncorrect: { backgroundColor: Colors.coral },
  markerCorrect: { backgroundColor: Colors.accent },
  markerText: { color: Colors.textMuted, fontSize: 13, fontWeight: "800" },
  markerTextActive: { color: Colors.background },
  fragment: { color: Colors.text, flex: 1, fontFamily: "monospace", fontSize: 14, fontWeight: "700", lineHeight: 20 },
  status: { color: Colors.textMuted, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
});