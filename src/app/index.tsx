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
import { useProgress } from "../context/progress-context";
import {
  getCurrentModuleOneLesson,
  getCurrentModuleThreeLesson,
  getCurrentModuleTwoLesson,
  isModuleOneComplete,
  isModuleThreeComplete,
  isModuleTwoComplete,
  MODULE_ONE_LESSONS,
  MODULE_THREE_LESSONS,
  MODULE_TWO_LESSONS,
} from "../lib/curriculum";

export default function HomeScreen() {
  const router = useRouter();
  const { hasCompletedLesson, isHydrated, progress, progressPercent } = useProgress();
  const hasCompletedModuleOne = isModuleOneComplete(progress.completedLessonIds);
  const hasCompletedModuleTwo = isModuleTwoComplete(progress.completedLessonIds);
  const hasCompletedModuleThree = isModuleThreeComplete(progress.completedLessonIds);
  const featuredLessons = hasCompletedModuleTwo
    ? MODULE_THREE_LESSONS
    : hasCompletedModuleOne
      ? MODULE_TWO_LESSONS
      : MODULE_ONE_LESSONS;
  const featuredLesson = hasCompletedModuleTwo
    ? getCurrentModuleThreeLesson(progress.completedLessonIds)
    : hasCompletedModuleOne
      ? getCurrentModuleTwoLesson(progress.completedLessonIds)
      : getCurrentModuleOneLesson(progress.completedLessonIds);
  const featuredLessonIndex = featuredLessons.findIndex(
    (lesson) => lesson.id === featuredLesson.id,
  );
  const featuredModuleNumber = hasCompletedModuleTwo ? 3 : hasCompletedModuleOne ? 2 : 1;
  const featuredPathname = hasCompletedModuleTwo
    ? "/module-three-lesson"
    : hasCompletedModuleOne
      ? "/module-two-lesson"
      : "/lesson";
  const featuredIsComplete = hasCompletedLesson(featuredLesson.id);
  const progressWidth = `${progressPercent}%` as `${number}%`;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.appFrame}>
        <View style={styles.header}>
          <View>
            <Text style={styles.sectionLabel}>Curriculum</Text>
            <Text style={styles.wordmark}>Shadercraft</Text>
          </View>

          <View style={styles.progressSummary}>
            <Text style={styles.progressLabel}>
              {isHydrated ? `${progressPercent}% Complete` : "Loading progress…"}
            </Text>
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
            onPress={() =>
              router.push({
                pathname: featuredPathname,
                params: { lessonId: featuredLesson.id },
              })
            }
            style={({ pressed }) => [styles.continueCard, pressed && styles.pressedCard]}
          >
            <ShaderPreview />

            <View style={styles.cardBody}>
              <View style={styles.cardMetadata}>
                <Text style={styles.cardEyebrow}>
                  Module {String(featuredModuleNumber).padStart(2, "0")} · Lesson {String(featuredLessonIndex + 1).padStart(2, "0")}
                </Text>
                <Text style={styles.currentLabel}>
                  {featuredIsComplete ? "Completed" : featuredLessonIndex > 0 ? "Continue" : "Start here"}
                </Text>
              </View>
              <Text style={styles.lessonTitle}>{featuredLesson.title}</Text>
              <View style={styles.resumeButton}>
                <Text style={styles.resumeLabel}>
                  {featuredIsComplete ? "Review Lesson" : featuredLessonIndex > 0 ? "Continue Learning" : "Start Lesson"}
                </Text>
              </View>
            </View>
          </Pressable>

          {hasCompletedModuleOne && (
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

              <Pressable
                accessibilityLabel={
                  hasCompletedModuleThree
                    ? "Explore unlocked Module 4"
                    : hasCompletedModuleTwo
                      ? "Continue Module 3"
                      : "Continue Module 2"
                }
                accessibilityRole="button"
                onPress={() =>
                  hasCompletedModuleThree
                    ? router.push("/course")
                    : hasCompletedModuleTwo
                      ? router.push({
                          pathname: "/module-three-lesson",
                          params: { lessonId: getCurrentModuleThreeLesson(progress.completedLessonIds).id },
                        })
                      : router.push({
                          pathname: "/module-two-lesson",
                          params: { lessonId: getCurrentModuleTwoLesson(progress.completedLessonIds).id },
                        })
                }
                style={({ pressed }) => [styles.unlockedCard, pressed && styles.pressedCard]}
              >
                <View style={styles.unlockedCopy}>
                  <Text style={styles.unlockedEyebrow}>
                    {hasCompletedModuleThree
                      ? "Module 04 unlocked"
                      : hasCompletedModuleTwo
                        ? "Module 03 in progress"
                        : "Module 02 in progress"}
                  </Text>
                  <Text style={styles.unlockedTitle}>
                    {hasCompletedModuleThree
                      ? "Procedural Textures"
                      : hasCompletedModuleTwo
                        ? "Color & Light"
                        : "Shape Synthesis"}
                  </Text>
                  <Text style={styles.unlockedBody}>
                    {hasCompletedModuleThree
                      ? "Color & Light is complete. Explore the next module in the course."
                      : hasCompletedModuleTwo
                        ? "Turn scalar fields into expressive palettes, contrast, and light."
                        : "Continue building procedural geometry from reusable distance fields."}
                  </Text>
                </View>
                <Text style={styles.unlockedArrow}>→</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.learningPath}>
            <Text style={styles.pathHeading}>Up next</Text>
            <View style={styles.lessonList}>
              {featuredLessons.map((lesson, index) => {
                const complete = hasCompletedLesson(lesson.id);
                const unlocked =
                  index === 0 ||
                  progress.completedLessonIds.includes(featuredLessons[index - 1].id);

                return (
                  <LessonRow
                    key={lesson.id}
                    module={`Lesson ${String(index + 1).padStart(2, "0")}`}
                    onPress={
                      !unlocked
                        ? undefined
                        : () =>
                            router.push({
                              pathname: featuredPathname,
                              params: { lessonId: lesson.id },
                            })
                    }
                    state={complete ? "complete" : unlocked ? "active" : "locked"}
                    title={lesson.title}
                  />
                );
              })}
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
