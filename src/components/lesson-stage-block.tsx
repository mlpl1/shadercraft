import { StyleSheet, Text, View } from "react-native";

import { ShaderSandbox } from "./shader-sandbox";
import { StageSourceView } from "./stage-source-view";
import { Colors, Spacing } from "../constants/theme";
import type { LessonStage } from "../data/course/types";

const PREVIEW_HEIGHT = 200;

type LessonStageBlockProps = {
  stage: LessonStage;
  /** 1-based, for the block's eyebrow. */
  position: number;
  /** Whether this block's GL context has been created. One-way: the workspace never unsets it. */
  isMounted: boolean;
  /** Whether the block is on screen. Drives the sandbox's render loop. */
  isVisible: boolean;
};

/**
 * One stage read whole: its render, its source, its prose.
 *
 * Owns no scroll logic and makes no visibility decision — it is told what it is. That keeps the
 * arithmetic in one testable place and this component trivial.
 */
export function LessonStageBlock({
  stage,
  position,
  isMounted,
  isVisible,
}: LessonStageBlockProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.eyebrow}>Stage {position}</Text>

      {isMounted ? (
        <ShaderSandbox active={isVisible} height={PREVIEW_HEIGHT} source={stage.source} />
      ) : (
        // Same height as the sandbox, so mounting never shifts the layout under the reader.
        <View style={styles.placeholder} testID="stage-preview-placeholder" />
      )}

      <StageSourceView source={stage.source} />

      <Text style={styles.title}>{stage.title}</Text>
      <Text style={styles.body}>{stage.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.md,
    marginBottom: Spacing.xxxl,
  },
  eyebrow: {
    color: Colors.textSubtle,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  placeholder: {
    backgroundColor: Colors.surfaceRaised,
    height: PREVIEW_HEIGHT,
  },
  title: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "600",
  },
  body: {
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
});
