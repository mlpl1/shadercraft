import { StyleSheet, Text, View } from "react-native";

import { Colors, Radius, Spacing } from "../constants/theme";
import { ShaderSandbox } from "./shader-sandbox";

type TutorialTargetPreviewProps = {
  source: string;
  helpers?: string;
};

const PREVIEW_HEIGHT = 132;

export function TutorialTargetPreview({ source, helpers }: TutorialTargetPreviewProps) {
  return (
    <View style={styles.container} testID="tutorial-target-preview">
      <View style={styles.labelRow}>
        <Text style={styles.label}>Target</Text>
        <Text style={styles.caption}>Match this output</Text>
      </View>
      <View style={styles.frame}>
        <ShaderSandbox height={PREVIEW_HEIGHT} helpers={helpers} source={source} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.xs },
  labelRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  label: { color: Colors.text, fontSize: 13, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  caption: { color: Colors.textSubtle, fontSize: 12, fontWeight: "700" },
  frame: { borderColor: Colors.border, borderRadius: Radius.lg, borderWidth: 1, overflow: "hidden" },
});