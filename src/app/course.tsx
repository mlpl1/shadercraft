import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { CourseModuleCard } from "../components/course-module-card";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useProgress } from "../context/progress-context";
import {
  getCurrentModuleOneLesson,
  getModuleOneCompletedCount,
  isModuleOneComplete,
  MODULE_ONE_LESSONS,
} from "../lib/curriculum";

const modules = [
  {
    moduleNumber: 1,
    title: "Coordinate Foundations",
    description:
      "Build a reliable coordinate space for every fragment and learn how resolution shapes the image.",
    lessonCount: 5,
    topics: [
      "Coordinate Systems & UV Space",
      "Colors & Fragment Output",
      "Uniforms & Time",
      "Transforming UVs",
      "Foundation Challenge",
    ],
  },
  {
    moduleNumber: 2,
    title: "Shape Synthesis",
    description:
      "Turn distance fields into clean geometric forms with thresholds, smooth edges, and composition.",
    lessonCount: 5,
    topics: ["Step & Smoothstep", "Circles and Boxes", "Boolean Shape Operations"],
  },
  {
    moduleNumber: 3,
    title: "Color & Light",
    description:
      "Mix palettes, understand luminance, and shape color with reusable procedural functions.",
    lessonCount: 4,
    topics: ["Color Mixing", "Luma & Contrast", "Procedural Palettes"],
  },
  {
    moduleNumber: 4,
    title: "Procedural Textures",
    description:
      "Combine repetition, noise, and motion to create expressive surfaces entirely in code.",
    lessonCount: 5,
    topics: ["Tiling Space", "Value Noise", "Layered Motion"],
  },
];

export default function CourseScreen() {
  const router = useRouter();
  const { isHydrated, progress, progressPercent } = useProgress();
  const moduleOneCompletedCount = getModuleOneCompletedCount(progress.completedLessonIds);
  const hasCompletedModuleOne = isModuleOneComplete(progress.completedLessonIds);
  const unlockedModuleCount = hasCompletedModuleOne ? 2 : 1;
  const progressWidth = `${progressPercent}%` as `${number}%`;
  const currentModuleOneLesson = getCurrentModuleOneLesson(progress.completedLessonIds);
  const currentModuleOneLessonIndex = MODULE_ONE_LESSONS.findIndex(
    (lesson) => lesson.id === currentModuleOneLesson.id,
  );

  const getModuleStatus = (
    moduleNumber: number,
  ): "available" | "in-progress" | "complete" | "locked" => {
    if (moduleNumber === 1) {
      if (hasCompletedModuleOne) return "complete";
      return moduleOneCompletedCount > 0 ? "in-progress" : "available";
    }

    if (moduleNumber === 2 && hasCompletedModuleOne) return "available";
    return "locked";
  };

  const openModule = (moduleNumber: number) => {
    if (moduleNumber === 1) {
      const currentLesson = getCurrentModuleOneLesson(progress.completedLessonIds);
      router.push({ pathname: "/lesson", params: { lessonId: currentLesson.id } });
      return;
    }

    Alert.alert(
      "Module unlocked",
      "Shape Synthesis is ready. Its first lesson will be added in the next content pass.",
    );
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.appFrame}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>Shadercraft</Text>
          <Text style={styles.eyebrow}>Learning path</Text>
          <Text style={styles.title}>Curriculum</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.progressPanel}>
            <View style={styles.progressHeader}>
              <View>
                <Text style={styles.progressEyebrow}>Track progress</Text>
                <Text style={styles.progressTitle}>Fragment shader fundamentals</Text>
              </View>
              <Text style={styles.progressValue}>
                {isHydrated ? `${progressPercent}%` : "—"}
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            <View style={styles.progressFooter}>
              <Text style={styles.progressCaption}>4 modules · 19 lessons</Text>
              <Text style={styles.progressCaption}>Self-paced</Text>
            </View>
          </View>

          <View style={styles.moduleHeadingRow}>
            <Text style={styles.moduleHeading}>Your learning path</Text>
            <Text style={styles.moduleCount}>
              {String(unlockedModuleCount).padStart(2, "0")} / 04 available
            </Text>
          </View>

          <View style={styles.moduleList}>
            {modules.map((module) => {
              const status = getModuleStatus(module.moduleNumber);

              return (
                <CourseModuleCard
                  {...module}
                  completedLessonCount={
                    module.moduleNumber === 1 ? moduleOneCompletedCount : 0
                  }
                  currentLessonIndex={
                    module.moduleNumber === 1
                      ? hasCompletedModuleOne
                        ? -1
                        : currentModuleOneLessonIndex
                      : 0
                  }
                  key={module.moduleNumber}
                  onPress={
                    status === "locked"
                      ? undefined
                      : () => openModule(module.moduleNumber)
                  }
                  status={status}
                />
              );
            })}
          </View>
        </ScrollView>

        <BottomNavigation activeItem="course" />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  appFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  wordmark: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  eyebrow: {
    marginTop: Spacing.xxl,
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 3,
    color: Colors.text,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1,
  },
  subtitle: {
    marginTop: 6,
    color: Colors.textMuted,
    fontSize: 13,
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: 40,
  },
  progressPanel: {
    padding: Spacing.lg,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressEyebrow: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  progressTitle: {
    marginTop: 4,
    color: Colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  progressValue: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 18,
    fontWeight: "900",
  },
  progressFooter: {
    marginTop: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressCaption: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 8,
    textTransform: "uppercase",
  },
  overviewCard: {
    padding: Spacing.xl,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  overviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  overviewLabel: {
    color: Colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  overviewProgress: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
  },
  overviewTitle: {
    marginTop: Spacing.md,
    color: Colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  overviewCopy: {
    marginTop: Spacing.sm,
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
  progressTrack: {
    height: 5,
    marginTop: Spacing.md,
    overflow: "hidden",
    borderRadius: Radius.sm,
    backgroundColor: Colors.border,
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.accent,
  },
  moduleHeadingRow: {
    marginTop: Spacing.xxl,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moduleHeading: {
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  moduleCount: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 9,
  },
  moduleList: {
    gap: Spacing.sm,
  },
});
