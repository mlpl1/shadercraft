import { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { SafeAreaView } from "react-native-safe-area-context";

import bundledCourse from "../../assets/course/bundled-course.json";
import { Colors, Spacing } from "../constants/theme";
import { fillTutorialTemplate } from "../data/course/tutorial-exercise";
import type { CourseModule } from "../data/course/types";
import { ShaderProgramHost } from "../shaders/shader-program-host";

/**
 * Compiles every shader the release contains against the real GL driver, and reports what failed.
 *
 * This exists because a lesson stage that fails to compile is invisible: `LessonStageBlock` passes
 * no `onCompileResult`, so a broken stage renders as an empty preview and logs nothing — identical
 * to one that simply has not drawn yet. Checking every release source by eye is slow and unreliable, and
 * nothing before this ever compiled a single one of them outside a device.
 *
 * One context and one `ShaderProgramHost` for the whole sweep, reused across every source. Nothing
 * is drawn: `setBody` compiles and links, which is the entire question being asked.
 */
type Failure = { id: string; kind: string; line: number | null; message: string };

type Source = { id: string; kind: string; source: string; helpers?: string };

export function collectSources(modules: CourseModule[]): Source[] {
  const sources: Source[] = [];

  for (const module of modules) {
    for (const lesson of module.lessons) {
      for (const stage of lesson.stages) {
        sources.push({ id: stage.id, kind: "stage", source: stage.source, helpers: stage.helpers });
      }
    }
    for (const tutorial of module.tutorials ?? []) {
      for (const step of tutorial.steps) {
        // Every authored option can reach the learner preview, so audit all four substitutions.
        for (const choice of step.answerChoices) {
          sources.push({
            id: step.id,
            kind: `choice:${choice.id}`,
            source: fillTutorialTemplate(step.sourceTemplate, choice.fragment),
            helpers: step.helpers,
          });
        }
      }
    }
  }

  return sources;
}

export default function ShaderAuditScreen() {
  const [status, setStatus] = useState("Creating a GL context…");
  const [failures, setFailures] = useState<Failure[]>([]);
  const [total, setTotal] = useState(0);

  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    const host = new ShaderProgramHost(gl);
    const sources = collectSources(bundledCourse.modules as unknown as CourseModule[]);
    const found: Failure[] = [];

    for (const entry of sources) {
      const result = host.setBody(entry.source, entry.helpers);
      if (!result.ok) {
        const first = result.errors[0];
        found.push({
          id: entry.id,
          kind: entry.kind,
          line: first?.line ?? null,
          message: first?.message ?? result.rawLog.slice(0, 200),
        });
        console.log(`SHADER-AUDIT FAIL ${entry.kind} ${entry.id} line=${first?.line ?? "?"}: ${first?.message ?? result.rawLog}`);
      }
    }

    host.dispose();
    setTotal(sources.length);
    setFailures(found);
    setStatus(found.length === 0 ? "All compiled." : `${found.length} failed.`);
    console.log(`SHADER-AUDIT DONE compiled=${sources.length} failed=${found.length}`);
  }, []);

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      <GLView onContextCreate={onContextCreate} style={styles.hiddenContext} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Shader audit</Text>
        <Text style={styles.status}>
          {status} {total > 0 ? `(${total - failures.length}/${total} compiled)` : ""}
        </Text>
        {failures.map((failure) => (
          <View key={`${failure.kind}-${failure.id}`} style={styles.failure}>
            <Text style={styles.failureId}>
              {failure.kind} · {failure.id}
              {failure.line === null ? "" : ` · line ${failure.line}`}
            </Text>
            <Text style={styles.failureMessage}>{failure.message}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  // One pixel: the context has to exist to compile against, but nothing is ever drawn to it.
  hiddenContext: { width: 1, height: 1 },
  content: { padding: Spacing.lg, gap: Spacing.md },
  title: { color: Colors.text, fontSize: 24, fontWeight: "800" },
  status: { color: Colors.textMuted, fontSize: 16 },
  failure: { backgroundColor: Colors.surface, borderRadius: 8, padding: Spacing.md, gap: 4 },
  failureId: { color: Colors.coral, fontSize: 13, fontWeight: "700" },
  failureMessage: { color: Colors.textMuted, fontFamily: "monospace", fontSize: 12 },
});
