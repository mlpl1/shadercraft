import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "./app-icon";
import { Colors, Radius, Spacing } from "../constants/theme";

type LessonState = "complete" | "active" | "locked";

type LessonRowProps = {
  module: string;
  title: string;
  state: LessonState;
  onPress?: () => void;
};

const icons = {
  complete: {
    name: { android: "check", ios: "checkmark", web: "check" } as const,
    fallback: "✓",
  },
  active: {
    name: { android: "play_arrow", ios: "play.fill", web: "play_arrow" } as const,
    fallback: "▶",
  },
  locked: {
    name: { android: "lock", ios: "lock.fill", web: "lock" } as const,
    fallback: "•",
  },
};

export function LessonRow({ module, title, state, onPress }: LessonRowProps) {
  const isActive = state === "active";
  const isComplete = state === "complete";
  const isLocked = state === "locked";
  const moduleNumber = module.match(/\d+/)?.[0] ?? "•";

  return (
    <Pressable
      accessibilityLabel={`${module}, ${title}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: isLocked }}
      disabled={isLocked}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        isActive && styles.activeRow,
        isLocked && styles.lockedRow,
        pressed && styles.pressedRow,
      ]}
    >
      <View
        style={[
          styles.iconCircle,
          isComplete && styles.completeCircle,
          isActive && styles.activeCircle,
        ]}
      >
        {isActive ? (
          <Text style={styles.moduleNumber}>{moduleNumber}</Text>
        ) : (
          <AppIcon
            color={isComplete ? Colors.accent : Colors.textSubtle}
            fallback={icons[state].fallback}
            name={icons[state].name}
            size={isComplete ? 20 : 18}
          />
        )}
      </View>

      <View style={styles.copy}>
        <Text style={[styles.eyebrow, isActive && styles.activeEyebrow]}>
          {isActive ? "Up next" : module}
        </Text>
        <Text style={[styles.title, isLocked && styles.lockedTitle]}>{title}</Text>
      </View>

      {!isLocked && (
        <AppIcon
          color={isActive ? Colors.accent : Colors.textSubtle}
          fallback={isActive ? "▶" : "›"}
          name={
            isActive
              ? icons.active.name
              : { android: "chevron_right", ios: "chevron.right", web: "chevron_right" }
          }
          size={isActive ? 21 : 18}
        />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 74,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    flexDirection: "row",
    alignItems: "center",
  },
  activeRow: {
    backgroundColor: Colors.surfaceRaised,
    borderColor: "rgba(199,244,100,0.3)",
  },
  lockedRow: {
    opacity: 0.42,
  },
  pressedRow: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  completeCircle: {
    borderColor: Colors.accent,
    backgroundColor: "transparent",
  },
  activeCircle: {
    backgroundColor: Colors.surface,
  },
  moduleNumber: {
    color: Colors.accent,
    fontSize: 14,
    fontWeight: "800",
  },
  copy: {
    flex: 1,
    marginLeft: Spacing.lg,
    gap: 2,
  },
  eyebrow: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  activeEyebrow: {
    color: Colors.accent,
  },
  title: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  lockedTitle: {
    color: Colors.textMuted,
  },
});
