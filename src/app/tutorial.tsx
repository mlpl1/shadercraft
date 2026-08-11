import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { GlslInput } from "../components/glsl-input";
import { ShaderSandbox } from "../components/shader-sandbox";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useCourse } from "../context/course-context";
import { useData } from "../context/data-context";
import type { Tutorial, TutorialStep } from "../data/course/types";
import type { CompileError } from "../shaders/shader-source";

const PREVIEW_HEIGHT = 150;
const DRAFT_SAVE_DELAY_MS = 600;

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
  const [source, setSource] = useState("");
  const [errors, setErrors] = useState<CompileError[]>([]);
  const [revealed, setRevealed] = useState(false);
  /**
   * Bumped whenever the source is set programmatically rather than typed. `GlslInput` owns its own
   * buffer seeded from `initialValue`, so a restored draft or a revealed solution reaches the editor
   * only by remounting it — and remounting on every keystroke would destroy the caret.
   */
  const [editorSeed, setEditorSeed] = useState(0);
  const [completedStepIds, setCompletedStepIds] = useState<ReadonlySet<string>>(new Set());
  /** Guards the draft-restoring effect from clobbering what the learner is typing. */
  const loadedStepId = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const step: TutorialStep | undefined = steps[stepIndex];

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

  // Restore the learner's draft when the step changes, falling back to the starter. Keyed on the
  // step id rather than the index so switching steps and back does not lose work.
  useEffect(() => {
    if (!step || loadedStepId.current === step.id) return;
    loadedStepId.current = step.id;
    setRevealed(false);

    if (!repository || !profileId) {
      setSource(step.starterSource);
      setEditorSeed((value) => value + 1);
      return;
    }
    let cancelled = false;
    void repository.getStates(profileId, [step.id]).then((states) => {
      if (cancelled) return;
      setSource(states.get(step.id)?.draft ?? step.starterSource);
      setEditorSeed((value) => value + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [step, repository, profileId]);

  // Debounced so a keystroke is not a write. Cleared on unmount so a pending save cannot fire into
  // a closed screen.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const onChangeSource = useCallback(
    (next: string) => {
      setSource(next);
      if (!repository || !profileId || !step) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void repository.saveDraft(profileId, step.id, next);
      }, DRAFT_SAVE_DELAY_MS);
    },
    [repository, profileId, step],
  );

  const toggleComplete = useCallback(() => {
    if (!repository || !profileId || !step) return;
    const next = !completedStepIds.has(step.id);
    setCompletedStepIds((current) => {
      const updated = new Set(current);
      if (next) updated.add(step.id);
      else updated.delete(step.id);
      return updated;
    });
    void repository.setCompleted(profileId, step.id, next);
  }, [repository, profileId, step, completedStepIds]);

  const reveal = useCallback(() => {
    if (!step) return;
    setRevealed(true);
    onChangeSource(step.solutionSource);
    setEditorSeed((value) => value + 1);
  }, [step, onChangeSource]);

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

  const isComplete = completedStepIds.has(step.id);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.back()}>
          <Text style={styles.back}>‹ {tutorial.title}</Text>
        </Pressable>

        <Text style={styles.stepCount}>
          Step {step.position} of {steps.length}
        </Text>
        <Text style={styles.stepTitle}>{step.title}</Text>
        <Text style={styles.brief}>{step.brief}</Text>

        {/* Both previews compile through the same wrapper and share the step's helpers, so the only
            difference between them is the body — which is exactly what the learner is changing. */}
        <View style={styles.previews}>
          <View style={styles.preview}>
            <Text style={styles.previewLabel}>Target</Text>
            <ShaderSandbox
              height={PREVIEW_HEIGHT}
              helpers={step.helpers}
              source={step.solutionSource}
            />
          </View>
          <View style={styles.preview}>
            <Text style={styles.previewLabel}>Yours</Text>
            <ShaderSandbox
              height={PREVIEW_HEIGHT}
              helpers={step.helpers}
              onCompileResult={(result) => setErrors(result.ok ? [] : result.errors)}
              source={source}
            />
          </View>
        </View>

        <GlslInput
          errors={errors}
          initialValue={source}
          key={`${step.id}-${editorSeed}`}
          onChange={onChangeSource}
        />

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            onPress={reveal}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            testID="tutorial-reveal"
          >
            <Text style={styles.secondaryLabel}>{revealed ? "Revealed" : "Reveal solution"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isComplete }}
            onPress={toggleComplete}
            style={({ pressed }) => [
              styles.primary,
              isComplete && styles.primaryDone,
              pressed && styles.pressed,
            ]}
            testID="tutorial-mark-done"
          >
            <Text style={[styles.primaryLabel, isComplete && styles.primaryLabelDone]}>
              {isComplete ? "Done ✓" : "Mark done"}
            </Text>
          </Pressable>
        </View>

        {step.hint && !revealed ? <Text style={styles.hint}>Hint: {step.hint}</Text> : null}

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
  /**
   * The 520 cap every other content screen already applies — `lesson-workspace`, `course`,
   * `index`, `account` and the completion sheet. This screen was the only one without it, and
   * because it lays two previews side by side that omission set the preview aspect loose: each
   * preview is `(container - 40) / 2` wide against a fixed 150 tall, so an uncapped container
   * reached 3.28 on a 1024dp window. Capped, the range is 0.93 (320dp) to 1.60, which is
   * narrow enough for a tutorial brief to describe honestly.
   */
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
  stepTitle: { color: Colors.text, fontSize: 22, fontWeight: "800" },
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
  actions: { flexDirection: "row", gap: Spacing.sm },
  stepNav: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.xs },
  primary: {
    flex: 1,
    alignItems: "center",
    backgroundColor: Colors.accent,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
  },
  primaryDone: { backgroundColor: Colors.surfaceRaised },
  primaryLabel: { color: Colors.background, fontSize: 15, fontWeight: "800" },
  primaryLabelDone: { color: Colors.accent },
  secondary: {
    flex: 1,
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: Radius.sm,
    paddingVertical: Spacing.md,
  },
  secondaryLabel: { color: Colors.text, fontSize: 15, fontWeight: "700" },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  hint: { color: Colors.textSubtle, fontSize: 14, lineHeight: 20 },
});
