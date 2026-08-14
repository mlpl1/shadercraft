import { Pressable, StyleSheet, Text, View } from "react-native";

import { ShaderSandbox } from "./shader-sandbox";
import { Colors, Radius, Spacing } from "../constants/theme";
import type { Sketch } from "../data/sketches/sketch-repository";

type ShaderLibraryCardProps = {
  sketch: Sketch;
  active: boolean;
  onPress: () => void;
};

export function ShaderLibraryCard({ sketch, active, onPress }: ShaderLibraryCardProps) {
  return (
    <Pressable
      accessibilityLabel={`Open ${sketch.title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      testID={`shader-library-card-${sketch.id}`}
    >
      <View pointerEvents="none" style={styles.preview}>
        {active ? (
          <ShaderSandbox
            active
            height={164}
            parameters={sketch.metadata.parameters}
            source={sketch.source}
          />
        ) : (
          <View
            style={styles.previewPlaceholder}
            testID={`shader-library-preview-placeholder-${sketch.id}`}
          />
        )}
      </View>

      <View style={styles.details}>
        <Text numberOfLines={1} style={styles.title}>
          {sketch.title}
        </Text>
        <View style={styles.metadata}>
          <Text numberOfLines={1} style={styles.category}>
            {sketch.metadata.category}
          </Text>
          <Text style={styles.extension}>.frag</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: "hidden",
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surfaceLowest,
  },
  pressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
  preview: {
    overflow: "hidden",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  previewPlaceholder: {
    backgroundColor: Colors.surface,
    height: 164,
  },
  details: {
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  title: {
    color: Colors.text,
    fontFamily: "monospace",
    fontSize: 14,
    fontWeight: "700",
  },
  metadata: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: Spacing.sm,
  },
  category: {
    flex: 1,
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 11,
    textTransform: "uppercase",
  },
  extension: {
    color: Colors.electricBlue,
    fontFamily: "monospace",
    fontSize: 11,
    fontWeight: "700",
  },
});
