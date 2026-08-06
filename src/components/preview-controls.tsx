import { Pressable, StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";

type PreviewControlsProps = {
  paused: boolean;
  collapsed: boolean;
  onTogglePause: () => void;
  onRestart: () => void;
  onToggleCollapse: () => void;
};

/**
 * Pause, restart and collapse for the live preview.
 *
 * Pause exists because a heavy shader can tank the frame rate with no other way out, and collapse
 * because a raised keyboard leaves a phone almost no room for code. Both labels name the action they
 * perform, not the current state, so a screen reader announces "Resume preview" while paused.
 */
export function PreviewControls({
  paused,
  collapsed,
  onTogglePause,
  onRestart,
  onToggleCollapse,
}: PreviewControlsProps) {
  return (
    <View style={styles.bar}>
      <Control
        label={paused ? "Resume preview" : "Pause preview"}
        onPress={onTogglePause}
        text={paused ? "Resume" : "Pause"}
      />
      <Control label="Restart preview" onPress={onRestart} text="Restart" />
      <View style={styles.spacer} />
      <Control
        label={collapsed ? "Show preview" : "Hide preview"}
        onPress={onToggleCollapse}
        text={collapsed ? "Show" : "Hide"}
      />
    </View>
  );
}

function Control({
  label,
  onPress,
  text,
}: {
  label: string;
  onPress: () => void;
  text: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
    >
      <Text style={styles.controlText}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderBottomColor: Colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  spacer: {
    flex: 1,
  },
  control: {
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  controlPressed: {
    backgroundColor: Colors.surfaceRaised,
  },
  controlText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
});
