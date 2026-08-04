import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { LessonRow } from "../components/lesson-row";
import { ShaderPreview } from "../components/shader-preview";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useCourse } from "../context/course-context";
import { useProgress } from "../context/progress-context";
import { buildNavigationModel } from "../data/course/navigation-model";

function padTwo(value: number): string {
  return String(value).padStart(2, "0");
}

export default function HomeScreen() {
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
  const progressWidth = `${progressPercent}%` as `${number}%`;

  if (!isCourseHydrated || !model.featuredModule || !model.featuredLesson) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safeArea}>
        <View style={styles.appFrame}>
          <View style={styles.header}>
            <View>
              <Text style={styles.sectionLabel}>Curriculum</Text>
              <Text style={styles.wordmark}>Shadercraft</Text>
            </View>
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
              <Text style={styles.progressLabel}>Loading curriculum…</Text>
            )}
          </View>
          <BottomNavigation activeItem="home" />
        </View>
      </SafeAreaView>
    );
  }

  const { featuredLesson, featuredModule } = model;
  const openLesson = (lessonId: string) =>
    router.push({ pathname: "/lesson", params: { lessonId } });

  const isAllPublishedComplete = featuredModule.status === "complete";
  const nextPlannedModule = model.modules.find((module) => module.status === "planned");
  const featuredIsComplete = featuredLesson.isComplete;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.appFrame}>
        <View style={styles.header}>
          <View>
            <Text style={styles.sectionLabel}>Curriculum</Text>
            <Text style={styles.wordmark}>Shadercraft</Text>
          </View>

          <View style={styles.progressSummary}>
            {progressError ? (
              <Pressable accessibilityRole="button" onPress={retryProgress}>
                <Text style={styles.progressRetry}>Retry</Text>
              </Pressable>
            ) : (
              <Text style={styles.progressLabel}>
                {isProgressHydrated ? `${progressPercent}% Complete` : "Loading progress…"}
              </Text>
            )}
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: progressWidth }]} />
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityLabel={`${featuredIsComplete ? "Review" : "Start"} ${featuredLesson.title}`}
            accessibilityRole="button"
            onPress={() => openLesson(featuredLesson.id)}
            style={({ pressed }) => [styles.continueCard, pressed && styles.pressedCard]}
          >
            <ShaderPreview />

            <View style={styles.cardBody}>
              <View style={styles.cardMetadata}>
                <Text style={styles.cardEyebrow}>
                  Module {padTwo(featuredLesson.modulePosition)} · Lesson{" "}
                  {padTwo(featuredLesson.lessonPosition)}
                </Text>
                <Text style={styles.currentLabel}>
                  {featuredIsComplete
                    ? "Completed"
                    : featuredLesson.lessonPosition > 1
                      ? "Continue"
                      : "Start here"}
                </Text>
              </View>
              <Text style={styles.lessonTitle}>{featuredLesson.title}</Text>
              <View style={styles.resumeButton}>
                <Text style={styles.resumeLabel}>
                  {featuredIsComplete
                    ? "Review Lesson"
                    : featuredLesson.lessonPosition > 1
                      ? "Continue Learning"
                      : "Start Lesson"}
                </Text>
              </View>
            </View>
          </Pressable>

          {model.isFirstModuleComplete && (
            <View style={styles.unlockedStack}>
              <Pressable
                accessibilityLabel="Open bonus Scanline S tutorial"
                accessibilityRole="button"
                onPress={() => router.push("/bonus-scanline")}
                style={({ pressed }) => [styles.bonusCard, pressed && styles.pressedCard]}
              >
                <Image
                  accessibilityIgnoresInvertColors
                  source={require("../../assets/images/scanline-s.png")}
                  style={styles.bonusImage}
                />
                <View style={styles.unlockedCopy}>
                  <Text style={styles.unlockedEyebrow}>Bonus tutorial</Text>
                  <Text style={styles.unlockedTitle}>Recreate the Scanline S</Text>
                  <Text style={styles.unlockedBody}>
                    Turn the Shadercraft logo into a procedural fragment shader.
                  </Text>
                </View>
                <Text style={styles.unlockedArrow}>→</Text>
              </Pressable>

              {isAllPublishedComplete && nextPlannedModule ? (
                <Pressable
                  accessibilityLabel={`Explore unlocked module ${padTwo(nextPlannedModule.position)}`}
                  accessibilityRole="button"
                  onPress={() => router.push("/course")}
                  style={({ pressed }) => [styles.unlockedCard, pressed && styles.pressedCard]}
                >
                  <View style={styles.unlockedCopy}>
                    <Text style={styles.unlockedEyebrow}>
                      Module {padTwo(nextPlannedModule.position)} unlocked
                    </Text>
                    <Text style={styles.unlockedTitle}>{nextPlannedModule.title}</Text>
                    <Text style={styles.unlockedBody}>
                      {featuredModule.title} is complete. Explore the next module in the course.
                    </Text>
                  </View>
                  <Text style={styles.unlockedArrow}>→</Text>
                </Pressable>
              ) : (
                <Pressable
                  accessibilityLabel={`Continue module ${padTwo(featuredModule.position)}`}
                  accessibilityRole="button"
                  onPress={() => openLesson(featuredLesson.id)}
                  style={({ pressed }) => [styles.unlockedCard, pressed && styles.pressedCard]}
                >
                  <View style={styles.unlockedCopy}>
                    <Text style={styles.unlockedEyebrow}>
                      Module {padTwo(featuredModule.position)} in progress
                    </Text>
                    <Text style={styles.unlockedTitle}>{featuredModule.title}</Text>
                    <Text style={styles.unlockedBody}>{featuredModule.description}</Text>
                  </View>
                  <Text style={styles.unlockedArrow}>→</Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.learningPath}>
            <Text style={styles.pathHeading}>Up next</Text>
            <View style={styles.lessonList}>
              {featuredModule.lessons.map((lesson) => (
                <LessonRow
                  key={lesson.id}
                  module={`Lesson ${padTwo(lesson.position)}`}
                  onPress={lesson.isUnlocked ? () => openLesson(lesson.id) : undefined}
                  state={lesson.isComplete ? "complete" : lesson.isUnlocked ? "active" : "locked"}
                  title={lesson.title}
                />
              ))}
            </View>
          </View>
        </ScrollView>

        <BottomNavigation activeItem="home" />
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionLabel: {
    color: Colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  wordmark: {
    marginTop: 2,
    color: Colors.text,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  progressSummary: {
    alignItems: "flex-end",
    gap: 6,
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
    fontSize: 12,
    fontWeight: "800",
    textAlign: "right",
  },
  progressLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  progressTrack: {
    width: 96,
    height: 4,
    overflow: "hidden",
    borderRadius: Radius.round,
    backgroundColor: Colors.border,
  },
  progressFill: {
    height: "100%",
    backgroundColor: Colors.accent,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: 40,
  },
  continueCard: {
    overflow: "hidden",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  pressedCard: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  cardBody: {
    padding: Spacing.xl,
  },
  cardMetadata: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  cardEyebrow: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.75,
    textTransform: "uppercase",
  },
  currentLabel: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "600",
  },
  lessonTitle: {
    maxWidth: 300,
    marginBottom: Spacing.lg,
    color: Colors.text,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.45,
    lineHeight: 28,
  },
  resumeButton: {
    minHeight: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  resumeLabel: {
    color: Colors.background,
    fontSize: 16,
    fontWeight: "800",
  },
  unlockedCard: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: "rgba(199,244,100,0.08)",
    flexDirection: "row",
    alignItems: "center",
  },
  unlockedStack: {
    marginTop: Spacing.lg,
    gap: Spacing.md,
  },
  bonusCard: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    flexDirection: "row",
    alignItems: "center",
  },
  bonusImage: {
    width: 68,
    height: 68,
    marginRight: Spacing.md,
    borderRadius: Radius.md,
  },
  unlockedCopy: {
    flex: 1,
  },
  unlockedEyebrow: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  unlockedTitle: {
    marginTop: 5,
    color: Colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  unlockedBody: {
    marginTop: 4,
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  unlockedArrow: {
    marginLeft: Spacing.md,
    color: Colors.accent,
    fontSize: 24,
  },
  learningPath: {
    marginTop: 38,
  },
  pathHeading: {
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.xs,
    color: Colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  lessonList: {
    gap: Spacing.md,
  },
});
