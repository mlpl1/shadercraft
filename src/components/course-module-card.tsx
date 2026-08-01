import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "./app-icon";
import { Colors, Radius, Spacing } from "../constants/theme";

type CourseModuleCardProps = {
  completedLessonCount?: number;
  description: string;
  lessonCount: number;
  moduleNumber: number;
  onPress?: () => void;
  status: "available" | "in-progress" | "locked";
  title: string;
  topics: string[];
};

export function CourseModuleCard({
  completedLessonCount = 0,
  description,
  lessonCount,
  moduleNumber,
  onPress,
  status,
  title,
  topics,
}: CourseModuleCardProps) {
  const available = status !== "locked";
  const inProgress = status === "in-progress";

  return (
    <Pressable
      accessibilityLabel={`Module ${moduleNumber}: ${title}`}
      accessibilityRole="button"
      accessibilityState={{ disabled: !available }}
      disabled={!available}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        available && styles.availableCard,
        !available && styles.lockedCard,
        pressed && styles.pressedCard,
      ]}
    >
      <View style={styles.headingRow}>
        <View style={[styles.moduleNumber, available && styles.availableNumber]}>
          <Text style={[styles.moduleNumberText, available && styles.availableNumberText]}>
            {String(moduleNumber).padStart(2, "0")}
          </Text>
        </View>

        <View style={styles.headingCopy}>
          <Text style={[styles.status, available && styles.availableStatus]}>
            {inProgress
              ? `${completedLessonCount} of ${lessonCount} complete`
              : available
                ? "Ready to start"
                : "Locked"}
          </Text>
          <Text style={styles.title}>{title}</Text>
        </View>

        <AppIcon
          color={available ? Colors.accent : Colors.textSubtle}
          fallback={available ? "›" : "•"}
          name={
            available
              ? { android: "arrow_forward", ios: "arrow.right", web: "arrow_forward" }
              : { android: "lock", ios: "lock.fill", web: "lock" }
          }
          size={20}
        />
      </View>

      <Text style={styles.description}>{description}</Text>

      <View style={styles.topicList}>
        {topics.map((topic, index) => (
          <View key={topic} style={styles.topicRow}>
            <Text style={styles.lessonIndex}>{String(index + 1).padStart(2, "0")}</Text>
            <Text style={styles.topic}>{topic}</Text>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <Text style={styles.lessonCount}>{lessonCount} lessons</Text>
        {available && (
          <Text style={styles.startLabel}>
            {inProgress ? "Continue module" : "Start module"}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  availableCard: {
    borderColor: "rgba(199,244,100,0.35)",
    backgroundColor: Colors.surfaceRaised,
  },
  lockedCard: {
    opacity: 0.55,
  },
  pressedCard: {
    opacity: 0.76,
    transform: [{ scale: 0.99 }],
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  moduleNumber: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  availableNumber: {
    borderColor: Colors.accent,
  },
  moduleNumberText: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 14,
    fontWeight: "800",
  },
  availableNumberText: {
    color: Colors.accent,
  },
  headingCopy: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  status: {
    marginBottom: 3,
    color: Colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.75,
    textTransform: "uppercase",
  },
  availableStatus: {
    color: Colors.accent,
  },
  title: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  description: {
    marginTop: Spacing.lg,
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  topicList: {
    marginTop: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    gap: 10,
  },
  topicRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  lessonIndex: {
    width: 28,
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 10,
  },
  topic: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 13,
  },
  footer: {
    marginTop: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  lessonCount: {
    color: Colors.textSubtle,
    fontSize: 11,
    fontWeight: "600",
  },
  startLabel: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "800",
  },
});
