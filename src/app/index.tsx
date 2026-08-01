import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNavigation } from "../components/bottom-navigation";
import { LessonRow } from "../components/lesson-row";
import { ShaderPreview } from "../components/shader-preview";
import { Colors, Radius, Spacing } from "../constants/theme";

function showComingSoon(destination: string) {
  Alert.alert(
    `${destination} is coming next`,
    "The home experience is ready. This flow will be implemented in the next pass.",
  );
}

export default function HomeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.appFrame}>
        <View style={styles.header}>
          <View>
            <Text style={styles.sectionLabel}>Curriculum</Text>
            <Text style={styles.wordmark}>Shadercraft</Text>
          </View>

          <View style={styles.progressSummary}>
            <Text style={styles.progressLabel}>0% Complete</Text>
            <View style={styles.progressTrack}>
              <View style={styles.progressFill} />
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityLabel="Start Coordinate Systems and UV Space"
            accessibilityRole="button"
            onPress={() => router.push("/lesson")}
            style={({ pressed }) => [styles.continueCard, pressed && styles.pressedCard]}
          >
            <ShaderPreview />

            <View style={styles.cardBody}>
              <View style={styles.cardMetadata}>
                <Text style={styles.cardEyebrow}>Module 01 · Lesson 01</Text>
                <Text style={styles.currentLabel}>Start here</Text>
              </View>
              <Text style={styles.lessonTitle}>Coordinate Systems &amp; UV Space</Text>
              <View style={styles.resumeButton}>
                <Text style={styles.resumeLabel}>Start Lesson</Text>
              </View>
            </View>
          </Pressable>

          <View style={styles.learningPath}>
            <Text style={styles.pathHeading}>Up next</Text>
            <View style={styles.lessonList}>
              <LessonRow
                module="Module 02"
                onPress={() => showComingSoon("Next lesson")}
                state="active"
                title="Shape Synthesis"
              />
              <LessonRow module="Module 03" state="locked" title="Color Mixing & Luma" />
              <LessonRow module="Module 04" state="locked" title="Procedural Textures" />
            </View>
          </View>
        </ScrollView>

        <BottomNavigation onUnavailable={showComingSoon} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  appFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionLabel: {
    color: Colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  wordmark: {
    marginTop: 2,
    color: Colors.text,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  progressSummary: {
    alignItems: "flex-end",
    gap: 6,
  },
  progressLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  progressTrack: {
    width: 96,
    height: 4,
    overflow: "hidden",
    borderRadius: Radius.round,
    backgroundColor: Colors.border,
  },
  progressFill: {
    width: "0%",
    height: "100%",
    backgroundColor: Colors.accent,
  },
  scrollContent: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: 40,
  },
  continueCard: {
    overflow: "hidden",
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  pressedCard: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  cardBody: {
    padding: Spacing.xl,
  },
  cardMetadata: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
  },
  cardEyebrow: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.75,
    textTransform: "uppercase",
  },
  currentLabel: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "600",
  },
  lessonTitle: {
    maxWidth: 300,
    marginBottom: Spacing.lg,
    color: Colors.text,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.45,
    lineHeight: 28,
  },
  resumeButton: {
    minHeight: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  resumeLabel: {
    color: Colors.background,
    fontSize: 16,
    fontWeight: "800",
  },
  learningPath: {
    marginTop: 38,
  },
  pathHeading: {
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.xs,
    color: Colors.textSubtle,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  lessonList: {
    gap: Spacing.md,
  },
});
