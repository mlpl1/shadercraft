import { StyleSheet, Text, View } from "react-native";

import { ShaderSandbox } from "./shader-sandbox";
import { StageSourceView } from "./stage-source-view";
import { Colors, Spacing } from "../constants/theme";
import type { LessonStage } from "../data/course/types";

const PREVIEW_HEIGHT = 200;

type LessonStageBlockProps = {
  stage: LessonStage;
  /** Whether this block's GL context has been created. One-way: the workspace never unsets it. */
  isMounted: boolean;
  /** Whether the block is on screen. Drives the sandbox's render loop. */
  isVisible: boolean;
};

/**
 * One stage read whole, in the order an article reads: heading, then the thing it produced, then
 * the code and the explanation.
 *
 * Owns no scroll logic and makes no visibility decision — it is told what it is. That keeps the
 * arithmetic in one testable place and this component trivial.
 */
export function LessonStageBlock({ stage, isMounted, isVisible }: LessonStageBlockProps) {
  return (
    <View style={styles.block}>
      <Text style={styles.title}>{stage.title}</Text>

      {isMounted ? (
        <ShaderSandbox active={isVisible} height={PREVIEW_HEIGHT} source={stage.source} />
      ) : (
        // Same height as the sandbox, so mounting never shifts the layout under the reader.
        <View style={styles.placeholder} testID="stage-preview-placeholder" />
      )}

      <StageSourceView source={stage.source} />

      <Text style={styles.body}>{stage.body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.md,
    marginBottom: Spacing.xxxl,
  },
  placeholder: {
    backgroundColor: Colors.surfaceRaised,
    height: PREVIEW_HEIGHT,
  },
  title: {
    color: Colors.text,
    // Leads the block now rather than captioning it, so it carries a little more weight.
    fontSize: 18,
    fontWeight: "600",
  },
  body: {
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
  },
});
