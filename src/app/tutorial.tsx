import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { TutorialActionDock } from "../components/tutorial-action-dock";
import { TutorialAnswerTile, type TutorialAnswerStatus } from "../components/tutorial-answer-tile";
import { TutorialFeedback } from "../components/tutorial-feedback";
import { TutorialProgressRail } from "../components/tutorial-progress-rail";
import { TutorialSourceTemplate } from "../components/tutorial-source-template";
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

type Feedback = "idle" | "incorrect" | "correct" | "skipped";
type CompletionState = {
  profileId: string | null;
  stepIdsKey: string;
  fetchedStepIds: ReadonlySet<string>;
  optimisticStepIds: ReadonlySet<string>;
};

const CHOICE_MARKERS = ["A", "B", "C", "D"] as const;

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
  const stepIds = useMemo(() => steps.map(({ id }) => id), [steps]);
  const stepIdsKey = stepIds.join("\u0000");
  const [stepIndex, setStepIndex] = useState(0);
  const step: TutorialStep | undefined = steps[stepIndex];
  const [shuffledChoices, setShuffledChoices] = useState<TutorialChoice[]>([]);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [confirmedChoiceId, setConfirmedChoiceId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>("idle");
  const [hintVisible, setHintVisible] = useState(false);
  const [completionState, setCompletionState] = useState<CompletionState>({
    profileId: null,
    stepIdsKey: "",
    fetchedStepIds: new Set(),
    optimisticStepIds: new Set(),
  });
  const stepAnswerChoices = step?.answerChoices;
  const stepId = step?.id;

  useEffect(() => {
    if (!params.stepId || steps.length === 0) return;
    const index = steps.findIndex((candidate) => candidate.id === params.stepId);
    if (index >= 0) setStepIndex(index);
  }, [params.stepId, steps]);

  useEffect(() => {
    if (!repository || !profileId || stepIds.length === 0) return;
    let cancelled = false;
    void repository.getStates(profileId, stepIds).then((states) => {
      if (cancelled) return;
      const fetchedStepIds = new Set(
        [...states.entries()].filter(([, state]) => state.completed).map(([id]) => id),
      );
      setCompletionState((current) => ({
        profileId,
        stepIdsKey,
        fetchedStepIds,
        optimisticStepIds:
          current.profileId === profileId && current.stepIdsKey === stepIdsKey
            ? current.optimisticStepIds
            : new Set(),
      }));
    });
    return () => {
      cancelled = true;
    };
  }, [repository, profileId, stepIds, stepIdsKey]);

  useEffect(() => {
    if (!stepAnswerChoices) return;
    setShuffledChoices(shuffleTutorialChoices(stepAnswerChoices));
    setSelectedChoiceId(null);
    setConfirmedChoiceId(null);
    setFeedback("idle");
    setHintVisible(false);
  }, [stepAnswerChoices, stepId]);

  if (!tutorial || !step) {
    return (
      <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
        <Text style={styles.missing}>That exercise is not in this release.</Text>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.secondaryButton}>
          <Text style={styles.secondaryLabel}>Back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const selectedChoice = shuffledChoices.find((choice) => choice.id === selectedChoiceId);
  const confirmedChoice = shuffledChoices.find((choice) => choice.id === confirmedChoiceId);
  const targetSource = getCorrectTutorialSource(step);
  const learnerSource = confirmedChoice
    ? fillTutorialTemplate(step.sourceTemplate, confirmedChoice.fragment)
    : null;
  const completionStateMatchesScreen =
    completionState.profileId === profileId && completionState.stepIdsKey === stepIdsKey;
  const completedStepIds = completionStateMatchesScreen
    ? new Set([...completionState.fetchedStepIds, ...completionState.optimisticStepIds])
    : new Set<string>();
  const terminalFeedback = feedback === "correct" || feedback === "skipped";
  const isComplete = completedStepIds.has(step.id);

  const completeStep = () => {
    setCompletionState((current) => {
      const carriesCurrentState =
        current.profileId === profileId && current.stepIdsKey === stepIdsKey;
      return {
        profileId,
        stepIdsKey,
        fetchedStepIds: carriesCurrentState ? current.fetchedStepIds : new Set(),
        optimisticStepIds: new Set(
          carriesCurrentState ? current.optimisticStepIds : [],
        ).add(step.id),
      };
    });
    if (repository && profileId) void repository.setCompleted(profileId, step.id, true);
  };

  const checkAnswer = () => {
    if (terminalFeedback || !selectedChoice) return;
    setConfirmedChoiceId(selectedChoice.id);
    if (selectedChoice.id === step.correctChoiceId) {
      setFeedback("correct");
      completeStep();
      return;
    }
    setFeedback("incorrect");
  };

  const skipAndReveal = () => {
    if (terminalFeedback) return;
    setSelectedChoiceId(step.correctChoiceId);
    setConfirmedChoiceId(step.correctChoiceId);
    setFeedback("skipped");
    completeStep();
  };

  const continueForward = () => {
    if (!terminalFeedback) return;
    if (stepIndex < steps.length - 1) {
      setStepIndex((index) => index + 1);
      return;
    }
    router.replace("/tutorials");
  };

  const answerStatus = (choice: TutorialChoice): TutorialAnswerStatus => {
    if (feedback === "correct" && choice.id === step.correctChoiceId) return "correct";
    if (feedback === "skipped" && choice.id === step.correctChoiceId) return "revealed";
    if (feedback === "incorrect" && choice.id === confirmedChoiceId) return "incorrect";
    if (!terminalFeedback && choice.id === selectedChoiceId) return "pending";
    return "idle";
  };

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.screen}>
      <View style={styles.shell}>
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.back()}>
              <Text style={styles.back}>{"<"} {tutorial.title}</Text>
            </Pressable>
            <Text style={styles.stepCount}>Step {step.position} of {steps.length}</Text>
          </View>
          <TutorialProgressRail completed={completedStepIds} current={stepIndex} stepIds={stepIds} />
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.challenge}>
            <View style={styles.titleRow}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              {isComplete ? <Text style={styles.completed}>Completed</Text> : null}
            </View>
            <Text style={styles.brief}>{step.brief}</Text>
          </View>

          <TutorialSourceTemplate
            selectedFragment={confirmedChoice?.fragment}
            state={feedback}
            template={step.sourceTemplate}
          />

          <View style={styles.answerSection}>
            <Text style={styles.answerLabel}>Choose one answer</Text>
            <View style={styles.choices}>
              {shuffledChoices.map((choice, index) => (
                <TutorialAnswerTile
                  disabled={terminalFeedback}
                  fragment={choice.fragment}
                  key={choice.id}
                  marker={CHOICE_MARKERS[index] ?? String(index + 1)}
                  onPress={() => {
                    if (terminalFeedback) return;
                    setSelectedChoiceId(choice.id);
                  }}
                  selected={choice.id === selectedChoiceId}
                  status={answerStatus(choice)}
                />
              ))}
            </View>
          </View>

          {hintVisible && step.hint ? (
            <View style={styles.hintCard}>
              <Text style={styles.hintTitle}>Hint</Text>
              <Text style={styles.hint}>{step.hint}</Text>
            </View>
          ) : null}

          <TutorialFeedback
            helpers={step.helpers}
            learnerSource={learnerSource}
            state={feedback}
            targetSource={targetSource}
          />

          {stepIndex > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setStepIndex((index) => Math.max(0, index - 1))}
              style={styles.previous}
            >
              <Text style={styles.secondaryLabel}>Previous step</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <TutorialActionDock
          canConfirm={Boolean(selectedChoice)}
          hasHint={Boolean(step.hint)}
          onConfirm={checkAnswer}
          onContinue={continueForward}
          onHint={() => setHintVisible((visible) => !visible)}
          onSkip={skipAndReveal}
          state={feedback}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: Colors.background, flex: 1 },
  shell: { alignSelf: "center", flex: 1, maxWidth: 520, width: "100%" },
  header: { gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md, paddingTop: Spacing.sm },
  headerRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  back: { color: Colors.textMuted, fontSize: 14, fontWeight: "700" },
  stepCount: { color: Colors.textSubtle, fontSize: 11, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  content: { gap: Spacing.xl, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, paddingTop: Spacing.sm },
  challenge: { gap: Spacing.sm },
  titleRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  stepTitle: { color: Colors.text, flex: 1, fontSize: 28, fontWeight: "800", letterSpacing: -0.4 },
  completed: { color: Colors.accent, fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  brief: { color: Colors.textMuted, fontSize: 16, lineHeight: 24 },
  answerSection: { gap: Spacing.md },
  answerLabel: { color: Colors.textSubtle, fontSize: 11, fontWeight: "800", letterSpacing: 0.7, textTransform: "uppercase" },
  choices: { gap: Spacing.sm },
  hintCard: { backgroundColor: Colors.surfaceRaised, borderColor: Colors.border, borderRadius: Radius.md, borderWidth: 1, gap: Spacing.xs, padding: Spacing.md },
  hintTitle: { color: Colors.cyan, fontSize: 12, fontWeight: "800", textTransform: "uppercase" },
  hint: { color: Colors.textMuted, fontSize: 14, lineHeight: 20 },
  previous: { alignItems: "center", minHeight: 44, justifyContent: "center" },
  missing: { color: Colors.textMuted, fontSize: 15, padding: Spacing.lg },
  secondaryButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: Radius.sm, margin: Spacing.lg, minHeight: 48, justifyContent: "center" },
  secondaryLabel: { color: Colors.text, fontSize: 14, fontWeight: "700" },
});