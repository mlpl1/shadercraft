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

function StatusPill({ status, completed, total }: { status: TutorialViewModel["status"]; completed: number; total: number }) {
  if (status === "locked") return <Text style={[styles.pill, styles.pillLocked]}>Locked</Text>;
  if (status === "complete") return <Text style={[styles.pill, styles.pillComplete]}>Done</Text>;
  return <Text style={[styles.pill, styles.pillOpen]}>{completed}/{total}</Text>;
}

function TutorialRow({ tutorial, onPress }: { tutorial: TutorialViewModel; onPress: () => void }) {
  const locked = tutorial.status === "locked";
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: locked }} disabled={locked} onPress={onPress}
      style={({ pressed }) => [styles.row, locked && styles.rowLocked, pressed && styles.pressed]} testID={`tutorial-row-${tutorial.id}`}>
      <View style={styles.rowMarker}><Text style={styles.rowMarkerText}>{tutorial.modulePosition}</Text></View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{tutorial.title}</Text>
        <Text style={styles.rowSummary} numberOfLines={1}>{tutorial.summary}</Text>
        <Text style={styles.rowProgress}>Step {Math.min(tutorial.completedStepCount + 1, tutorial.stepCount)} of {tutorial.stepCount}</Text>
      </View>
      <View style={styles.rowMeta}>
        <StatusPill status={tutorial.status} completed={tutorial.completedStepCount} total={tutorial.stepCount} />
        {locked ? <Text style={styles.lockIcon}>Lock</Text> : <Text style={styles.chevron}>{">"}</Text>}
      </View>
    </Pressable>
  );
}

function ModuleCard({ module, onOpen }: { module: { moduleId: string; moduleTitle: string; modulePosition: number; status: TutorialViewModel["status"]; tutorials: TutorialViewModel[] }; onOpen: (tutorial: TutorialViewModel) => void }) {
  const completed = module.tutorials.filter((tutorial) => tutorial.status === "complete").length;
  const total = module.tutorials.length;
  const first = module.tutorials[0];
  return (
    <Pressable accessibilityRole="button" disabled={module.status === "locked"} onPress={() => { if (first && module.status !== "locked") onOpen(first); }} style={styles.moduleCard} testID={`tutorial-card-${first?.id ?? module.moduleId}`}>
      <View testID={`tutorial-module-${module.moduleId}`}>
        <View style={styles.moduleHeader}>
          <View style={styles.moduleHeading}>
            <Text style={styles.moduleEyebrow}>Module {module.modulePosition}</Text>
            <Text style={styles.moduleTitle}>{module.moduleTitle}</Text>
          </View>
          <Text style={styles.moduleProgress}>{completed}/{total}</Text>
        </View>
        <View style={styles.rows}>{module.tutorials.map((tutorial) => <TutorialRow key={tutorial.id} tutorial={tutorial} onPress={() => onOpen(tutorial)} />)}</View>
        {module.status === "locked" ? <Text style={styles.lockHint}>Finish {module.moduleTitle} to unlock this.</Text> : null}
      </View>
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
          model.modules.map((module) => (
            <ModuleCard key={module.moduleId} module={module} onOpen={(tutorial) => router.push({ pathname: "/tutorial", params: { tutorialId: tutorial.id, stepId: tutorial.resumeStepId } })} />
          ))
        )}
      </ScrollView>
      <BottomNavigation activeItem="tutorials" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xxl },
  title: { color: Colors.text, fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  lede: { color: Colors.textMuted, fontSize: 15, lineHeight: 22, marginBottom: Spacing.xs },
  empty: { color: Colors.textMuted, fontSize: 15, paddingVertical: Spacing.lg },
  moduleCard: { backgroundColor: Colors.surface, borderColor: Colors.border, borderRadius: Radius.lg, borderWidth: 1, overflow: "hidden" },
  moduleHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", padding: Spacing.md },
  moduleHeading: { gap: 3 },
  moduleEyebrow: { color: Colors.accent, fontSize: 11, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  moduleTitle: { color: Colors.text, fontSize: 20, fontWeight: "800" },
  moduleProgress: { color: Colors.textMuted, fontSize: 13, fontWeight: "800" },
  rows: { borderTopColor: Colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  row: { alignItems: "center", borderBottomColor: Colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: Spacing.sm, minHeight: 72, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  rowLocked: { opacity: 0.48 },
  rowMarker: { alignItems: "center", backgroundColor: Colors.surfaceRaised, borderRadius: Radius.sm, height: 30, justifyContent: "center", width: 30 },
  rowMarkerText: { color: Colors.textMuted, fontSize: 12, fontWeight: "800" },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { color: Colors.text, fontSize: 15, fontWeight: "800" },
  rowSummary: { color: Colors.textSubtle, fontSize: 12 },
  rowProgress: { color: Colors.textMuted, fontSize: 11, fontWeight: "700" },
  lockHint: { color: Colors.textSubtle, fontSize: 12, padding: Spacing.md, paddingTop: 0 },
  rowMeta: { alignItems: "flex-end", gap: 4 },
  chevron: { color: Colors.textMuted, fontSize: 18, fontWeight: "700" },
  lockIcon: { color: Colors.textSubtle, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  pressed: { backgroundColor: Colors.surfaceRaised },
  pill: { borderRadius: Radius.round, fontSize: 10, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3 },
  pillLocked: { backgroundColor: Colors.background, color: Colors.textSubtle },
  pillOpen: { backgroundColor: Colors.accent, color: Colors.background },
  pillComplete: { backgroundColor: Colors.accent, color: Colors.background },
});