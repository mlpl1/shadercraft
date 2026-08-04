import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { CourseModuleCard } from "../components/course-module-card";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useCourse } from "../context/course-context";
import { useProgress } from "../context/progress-context";
import { buildNavigationModel } from "../data/course/navigation-model";

export default function CourseScreen() {
  const router = useRouter();
  const { error: courseError, isHydrated: isCourseHydrated, modules, retry: retryCourse } = useCourse();
  const {
    error: progressError,
    isHydrated: isProgressHydrated,
    progress,
    progressPercent,
    retry: retryProgress,
  } = useProgress();

  const model = buildNavigationModel(modules, progress.completedLessonIds, isCourseHydrated);

  if (!isCourseHydrated) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safeArea}>
        <View style={styles.appFrame}>
          <View style={styles.header}>
            <Text style={styles.wordmark}>Shadercraft</Text>
            <Text style={styles.eyebrow}>Learning path</Text>
            <Text style={styles.title}>Curriculum</Text>
          </View>
          <View style={styles.loadingState}>
            {courseError ? (
              <>
                <Text style={styles.errorTitle}>Could not load curriculum</Text>
                <Text style={styles.errorBody}>{courseError.message}</Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={retryCourse}
                  style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.progressCaption}>Loading curriculum…</Text>
            )}
          </View>
          <BottomNavigation activeItem="course" />
        </View>
      </SafeAreaView>
    );
  }

  const unlockedModuleCount = model.modules.filter((module) => module.status !== "locked").length;
  const progressWidth = `${progressPercent}%` as `${number}%`;

  const openModule = (moduleId: string) => {
    const targetModule = model.modules.find((module) => module.id === moduleId);
    if (!targetModule) return;

    if (targetModule.status === "planned") {
      Alert.alert(
        "Coming next",
        `${targetModule.title} is unlocked. Its lessons are the next part of the course to build.`,
      );
      return;
    }

    const currentLesson =
      targetModule.lessons[targetModule.currentLessonIndex] ??
      targetModule.lessons[targetModule.lessons.length - 1];
    if (!currentLesson) return;

    router.push({ pathname: "/lesson", params: { lessonId: currentLesson.id } });
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
              {progressError ? (
                <Pressable accessibilityRole="button" onPress={retryProgress}>
                  <Text style={styles.progressRetry}>Retry</Text>
                </Pressable>
              ) : (
                <Text style={styles.progressValue}>
                  {isProgressHydrated ? `${progressPercent}%` : "—"}
                </Text>
              )}
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
            <View style={styles.progressFooter}>
              <Text style={styles.progressCaption}>
                {model.modules.length} modules · {model.publishedLessonCount} lessons
              </Text>
              <Text style={styles.progressCaption}>Self-paced</Text>
            </View>
          </View>

          <View style={styles.moduleHeadingRow}>
            <Text style={styles.moduleHeading}>Your learning path</Text>
            <Text style={styles.moduleCount}>
              {String(unlockedModuleCount).padStart(2, "0")} / {String(model.modules.length).padStart(2, "0")} available
            </Text>
          </View>

          <View style={styles.moduleList}>
            {model.modules.map((module) => (
              <CourseModuleCard
                completedLessonCount={module.completedLessonCount}
                currentLessonIndex={module.currentLessonIndex}
                description={module.description}
                key={module.id}
                lessonCount={module.lessonCount}
                moduleNumber={module.position}
                onPress={module.status === "locked" ? undefined : () => openModule(module.id)}
                status={module.status}
                title={module.title}
                topics={module.topics}
              />
            ))}
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
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
  },
  errorTitle: {
    color: Colors.coral,
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  errorBody: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  retryButton: {
    marginTop: Spacing.sm,
    minHeight: 42,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonPressed: {
    opacity: 0.78,
  },
  retryButtonText: {
    color: Colors.background,
    fontSize: 13,
    fontWeight: "800",
  },
  progressRetry: {
    color: Colors.coral,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "900",
    textTransform: "uppercase",
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
