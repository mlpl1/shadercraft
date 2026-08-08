import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";

type StageSourceViewProps = {
  source: string;
  helpers?: string;
};

const MONOSPACE_LINE_HEIGHT = 20;

/**
 * Helpers are declared above `mainImage`, and the listing shows them the same way, separated by a
 * blank line. Hiding them would leave the prose discussing a function the learner cannot see, and
 * copying only the body would hand over code that does not compile.
 */
function joinListing(source: string, helpers?: string): string {
  const trimmed = helpers?.trim() ?? "";
  return trimmed.length > 0 ? `${trimmed}\n\n${source}` : source;
}

/** How long the button confirms a copy before returning to its resting label. */
const COPIED_FEEDBACK_MS = 1600;

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
 *
 * The copy button overlays the code rather than sitting above it, so it costs no vertical space in a
 * lesson that already stacks a preview, a listing and prose per stage.
 */
export function StageSourceView({ source, helpers }: StageSourceViewProps) {
  const listing = joinListing(source, helpers);
  const lines = listing.split("\n");
  const [copied, setCopied] = useState(false);

  // Cleared on unmount so a copy made just before a stage scrolls away cannot set state on a gone
  // component, and reset whenever the source changes so one stage's confirmation never appears to
  // belong to another's listing.
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setCopied(false);
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [listing]);

  const copy = useCallback(() => {
    // Deliberately not awaited: the confirmation is about the learner's tap, and on iOS and Android
    // this always resolves true anyway, so gating the label on the promise would only add latency.
    void Clipboard.setStringAsync(listing);
    setCopied(true);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  }, [listing]);

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
            {listing}
          </Text>
        </View>
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copied ? "Code copied" : "Copy code"}
        hitSlop={Spacing.sm}
        onPress={copy}
        style={styles.copyButton}
        testID="stage-source-copy"
      >
        <Text style={styles.copyLabel}>{copied ? "Copied" : "Copy"}</Text>
      </Pressable>
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
  copyButton: {
    position: "absolute",
    top: Spacing.xs,
    right: Spacing.xs,
    backgroundColor: Colors.background,
    borderColor: Colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  copyLabel: {
    color: Colors.textSubtle,
    fontSize: 12,
    fontWeight: "600",
  },
});
