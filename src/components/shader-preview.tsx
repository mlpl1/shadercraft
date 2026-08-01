import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";

import { AppIcon } from "./app-icon";
import { Colors, Radius, Spacing } from "../constants/theme";

export function ShaderPreview() {
  return (
    <LinearGradient
      colors={[Colors.cyan, Colors.violet, Colors.coral]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={styles.preview}
    >
      <View style={[styles.orb, styles.cyanOrb]} />
      <View style={[styles.orb, styles.violetOrb]} />
      <View style={[styles.orb, styles.coralOrb]} />
      <View style={styles.sparkle}>
        <AppIcon
          color="rgba(255,255,255,0.28)"
          fallback="✦"
          name={{ android: "auto_awesome", ios: "sparkles", web: "auto_awesome" }}
          size={54}
        />
      </View>
      <View style={styles.fileBadge}>
        <Text style={styles.fileLabel}>live_preview.glsl</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  preview: {
    height: 192,
    overflow: "hidden",
  },
  orb: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: Radius.round,
    opacity: 0.52,
  },
  cyanOrb: {
    left: -110,
    top: -120,
    backgroundColor: "#D8FAFF",
  },
  violetOrb: {
    right: -85,
    top: -100,
    backgroundColor: "#5D36C9",
  },
  coralOrb: {
    right: -95,
    bottom: -150,
    backgroundColor: "#FFB09D",
  },
  sparkle: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  fileBadge: {
    position: "absolute",
    left: Spacing.md,
    bottom: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    borderRadius: Radius.sm,
    backgroundColor: "rgba(9,11,15,0.58)",
    borderColor: "rgba(255,255,255,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
  },
  fileLabel: {
    color: "rgba(255,255,255,0.84)",
    fontFamily: "monospace",
    fontSize: 10,
    letterSpacing: 0.1,
  },
});
