import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useCourse } from "../context/course-context";
import { useData } from "../context/data-context";
import { useProgress } from "../context/progress-context";
import { buildTutorialsModel, type TutorialViewModel } from "../data/course/tutorial-model";

function StatusPill({ tutorial }: { tutorial: TutorialViewModel }) {
  if (tutorial.status === "locked") {
    return <Text style={[styles.pill, styles.pillLocked]}>Locked</Text>;
  }
  if (tutorial.status === "complete") {
    return <Text style={[styles.pill, styles.pillComplete]}>Done</Text>;
  }
  return (
    <Text style={[styles.pill, styles.pillOpen]}>
      {tutorial.completedStepCount}/{tutorial.stepCount}
    </Text>
  );
}

function TutorialCard({
  onPress,
  tutorial,
}: {
  onPress: () => void;
  tutorial: TutorialViewModel;
}) {
  const locked = tutorial.status === "locked";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
      disabled={locked}
      onPress={onPress}
      style={({ pressed }) => [styles.card, locked && styles.cardLocked, pressed && styles.pressed]}
      testID={`tutorial-card-${tutorial.id}`}
    >
      <View style={styles.cardHeader}>
        <Text style={styles.cardEyebrow}>
          Module {tutorial.modulePosition} · {tutorial.moduleTitle}
        </Text>
        <StatusPill tutorial={tutorial} />
      </View>
      <Text style={styles.cardTitle}>{tutorial.title}</Text>
      <Text style={styles.cardSummary}>{tutorial.summary}</Text>
      {locked ? (
        // Says what to do about it. "Locked" alone reads as a paywall rather than an ordering.
        <Text style={styles.cardHint}>
          Finish {tutorial.moduleTitle} to unlock this.
        </Text>
      ) : null}
    </Pressable>
  );
}

export default function TutorialsScreen() {
  const router = useRouter();
  const { isHydrated: isCourseHydrated, modules } = useCourse();
  const { progress } = useProgress();
  const data = useData();
  const { profileId } = useAuth();
  const tutorialProgressRepository =
    data.status === "ready" ? data.tutorialProgressRepository : null;
  const [completedStepIds, setCompletedStepIds] = useState<ReadonlySet<string>>(new Set());

  const reload = useCallback(() => {
    let cancelled = false;
    if (!tutorialProgressRepository || !profileId) return;
    void tutorialProgressRepository.getCompletedStepIds(profileId).then((ids) => {
      if (!cancelled) setCompletedStepIds(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId, tutorialProgressRepository]);

  useEffect(reload, [reload]);
  // Step completion changes inside the workspace, so this list is stale by the time a learner
  // navigates back to it unless it re-reads on focus.
  useFocusEffect(reload);

  const model = buildTutorialsModel(modules, progress.completedLessonIds, completedStepIds);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Practice</Text>
        <Text style={styles.lede}>
          Lessons show you how something works. These ask you to build it. Each one unlocks when you
          finish the module it draws on.
        </Text>

        {!isCourseHydrated ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : model.tutorials.length === 0 ? (
          <Text style={styles.empty}>No exercises yet.</Text>
        ) : (
          model.tutorials.map((tutorial) => (
            <TutorialCard
              key={tutorial.id}
              onPress={() =>
                router.push({
                  pathname: "/tutorial",
                  params: { tutorialId: tutorial.id, stepId: tutorial.resumeStepId },
                })
              }
              tutorial={tutorial}
            />
          ))
        )}
      </ScrollView>
      <BottomNavigation activeItem="tutorials" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  title: { color: Colors.text, fontSize: 28, fontWeight: "800" },
  lede: { color: Colors.textMuted, fontSize: 15, lineHeight: 22, marginBottom: Spacing.xs },
  empty: { color: Colors.textMuted, fontSize: 15, paddingVertical: Spacing.lg },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: 6,
  },
  cardLocked: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardEyebrow: {
    color: Colors.textSubtle,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  cardTitle: { color: Colors.text, fontSize: 18, fontWeight: "700" },
  cardSummary: { color: Colors.textMuted, fontSize: 14, lineHeight: 20 },
  cardHint: { color: Colors.textSubtle, fontSize: 13, marginTop: 2 },
  pill: {
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  pillLocked: { color: Colors.textSubtle, backgroundColor: Colors.background },
  pillOpen: { color: Colors.background, backgroundColor: Colors.accent },
  pillComplete: { color: Colors.background, backgroundColor: Colors.accent },
});
