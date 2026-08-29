import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";
import type { TutorialFeedbackState } from "./tutorial-feedback";

type TutorialActionDockProps = {
  state: TutorialFeedbackState;
  canConfirm: boolean;
  hasHint: boolean;
  onConfirm: () => void;
  onContinue: () => void;
  onHint: () => void;
  onSkip: () => void;
};

export function TutorialActionDock({ state, canConfirm, hasHint, onConfirm, onContinue, onHint, onSkip }: TutorialActionDockProps) {
  const terminal = state === "correct" || state === "skipped";
  return (
    <View style={styles.dock} testID="tutorial-action-dock">
      {!terminal ? (
        <View style={styles.secondaryRow}>
          {hasHint ? <Pressable accessibilityRole="button" onPress={onHint} style={styles.quiet}><Text style={styles.quietLabel}>Hint</Text></Pressable> : null}
          <Pressable accessibilityLabel="Skip and reveal answer" accessibilityRole="button" onPress={onSkip} style={styles.quiet}><Text style={styles.quietLabel}>Skip</Text></Pressable>
        </View>
      ) : null}
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
  secondaryRow: { flexDirection: "row", justifyContent: "space-between" },
  quiet: { minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.sm },
  quietLabel: { color: Colors.textMuted, fontSize: 14, fontWeight: "700" },
  primary: { alignItems: "center", backgroundColor: Colors.accent, borderRadius: Radius.md, justifyContent: "center", minHeight: 52, paddingHorizontal: Spacing.lg },
  primaryLabel: { color: Colors.background, fontSize: 16, fontWeight: "800" },
  disabled: { opacity: 0.38 },
  pressed: { opacity: 0.76 },
});