import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";
import type { TutorialFeedbackState } from "./tutorial-feedback";

type TutorialActionDockProps = {
  state: TutorialFeedbackState;
  canConfirm: boolean;
  hasHint: boolean;
  hint?: string;
  hasPrevious?: boolean;
  onPrevious?: () => void;
  onConfirm: () => void;
  onContinue: () => void;
  onHint: () => void;
  onSkip: () => void;
};

export function TutorialActionDock({ state, canConfirm, hasHint, hint, hasPrevious, onPrevious, onConfirm, onContinue, onHint, onSkip }: TutorialActionDockProps) {
  const terminal = state === "correct" || state === "skipped";
  return (
    <View style={styles.dock} testID="tutorial-action-dock">
      {hint ? <View style={styles.hintCard}><Text style={styles.hintTitle}>Hint</Text><Text style={styles.hint}>{hint}</Text></View> : null}
      <View style={styles.secondaryRow}>
        {hasPrevious ? <Pressable accessibilityRole="button" onPress={onPrevious} style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}><Text style={styles.quietLabel}>Previous step</Text></Pressable> : null}
        {!terminal && hasHint ? <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(hint) }} onPress={onHint} style={({ pressed }) => [styles.quiet, hint && styles.hintSelected, pressed && styles.quietPressed]}><Text style={[styles.quietLabel, hint && styles.hintSelectedLabel]}>{hint ? "Hide hint" : "Hint"}</Text></Pressable> : null}
        {!terminal ? <Pressable accessibilityLabel="Skip and reveal answer" accessibilityRole="button" onPress={onSkip} style={({ pressed }) => [styles.quiet, pressed && styles.quietPressed]}><Text style={styles.quietLabel}>Skip</Text></Pressable> : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !terminal && !canConfirm }}
        disabled={!terminal && !canConfirm}
        onPress={terminal ? onContinue : onConfirm}
        style={({ pressed }) => [styles.primary, !terminal && !canConfirm && styles.disabled, pressed && styles.pressed]}
      >
        <Text style={styles.primaryLabel}>{terminal ? "Continue" : "Confirm"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { backgroundColor: Colors.background, borderTopColor: Colors.border, borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.lg },
  hintCard: { backgroundColor: Colors.surfaceRaised, borderColor: Colors.border, borderRadius: Radius.md, borderWidth: 1, gap: Spacing.xs, padding: Spacing.md },
  hintTitle: { color: Colors.cyan, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  hint: { color: Colors.textMuted, fontSize: 13, lineHeight: 18 },
  secondaryRow: { flexDirection: "row", gap: Spacing.sm },
  quiet: { alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.border, borderRadius: Radius.sm, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.sm },
  quietPressed: { backgroundColor: Colors.surfaceRaised },
  hintSelected: { backgroundColor: "rgba(80, 213, 255, 0.12)", borderColor: Colors.cyan },
  hintSelectedLabel: { color: Colors.cyan },
  quietLabel: { color: Colors.textMuted, fontSize: 13, fontWeight: "800" },
  primary: { alignItems: "center", backgroundColor: Colors.accent, borderRadius: Radius.md, justifyContent: "center", minHeight: 52, paddingHorizontal: Spacing.lg },
  primaryLabel: { color: Colors.background, fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.76 },
});
