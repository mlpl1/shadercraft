import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { LessonWorkspace } from "../components/lesson-workspace";
import { Colors } from "../constants/theme";
import { useCourse } from "../context/course-context";
import { useProgress } from "../context/progress-context";
import { isLessonUnlocked, isModuleUnlocked } from "../data/course/domain";
import { buildNavigationModel } from "../data/course/navigation-model";
import type { CourseLesson, CourseModule } from "../data/course/types";

type LessonTarget = {
  lesson: CourseLesson;
  lessonCount: number;
  lessonIndex: number;
  module: CourseModule;
};

function orderedLessons(module: CourseModule): CourseLesson[] {
  return [...module.lessons].sort((left, right) => left.position - right.position);
}

function findTarget(
  modules: readonly CourseModule[],
  lessonId: string | undefined,
): LessonTarget | null {
  if (!lessonId) return null;

  for (const module of modules) {
    const lessons = orderedLessons(module);
    const lessonIndex = lessons.findIndex((lesson) => lesson.id === lessonId);

    if (lessonIndex >= 0) {
      return {
        lesson: lessons[lessonIndex],
        lessonCount: lessons.length,
        lessonIndex,
        module,
      };
    }
  }

  return null;
}

function isOpenable(
  modules: readonly CourseModule[],
  target: LessonTarget,
  completedLessonIds: readonly string[],
): boolean {
  return (
    target.module.status === "published" &&
    isModuleUnlocked(modules, target.module.id, completedLessonIds) &&
    isLessonUnlocked(target.lesson, target.module.lessons, completedLessonIds)
  );
}

/**
 * Resolves which lesson the route should render. A requested lesson only opens when its module is
 * published and both the module and the lesson are unlocked by the sequential rules in
 * `../data/course/domain`; anything else (a locked deep link, an unknown ID, a planned module)
 * falls back to the learner's current unlocked lesson.
 */
function resolveLessonTarget(
  modules: readonly CourseModule[],
  completedLessonIds: readonly string[],
  requestedLessonId: string | undefined,
): LessonTarget | null {
  const requested = findTarget(modules, requestedLessonId);
  if (requested && isOpenable(modules, requested, completedLessonIds)) {
    return requested;
  }

  const { featuredLesson } = buildNavigationModel(modules, completedLessonIds, true);
  return findTarget(modules, featuredLesson?.id);
}

export default function LessonScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lessonId?: string }>();
  const { isHydrated: isCourseHydrated, modules } = useCourse();
  const {
    completeLesson,
    hasCompletedLesson,
    isHydrated: isProgressHydrated,
    progress,
    progressPercent,
    uncompleteLesson,
  } = useProgress();

  const isHydrated = isCourseHydrated && isProgressHydrated;
  const target = isHydrated
    ? resolveLessonTarget(modules, progress.completedLessonIds, params.lessonId)
    : null;

  if (!target) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <View style={styles.statusState}>
          <Text style={styles.statusText}>
            {isHydrated ? "This lesson is not available yet." : "Loading lesson…"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const { lesson, lessonCount, lessonIndex, module } = target;
  const nextLesson = orderedLessons(module)[lessonIndex + 1];

  return (
    <LessonWorkspace
      completed={hasCompletedLesson(lesson.id)}
      hydrated={isProgressHydrated}
      lesson={lesson}
      lessonCount={lessonCount}
      lessonIndex={lessonIndex}
      modulePosition={module.position}
      moduleTitle={module.title}
      onBack={() => router.back()}
      onComplete={() => completeLesson(lesson.id)}
      onNext={() => {
        if (nextLesson) {
          router.replace({ pathname: "/lesson", params: { lessonId: nextLesson.id } });
        } else {
          router.replace("/course");
        }
      }}
      onUndo={() => uncompleteLesson(lesson.id)}
      progressPercent={progressPercent}
    />
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  statusState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  statusText: {
    color: Colors.textMuted,
    fontSize: 13,
  },
});
