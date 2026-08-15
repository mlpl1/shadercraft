import { useCallback, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";
import type { CompileError } from "../shaders/shader-source";
import { tokenizeGlsl } from "./glsl-highlight";

/**
 * The characters and identifiers phone keyboards bury behind two taps, ordered by how often GLSL
 * needs them. Multi-character entries insert verbatim; nothing here adds surrounding whitespace,
 * because guessing where a learner wants a space is worse than letting them type it.
 */
export const GLSL_SYMBOLS = [
  ";",
  "(",
  ")",
  "{",
  "}",
  ".",
  ",",
  "*",
  "/",
  "-",
  "+",
  "=",
  "<",
  ">",
  "[",
  "]",
  "vec2",
  "vec3",
  "vec4",
  "float",
  "length",
  "mix",
  "smoothstep",
] as const;

type GlslInputProps = {
  editable?: boolean;
  initialValue: string;
  errors: CompileError[];
  onChange: (source: string) => void;
};

/**
 * The GLSL editing surface: a line-numbered input, a symbol row for the characters a phone keyboard
 * hides, and the compiler's complaints underneath.
 *
 * The buffer is **controlled from state local to this component**. That is deliberate on two counts.
 * Local state means a keystroke re-renders only the editor — never the screen that owns the debounced
 * source, and never the preview. And controlled text is the only way to insert a symbol at the caret
 * on the New Architecture: `setNativeProps` is unsupported under Fabric, which RN 0.86 always uses,
 * so an uncontrolled input could not be edited programmatically at all.
 */
export function GlslInput({
  editable = true,
  initialValue,
  errors,
  onChange,
}: GlslInputProps) {
  const [value, setValue] = useState(initialValue);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  /**
   * Set only for the render immediately after a symbol insert, to place the caret after the inserted
   * text. Cleared as soon as the input reports a selection of its own, so the field is not fighting
   * the platform for control of the caret on every keystroke.
   */
  const [caretOverride, setCaretOverride] = useState<{ start: number; end: number } | null>(null);

  const errorLines = useMemo(
    () => new Set(errors.map((error) => error.line).filter((line): line is number => line !== null)),
    [errors],
  );

  const lineCount = useMemo(() => value.split("\n").length, [value]);
  const highlightedTokens = useMemo(() => tokenizeGlsl(value), [value]);

  const handleChangeText = useCallback(
    (next: string) => {
      if (!editable) return;
      setValue(next);
      onChange(next);
    },
    [editable, onChange],
  );

  const handleSelectionChange = useCallback(
    (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = event.nativeEvent.selection;
      setCaretOverride(null);
    },
    [],
  );

  const insert = useCallback(
    (symbol: string) => {
      if (!editable) return;
      const selection = selectionRef.current;
      // With no observed caret — the input has not been focused yet — appending is the only
      // non-destructive choice.
      const start = selection?.start ?? value.length;
      const end = selection?.end ?? value.length;
      const next = `${value.slice(0, start)}${symbol}${value.slice(end)}`;
      const caret = start + symbol.length;

      selectionRef.current = { start: caret, end: caret };
      setCaretOverride({ start: caret, end: caret });
      setValue(next);
      onChange(next);
    },
    [editable, onChange, value],
  );

  return (
    <View style={styles.container}>
      <View style={styles.editorRow}>
        <View style={styles.gutter} testID="glsl-gutter">
          {Array.from({ length: lineCount }, (_unused, index) => index + 1).map((line) => (
            <Text
              key={line}
              style={[styles.gutterLine, errorLines.has(line) && styles.gutterLineError]}
              testID={`glsl-gutter-line-${line}`}
            >
              {line}
            </Text>
          ))}
        </View>
        <View style={styles.inputLayer}>
          <Text pointerEvents="none" style={styles.highlight} testID="glsl-highlight">
            {highlightedTokens.map((token, index) => (
              <Text key={`${token.text}-${index}`} style={tokenStyles[token.kind]} testID={`glsl-highlight-${token.kind}`}>
                {token.text}
              </Text>
            ))}
          </Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            editable={editable}
            keyboardAppearance="dark"
            multiline
            onChangeText={handleChangeText}
            onSelectionChange={handleSelectionChange}
            scrollEnabled
            selection={caretOverride ?? undefined}
            spellCheck={false}
            style={styles.input}
            testID="glsl-input"
            textAlignVertical="top"
            value={value}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.symbolRowContent}
        horizontal
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        style={styles.symbolRow}
      >
        {GLSL_SYMBOLS.map((symbol) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !editable }}
            disabled={!editable}
            key={symbol}
            onPress={() => insert(symbol)}
            style={({ pressed }) => [styles.symbol, pressed && styles.symbolPressed]}
            testID={`glsl-symbol-${symbol}`}
          >
            <Text style={styles.symbolText}>{symbol}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {errors.length > 0 && (
        <View style={styles.errorList} testID="glsl-errors">
          {errors.map((error, index) => (
            <View key={`${error.raw}-${index}`} style={styles.errorRow}>
              {error.line !== null && <Text style={styles.errorLine}>Line {error.line}</Text>}
              <Text style={styles.errorMessage}>{error.message}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const MONOSPACE_LINE_HEIGHT = 20;

const tokenStyles = StyleSheet.create({
  comment: { color: Colors.textSubtle },
  directive: { color: Colors.electricBlue },
  keyword: { color: Colors.coral },
  number: { color: Colors.accent },
  plain: { color: Colors.text },
  string: { color: Colors.accent },
  type: { color: Colors.acidGreen },
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    flex: 1,
  },
  editorRow: {
    flex: 1,
    flexDirection: "row",
  },
  gutter: {
    backgroundColor: Colors.background,
    borderRightColor: Colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  gutterLine: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: MONOSPACE_LINE_HEIGHT,
    textAlign: "right",
  },
  gutterLineError: {
    color: Colors.coral,
    fontWeight: "700",
  },
  inputLayer: {
    flex: 1,
  },
  highlight: {
    ...StyleSheet.absoluteFill,
    opacity: 1,
    zIndex: 2,
    color: Colors.text,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: MONOSPACE_LINE_HEIGHT,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  input: {
    backgroundColor: "transparent",
    zIndex: 1,
    color: "transparent",
    flex: 1,
    fontFamily: "monospace",
    fontSize: 13,
    lineHeight: MONOSPACE_LINE_HEIGHT,
    paddingHorizontal: Spacing.sm,
    paddingTop: Spacing.sm,
  },
  symbolRow: {
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  symbolRowContent: {
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  symbol: {
    backgroundColor: Colors.surfaceRaised,
    borderRadius: Radius.sm,
    minWidth: 34,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  symbolPressed: {
    backgroundColor: Colors.border,
  },
  symbolText: {
    color: Colors.text,
    fontFamily: "monospace",
    fontSize: 13,
    textAlign: "center",
  },
  errorList: {
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
    maxHeight: 120,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  errorRow: {
    gap: 2,
  },
  errorLine: {
    color: Colors.coral,
    fontFamily: "monospace",
    fontSize: 11,
  },
  errorMessage: {
    color: Colors.textMuted,
    fontSize: 12,
  },
});
