import { ScrollView, StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";

type StageSourceViewProps = {
  source: string;
};

const MONOSPACE_LINE_HEIGHT = 20;

/**
 * Read-only, line-numbered view of a stage's shader source — the same body `ShaderSandbox` above
 * it just compiled and drew. Lessons only ever show code, they never let a learner edit it
 * (exercises live in a future Tutorials section), so this mirrors `GlslInput`'s gutter and
 * typography without any of its editing machinery: no `TextInput`, no symbol row, no caret.
 *
 * Horizontal scroll rather than wrapping, for the same reason as the editor: a wrapped line would
 * desynchronize the gutter from the line numbers.
 *
 * The code column is one `Text` holding the whole source rather than one per line, which matters for
 * two reasons. An empty `Text` lays out at zero height while its gutter number keeps a full line, so
 * per-line rendering silently dropped every blank line out of alignment — invisible until Module 3
 * became the first content to leave blank lines between logical groups. And selection cannot cross
 * `Text` boundaries, so per-line rendering capped a learner at copying one line at a time.
 *
 * Alignment survives the merge because nothing here wraps: the horizontal `ScrollView` leaves the
 * text unconstrained, so one source line always occupies exactly one line box of
 * {@link MONOSPACE_LINE_HEIGHT}, matching the gutter entry beside it.
 */
export function StageSourceView({ source }: StageSourceViewProps) {
  const lines = source.split("\n");

  return (
    <View style={styles.container} testID="stage-source">
      <View style={styles.gutter}>
        {lines.map((_line, index) => (
          <Text key={index} style={styles.gutterLine}>
            {index + 1}
          </Text>
        ))}
      </View>
      <ScrollView
        horizontal
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        style={styles.codeScroll}
      >
        <View style={styles.codeLines}>
          {/* `selectable` is also how a learner copies: long-press raises the platform selection
              toolbar, whose Copy action needs no clipboard dependency of our own. */}
          <Text selectable style={styles.codeLine} testID="stage-source-code">
            {source}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    overflow: "hidden",
  },
  gutter: {
    backgroundColor: Colors.background,
    borderRightColor: Colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  gutterLine: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: MONOSPACE_LINE_HEIGHT,
    textAlign: "right",
  },
  codeScroll: {
    flex: 1,
  },
  codeLines: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  codeLine: {
    color: Colors.text,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: MONOSPACE_LINE_HEIGHT,
  },
});
