import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { TutorialSourceTemplate } from "../components/tutorial-source-template";
import { ShaderSandbox } from "../components/shader-sandbox";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useCourse } from "../context/course-context";
import { useData } from "../context/data-context";
import {
  fillTutorialTemplate,
  getCorrectTutorialSource,
  shuffleTutorialChoices,
} from "../data/course/tutorial-exercise";
import type { Tutorial, TutorialChoice, TutorialStep } from "../data/course/types";

const PREVIEW_HEIGHT = 150;
type Feedback = "idle" | "incorrect" | "correct" | "skipped";

function findTutorial(
  modules: ReturnType<typeof useCourse>["modules"],
  tutorialId: string,
): Tutorial | null {
  for (const module of modules) {
    const found = module.tutorials?.find((tutorial) => tutorial.id === tutorialId);
    if (found) return found;
  }
  return null;
}

export default function TutorialScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tutorialId?: string; stepId?: string }>();
  const { modules } = useCourse();
  const data = useData();
  const { profileId } = useAuth();
  const repository = data.status === "ready" ? data.tutorialProgressRepository : null;

  const tutorial = params.tutorialId ? findTutorial(modules, params.tutorialId) : null;
  const steps = useMemo(
    () => [...(tutorial?.steps ?? [])].sort((left, right) => left.position - right.position),
    [tutorial],
  );
  const [stepIndex, setStepIndex] = useState(0);
  const step: TutorialStep | undefined = steps[stepIndex];
  const [shuffledChoices, setShuffledChoices] = useState<TutorialChoice[]>([]);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>("idle");
  const [completedStepIds, setCompletedStepIds] = useState<ReadonlySet<string>>(new Set());

  // Land on the step the list asked for, once, rather than resetting every render.
  useEffect(() => {
    if (!params.stepId || steps.length === 0) return;
    const index = steps.findIndex((candidate) => candidate.id === params.stepId);
    if (index >= 0) setStepIndex(index);
  }, [params.stepId, steps]);

  useEffect(() => {
    if (!repository || !profileId || steps.length === 0) return;
    let cancelled = false;
    void repository.getStates(profileId, steps.map(({ id }) => id)).then((states) => {
      if (cancelled) return;
      setCompletedStepIds(
        new Set([...states.entries()].filter(([, state]) => state.completed).map(([id]) => id)),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [repository, profileId, steps]);

  // Choices are stable while a learner retries, but every new step (and every new screen visit)
  // gets its own randomized order.
  useEffect(() => {
    if (!step) return;
    setShuffledChoices(shuffleTutorialChoices(step.answerChoices));
    setSelectedChoiceId(null);
    setFeedback("idle");
  }, [step?.id]);

  if (!tutorial || !step) {
    return (
      <SafeAreaView edges={["top"]} style={styles.screen}>
        <Text style={styles.missing}>That exercise is not in this release.</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondary}>
          <Text style={styles.secondaryLabel}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const selectedChoice = shuffledChoices.find((choice) => choice.id === selectedChoiceId);
  const targetSource = getCorrectTutorialSource(step);
  const learnerSource = selectedChoice
    ? fillTutorialTemplate(step.sourceTemplate, selectedChoice.fragment)
    : null;
  const isComplete = completedStepIds.has(step.id);

  const completeStep = () => {
    setCompletedStepIds((current) => new Set(current).add(step.id));
    if (repository && profileId) {
      void repository.setCompleted(profileId, step.id, true);
    }
  };

  const checkAnswer = () => {
    if (!selectedChoice) return;
    if (selectedChoice.id === step.correctChoiceId) {
      setFeedback("correct");
      completeStep();
      return;
    }
    setFeedback("incorrect");
  };

  const skipAndReveal = () => {
    setSelectedChoiceId(step.correctChoiceId);
    setFeedback("skipped");
    completeStep();
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.back()}>
          <Text style={styles.back}>Ã¢â‚¬Â¹ {tutorial.title}</Text>
        </Pressable>

        <Text style={styles.stepCount}>
          Step {step.position} of {steps.length}
        </Text>
        <View style={styles.titleRow}>
          <Text style={styles.stepTitle}>{step.title}</Text>
          {isComplete ? <Text style={styles.completed}>Completed</Text> : null}
        </View>
        <Text style={styles.brief}>{step.brief}</Text>

        <View style={styles.previews}>
          <View style={styles.preview}>
            <Text style={styles.previewLabel}>Target</Text>
            <ShaderSandbox
              height={PREVIEW_HEIGHT}
              helpers={step.helpers}
              source={targetSource}

            />
          </View>
          <View style={styles.preview}>
            <Text style={styles.previewLabel}>Yours</Text>
            {learnerSource ? (
              <ShaderSandbox
                height={PREVIEW_HEIGHT}
                helpers={step.helpers}
                source={learnerSource}

              />
            ) : (
              <View accessibilityLabel="Choose an answer to preview your shader" style={styles.emptyPreview}>
                <Text style={styles.emptyPreviewLabel}>Choose an answer</Text>
              </View>
            )}
          </View>
        </View>

        <TutorialSourceTemplate
          selectedFragment={selectedChoice?.fragment}
          template={step.sourceTemplate}
        />

        <View style={styles.choices}>
          {shuffledChoices.map((choice) => {
            const selected = choice.id === selectedChoiceId;
            const isIncorrect = selected && feedback === "incorrect";
            const isCorrect = selected && (feedback === "correct" || feedback === "skipped");
            return (
              <Pressable
                accessibilityLabel={choice.fragment}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                key={choice.id}
                onPress={() => {
                  setSelectedChoiceId(choice.id);
                  setFeedback("idle");
                }}
                style={({ pressed }) => [
                  styles.choice,
                  selected && styles.choiceSelected,
                  isIncorrect && styles.choiceIncorrect,
                  isCorrect && styles.choiceCorrect,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.choiceText}>{choice.fragment}</Text>
                {selected ? <Text style={styles.choiceStatus}>Selected</Text> : null}
                {isIncorrect ? <Text style={styles.choiceStatus}>Incorrect answer</Text> : null}
                {isCorrect ? <Text style={styles.choiceStatus}>Correct answer</Text> : null}
              </Pressable>
            );
          })}
        </View>

        {feedback === "incorrect" ? <Text style={styles.incorrectFeedback}>Not quite</Text> : null}
        {feedback === "correct" ? <Text style={styles.correctFeedback}>Correct</Text> : null}
        {feedback === "skipped" ? <Text style={styles.skippedFeedback}>Skipped</Text> : null}

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !selectedChoice }}
            disabled={!selectedChoice}
            onPress={checkAnswer}
            style={({ pressed }) => [
              styles.primary,
              !selectedChoice && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.primaryLabel}>Check answer</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={skipAndReveal}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryLabel}>Skip and reveal answer</Text>
          </Pressable>
        </View>

        {step.hint && feedback === "idle" ? <Text style={styles.hint}>Hint: {step.hint}</Text> : null}

        <View style={styles.stepNav}>
          <Pressable
            accessibilityRole="button"
            disabled={stepIndex === 0}
            onPress={() => setStepIndex((index) => Math.max(0, index - 1))}
            style={({ pressed }) => [
              styles.secondary,
              stepIndex === 0 && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.secondaryLabel}>Previous</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={stepIndex >= steps.length - 1}
            onPress={() => setStepIndex((index) => Math.min(steps.length - 1, index + 1))}
            style={({ pressed }) => [
              styles.secondary,
              stepIndex >= steps.length - 1 && styles.disabled,
              pressed && styles.pressed,
            ]}
            testID="tutorial-next-step"
          >
            <Text style={styles.secondaryLabel}>Next step</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: {
    padding: Spacing.lg,
    gap: Spacing.md,
    paddingBottom: Spacing.xxxl,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  missing: { color: Colors.textMuted, fontSize: 15, padding: Spacing.lg },
  back: { color: Colors.textMuted, fontSize: 14, fontWeight: "600" },
  stepCount: {
    color: Colors.textSubtle,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  stepTitle: { color: Colors.text, flex: 1, fontSize: 22, fontWeight: "800" },
  completed: { color: Colors.accent, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  brief: { color: Colors.textMuted, fontSize: 15, lineHeight: 22 },
  previews: { flexDirection: "row", gap: Spacing.sm },
  preview: { flex: 1, gap: 4 },
  previewLabel: {
    color: Colors.textSubtle,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  emptyPreview: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    height: PREVIEW_HEIGHT,
    justifyContent: "center",
    padding: Spacing.sm,
  },
  emptyPreviewLabel: { color: Colors.textMuted, fontSize: 13, fontWeight: "700", textAlign: "center" },
  choices: { gap: Spacing.sm },
  choice: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    borderWidth: 1,
    gap: 2,
    padding: Spacing.md,
  },
  choiceSelected: { borderColor: Colors.cyan, borderWidth: 2 },
  choiceIncorrect: { borderColor: Colors.coral },
  choiceCorrect: { borderColor: Colors.accent },
  choiceText: { color: Colors.text, fontFamily: "monospace", fontSize: 15, fontWeight: "800" },
  choiceStatus: { color: Colors.textMuted, fontSize: 12, fontWeight: "700" },
  actions: { flexDirection: "row", gap: Spacing.sm },
  stepNav: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.xs },
  primary: {
    alignItems: "center",
    backgroundColor: Colors.accent,
    borderRadius: Radius.sm,
    flex: 1,
    paddingVertical: Spacing.md,
  },
  primaryLabel: { color: Colors.background, fontSize: 15, fontWeight: "800" },
  secondary: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    flex: 1,
    paddingVertical: Spacing.md,
  },
  secondaryLabel: { color: Colors.text, fontSize: 15, fontWeight: "700", textAlign: "center" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  hint: { color: Colors.textSubtle, fontSize: 14, lineHeight: 20 },
  incorrectFeedback: { color: Colors.coral, fontSize: 15, fontWeight: "800", textAlign: "center" },
  correctFeedback: { color: Colors.accent, fontSize: 15, fontWeight: "800", textAlign: "center" },
  skippedFeedback: { color: Colors.textMuted, fontSize: 15, fontWeight: "800", textAlign: "center" },
});