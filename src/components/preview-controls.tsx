import { Pressable, StyleSheet, View } from "react-native";
import type { SymbolViewProps } from "expo-symbols";

import { AppIcon } from "./app-icon";
import { Colors, Radius } from "../constants/theme";

type PreviewControlsProps = {
  paused: boolean;
  collapsed: boolean;
  onTogglePause: () => void;
  onRestart: () => void;
  onToggleCollapse: () => void;
};

export function PreviewControls({
  paused,
  collapsed,
  onTogglePause,
  onRestart,
  onToggleCollapse,
}: PreviewControlsProps) {
  return (
    <View style={styles.actions} testID="preview-controls">
      <Control
        fallback={paused ? "▶" : "Ⅱ"}
        label={paused ? "Resume preview" : "Pause preview"}
        name={
          paused
            ? { android: "play_arrow", ios: "play.fill", web: "play_arrow" }
            : { android: "pause", ios: "pause.fill", web: "pause" }
        }
        onPress={onTogglePause}
      />
      <Control
        fallback="↻"
        label="Restart preview"
        name={{ android: "refresh", ios: "arrow.clockwise", web: "refresh" }}
        onPress={onRestart}
      />
      <Control
        fallback={collapsed ? "⌄" : "⌃"}
        label={collapsed ? "Show preview" : "Hide preview"}
        name={
          collapsed
            ? { android: "expand_more", ios: "chevron.down", web: "expand_more" }
            : { android: "expand_less", ios: "chevron.up", web: "expand_less" }
        }
        onPress={onToggleCollapse}
      />
    </View>
  );
}

function Control({
  fallback,
  label,
  name,
  onPress,
}: {
  fallback: string;
  label: string;
  name: SymbolViewProps["name"];
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={7}
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}
    >
      <AppIcon color={Colors.textMuted} fallback={fallback} name={name} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
  },
  control: {
    alignItems: "center",
    borderRadius: Radius.round,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  controlPressed: {
    backgroundColor: Colors.surfaceHigh,
  },
});
