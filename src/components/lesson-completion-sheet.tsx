import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "./app-icon";
import { Colors, Radius, Spacing } from "../constants/theme";

type LessonCompletionSheetProps = {
  completionMessage?: string;
  lessonTitle: string;
  nextActionLabel: string;
  onClose: () => void;
  onNext: () => void;
  progressPercent: number;
  visible: boolean;
};

export function LessonCompletionSheet({
  completionMessage,
  lessonTitle,
  nextActionLabel,
  onClose,
  onNext,
  progressPercent,
  visible,
}: LessonCompletionSheetProps) {
  const progressWidth = `${progressPercent}%` as `${number}%`;

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close completion summary"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView edges={["bottom"]} style={styles.safeArea}>
          <View accessibilityViewIsModal style={styles.sheet}>
            <View style={styles.iconCircle}>
              <AppIcon
                color={Colors.background}
                fallback="✓"
                name={{ android: "check", ios: "checkmark", web: "check" }}
                size={26}
              />
            </View>

            <Text style={styles.eyebrow}>Progress saved</Text>
            <Text style={styles.title}>Lesson complete</Text>
            <Text style={styles.body}>
              {completionMessage ??
                `${lessonTitle} is complete. Your course progress is now ${progressPercent}%.`}
            </Text>

            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: progressWidth }]} />
              </View>
              <Text style={styles.progressValue}>{progressPercent}%</Text>
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={onNext}
              style={({ pressed }) => [
                styles.primaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.primaryLabel}>{nextActionLabel}</Text>
              <AppIcon
                color={Colors.background}
                fallback="›"
                name={{ android: "arrow_forward", ios: "arrow.right", web: "arrow_forward" }}
                size={20}
              />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryLabel}>Keep reviewing</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    backgroundColor: "rgba(3, 5, 8, 0.78)",
    justifyContent: "flex-end",
  },
  safeArea: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  sheet: {
    padding: Spacing.xl,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceRaised,
  },
  iconCircle: {
    width: 52,
    height: 52,
    marginBottom: Spacing.lg,
    borderRadius: Radius.round,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 5,
    color: Colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.7,
  },
  body: {
    marginTop: Spacing.md,
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  progressRow: {
    marginTop: Spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  progressTrack: {
    flex: 1,
    height: 5,
    overflow: "hidden",
    borderRadius: Radius.round,
    backgroundColor: Colors.border,
  },
  progressFill: {
    height: "100%",
    borderRadius: Radius.round,
    backgroundColor: Colors.accent,
  },
  progressValue: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
  },
  primaryButton: {
    minHeight: 52,
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  primaryLabel: {
    color: Colors.background,
    fontSize: 15,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 46,
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.7,
  },
});
