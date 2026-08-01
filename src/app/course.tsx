import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { CourseModuleCard } from "../components/course-module-card";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useProgress } from "../context/progress-context";
import { COORDINATE_SYSTEMS_LESSON_ID } from "../lib/progress";

const modules = [
  {
    moduleNumber: 1,
    title: "Coordinate Foundations",
    description:
      "Build a reliable coordinate space for every fragment and learn how resolution shapes the image.",
    lessonCount: 6,
    topics: [
      "Coordinate Systems & UV Space",
      "Centering & Aspect Ratio",
      "Drawing with Distance",
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
  const { hasCompletedLesson, isHydrated, progressPercent } = useProgress();
  const hasCompletedFirstLesson = hasCompletedLesson(COORDINATE_SYSTEMS_LESSON_ID);
  const unlockedModuleCount = hasCompletedFirstLesson ? 2 : 1;
  const progressWidth = `${progressPercent}%` as `${number}%`;

  const getModuleStatus = (
    moduleNumber: number,
  ): "available" | "in-progress" | "locked" => {
    if (moduleNumber === 1) {
      return hasCompletedFirstLesson ? "in-progress" : "available";
    }

    if (moduleNumber === 2 && hasCompletedFirstLesson) return "available";
    return "locked";
  };

  const openModule = (moduleNumber: number) => {
    if (moduleNumber === 1) {
      router.push("/lesson");
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
          <Text style={styles.eyebrow}>Curriculum</Text>
          <Text style={styles.title}>The shader path</Text>
          <Text style={styles.subtitle}>4 modules · 20 lessons · self-paced</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.overviewCard}>
            <View style={styles.overviewHeader}>
              <Text style={styles.overviewLabel}>Foundation track</Text>
              <Text style={styles.overviewProgress}>
                {isHydrated ? `${progressPercent}%` : "—"}
              </Text>
            </View>
            <Text style={styles.overviewTitle}>Fragment Shader Fundamentals</Text>
            <Text style={styles.overviewCopy}>
              Learn the visual language of fragment shaders one concept at a time, from
              coordinates to animated procedural texture.
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
          </View>

          <View style={styles.moduleHeadingRow}>
            <Text style={styles.moduleHeading}>Modules</Text>
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
                    module.moduleNumber === 1 && hasCompletedFirstLesson ? 1 : 0
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
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  eyebrow: {
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 5,
    color: Colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.7,
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
    height: 4,
    marginTop: Spacing.lg,
    overflow: "hidden",
    borderRadius: Radius.round,
    backgroundColor: Colors.border,
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.accent,
  },
  moduleHeadingRow: {
    marginTop: Spacing.xxxl,
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  moduleHeading: {
    color: Colors.textSubtle,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  moduleCount: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 10,
  },
  moduleList: {
    gap: Spacing.md,
  },
});
