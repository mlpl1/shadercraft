import { StyleSheet, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";

type TutorialProgressRailProps = {
  stepIds: readonly string[];
  current: number;
  completed: ReadonlySet<string>;
};

export function TutorialProgressRail({ stepIds, current, completed }: TutorialProgressRailProps) {
  return (
    <View accessibilityRole="progressbar" style={styles.rail} testID="tutorial-progress-rail">
      {stepIds.map((id, index) => {
        const isCompleted = completed.has(id);
        const isCurrent = index === current;
        const label = isCompleted
          ? `Step ${index + 1} completed`
          : isCurrent
            ? `Step ${index + 1} current`
            : `Step ${index + 1} not completed`;
        return (
          <View
            accessibilityLabel={label}
            key={id}
            style={[
              styles.segment,
              isCompleted && styles.completed,
              isCurrent && !isCompleted && styles.current,
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: "row", gap: Spacing.xs },
  segment: { backgroundColor: Colors.surfaceRaised, borderRadius: Radius.round, flex: 1, height: 4 },
  completed: { backgroundColor: Colors.accent },
  current: { backgroundColor: Colors.cyan },
});