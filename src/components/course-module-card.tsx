import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppIcon } from "./app-icon";
import { Colors, Radius, Spacing } from "../constants/theme";

type CourseModuleCardProps = {
  completedLessonCount?: number;
  currentLessonIndex?: number;
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
  currentLessonIndex = 0,
  description,
  lessonCount,
  moduleNumber,
  onPress,
  status,
  title,
  topics,
}: CourseModuleCardProps) {
  const available = status !== "locked";
  const moduleLabel = `Module ${String(moduleNumber).padStart(2, "0")}`;

  if (!available) {
    return (
      <View accessibilityLabel={`${moduleLabel}: ${title}, locked`} style={styles.lockedCard}>
        <View style={styles.lockedIcon}>
          <AppIcon
            color={Colors.textSubtle}
            fallback="•"
            name={{ android: "lock", ios: "lock.fill", web: "lock" }}
            size={15}
          />
        </View>
        <View style={styles.lockedCopy}>
          <Text style={styles.lockedLabel}>{moduleLabel}</Text>
          <Text style={styles.lockedTitle}>{title}</Text>
        </View>
        <Text style={styles.lockedCount}>{lessonCount} lessons</Text>
      </View>
    );
  }

  return (
    <View style={styles.moduleShell}>
      <View style={styles.moduleHeader}>
        <View style={styles.moduleBadge}>
          <Text style={styles.moduleBadgeText}>{String(moduleNumber).padStart(2, "0")}</Text>
        </View>
        <View style={styles.moduleHeading}>
          <View style={styles.moduleMetaRow}>
            <Text style={styles.moduleLabel}>{moduleLabel}</Text>
            <View style={styles.statusPill}>
              <Text style={styles.statusPillText}>
                {completedLessonCount > 0 ? `${completedLessonCount}/${lessonCount}` : "Start"}
              </Text>
            </View>
          </View>
          <Text style={styles.moduleTitle}>{title}</Text>
          <Text style={styles.moduleDescription}>{description}</Text>
        </View>
      </View>

      <View style={styles.timeline}>
        {topics.map((topic, index) => {
          const complete = index < completedLessonCount;
          const current = index === currentLessonIndex;
          const last = index === topics.length - 1;

          return (
            <View key={topic} style={styles.lessonRow}>
              <View style={styles.railColumn}>
                <View
                  style={[
                    styles.lessonNode,
                    complete && styles.completeNode,
                    current && styles.currentNode,
                  ]}
                >
                  {complete ? (
                    <AppIcon
                      color={Colors.background}
                      fallback="✓"
                      name={{ android: "check", ios: "checkmark", web: "check" }}
                      size={12}
                    />
                  ) : (
                    <Text style={[styles.nodeIndex, current && styles.currentNodeIndex]}>
                      {index + 1}
                    </Text>
                  )}
                </View>
                {!last && <View style={[styles.rail, complete && styles.completeRail]} />}
              </View>

              <View style={[styles.lessonContent, current && styles.currentLesson]}>
                <Text style={[styles.lessonEyebrow, current && styles.currentLessonEyebrow]}>
                  Lesson {String(index + 1).padStart(2, "0")}
                  {complete ? " · Complete" : current ? " · Current" : ""}
                </Text>
                <Text style={[styles.lessonTitle, current && styles.currentLessonTitle]}>
                  {topic}
                </Text>

                {current && (
                  <Pressable
                    accessibilityLabel={`Continue ${topic}`}
                    accessibilityRole="button"
                    onPress={onPress}
                    style={({ pressed }) => [
                      styles.continueButton,
                      pressed && styles.pressedButton,
                    ]}
                  >
                    <Text style={styles.continueLabel}>
                      {completedLessonCount > index ? "Review lesson" : "Start learning"}
                    </Text>
                    <AppIcon
                      color={Colors.background}
                      fallback="›"
                      name={{ android: "arrow_forward", ios: "arrow.right", web: "arrow_forward" }}
                      size={17}
                    />
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  moduleShell: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: "rgba(204,243,129,0.55)",
    backgroundColor: "#0F0F11",
    overflow: "hidden",
  },
  moduleHeader: {
    padding: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  moduleBadge: {
    width: 38,
    height: 38,
    borderRadius: Radius.sm,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  moduleBadgeText: {
    color: Colors.background,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "900",
  },
  moduleHeading: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  moduleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  moduleLabel: {
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    backgroundColor: "rgba(204,243,129,0.12)",
  },
  statusPillText: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  moduleTitle: {
    marginTop: 4,
    color: Colors.text,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  moduleDescription: {
    marginTop: 5,
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  timeline: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  lessonRow: {
    minHeight: 68,
    flexDirection: "row",
  },
  railColumn: {
    width: 30,
    alignItems: "center",
  },
  lessonNode: {
    zIndex: 1,
    width: 24,
    height: 24,
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#0F0F11",
    alignItems: "center",
    justifyContent: "center",
  },
  completeNode: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent,
  },
  currentNode: {
    borderColor: Colors.accent,
    backgroundColor: "rgba(204,243,129,0.1)",
  },
  nodeIndex: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "800",
  },
  currentNodeIndex: {
    color: Colors.accent,
  },
  rail: {
    flex: 1,
    width: 1,
    backgroundColor: Colors.border,
  },
  completeRail: {
    backgroundColor: Colors.accent,
  },
  lessonContent: {
    flex: 1,
    marginLeft: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  currentLesson: {
    marginBottom: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: "rgba(204,243,129,0.055)",
  },
  lessonEyebrow: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  currentLessonEyebrow: {
    color: Colors.accent,
  },
  lessonTitle: {
    marginTop: 4,
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  currentLessonTitle: {
    color: Colors.text,
    fontSize: 15,
  },
  continueButton: {
    minHeight: 42,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  continueLabel: {
    color: Colors.background,
    fontFamily: "monospace",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  pressedButton: {
    opacity: 0.78,
    transform: [{ scale: 0.98 }],
  },
  lockedCard: {
    minHeight: 72,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    flexDirection: "row",
    alignItems: "center",
    opacity: 0.62,
  },
  lockedIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  lockedCopy: {
    flex: 1,
    marginLeft: Spacing.md,
  },
  lockedLabel: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  lockedTitle: {
    marginTop: 3,
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  lockedCount: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 9,
  },
});
