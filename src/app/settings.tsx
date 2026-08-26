import { useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../components/app-icon";
import { BottomNavigation } from "../components/bottom-navigation";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useAuth } from "../context/auth-context";
import { useData } from "../context/data-context";
import { type DeviceSettingsPatch, useSettings } from "../context/settings-context";
import { type SyncStatus, useSyncStatus } from "../context/sync-context";
import type { Sketch } from "../data/sketches/sketch-repository";
import { exportSketch, sketchExportAdapter } from "../data/settings/sketch-export";
import type { EditorFontSize, PreviewPerformance } from "../data/settings/device-settings";
import { isCloudSyncEnabled } from "../data/supabase/client";

function describePendingChanges(pending: number): string {
  return `${pending} ${pending === 1 ? "change" : "changes"} waiting to sync`;
}

function syncStatusLabel(status: SyncStatus, pending: number): string {
  switch (status) {
    case "up-to-date":
      return pending > 0 ? describePendingChanges(pending) : "Up to date";
    case "syncing":
      return "Syncing...";
    case "retrying":
      return "Waiting to retry";
    case "offline":
      return pending > 0 ? `Offline - ${describePendingChanges(pending)}` : "Offline";
    case "attention":
      return "Needs attention";
    case "signed-out":
      return "Not signed in";
  }
}

function syncStatusDetail(status: SyncStatus): string | null {
  if (status === "retrying") return "We'll retry automatically when possible.";
  if (status === "offline") return "Your local changes stay safe on this device.";
  if (status === "attention") return "Open Account to review sync details.";
  return null;
}

function describeExportError(error: unknown): string {
  return error instanceof Error ? error.message : "Try exporting the shader again.";
}

const EDITOR_FONT_SIZES: EditorFontSize[] = [12, 14, 16];
const PREVIEW_PERFORMANCE_OPTIONS: { label: string; mode: PreviewPerformance }[] = [
  { label: "Full speed", mode: "full-speed" },
  { label: "Battery saver", mode: "battery-saver" },
];

function savePreference(update: (patch: DeviceSettingsPatch) => Promise<void>, patch: DeviceSettingsPatch) {
  void update(patch).catch(() => undefined);
}

type SectionProps = {
  title: string;
  children: React.ReactNode;
};

function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

type SettingRowProps = {
  label: string;
  detail?: string;
  disabled?: boolean;
  onPress?: () => void;
};

function SettingRow({ label, detail, disabled = false, onPress }: SettingRowProps) {
  const content = (
    <>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowLabel, disabled && styles.disabledText]}>{label}</Text>
        {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {onPress ? (
        <AppIcon
          color={disabled ? Colors.textSubtle : Colors.textSubtle}
          fallback=">"
          name={{ android: "chevron_right", ios: "chevron.right", web: "chevron_right" }}
          size={20}
        />
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.row}>{content}</View>;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, disabled && styles.disabledRow, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

function AccountSection() {
  const router = useRouter();
  const auth = useAuth();
  const sync = useSyncStatus();

  if (!isCloudSyncEnabled()) {
    return (
      <Section title="Account">
        <SettingRow
          detail="Your data stays on this device."
          label="Local-only mode"
        />
      </Section>
    );
  }

  if (auth.session === undefined) {
    return (
      <Section title="Account">
        <SettingRow label="Checking account..." />
      </Section>
    );
  }

  if (!auth.session) {
    return (
      <Section title="Account">
        <SettingRow
          detail="Sync your learning progress across your devices."
          label="Sign in or create account"
          onPress={() => router.push("/account")}
        />
      </Section>
    );
  }

  const status = syncStatusLabel(sync.status, sync.pending);
  const detail = syncStatusDetail(sync.status);

  return (
    <Section title="Account">
      <View style={styles.accountSummary}>
        <Text style={styles.email}>{auth.session.email}</Text>
        <Text style={styles.syncStatus}>{status}</Text>
        {detail ? <Text style={styles.syncDetail}>{detail}</Text> : null}
      </View>
      <View style={styles.separator} />
      <SettingRow label="Manage account" onPress={() => router.push("/account")} />
    </Section>
  );
}

function DataStorageSection() {
  const auth = useAuth();
  const data = useData();
  const [chooserVisible, setChooserVisible] = useState(false);
  const [sketches, setSketches] = useState<Sketch[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const canExport = data.status === "ready" && auth.isHydrated && auth.profileId !== null;

  const closeChooser = () => {
    setChooserVisible(false);
    setExportingId(null);
  };

  const openChooser = async () => {
    if (data.status !== "ready" || !auth.profileId) return;

    setChooserVisible(true);
    setLoading(true);
    setSketches(null);

    try {
      setSketches(await data.sketchRepository.list(auth.profileId));
    } catch (error) {
      setChooserVisible(false);
      Alert.alert("Export failed", describeExportError(error), [
        { text: "Cancel", style: "cancel" },
        { text: "Retry", onPress: () => void openChooser() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const exportSelectedSketch = async (sketch: Sketch) => {
    if (exportingId) return;

    setExportingId(sketch.id);
    try {
      await exportSketch(sketch, sketchExportAdapter);
      closeChooser();
    } catch (error) {
      Alert.alert("Export failed", describeExportError(error), [
        { text: "Cancel", style: "cancel" },
        { text: "Retry", onPress: () => void exportSelectedSketch(sketch) },
      ]);
    } finally {
      setExportingId(null);
    }
  };

  return (
    <>
      <Section title="Data & storage">
        <SettingRow
          detail={
            canExport
              ? "Choose one saved shader and export its exact GLSL source."
              : "Available after your local profile is ready."
          }
          disabled={!canExport}
          label="Export saved sketch"
          onPress={() => void openChooser()}
        />
        <View style={styles.separator} />
        <SettingRow
          detail="Sketches and tutorials remain local-only. Lesson progress can sync when you sign in."
          label="Local shader data"
        />
      </Section>
      <Modal
        animationType="fade"
        onRequestClose={closeChooser}
        transparent
        visible={chooserVisible}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <View style={styles.rowCopy}>
                <Text style={styles.modalTitle}>Export saved sketch</Text>
                <Text style={styles.modalDetail}>Pick one shader to save as a .frag file.</Text>
              </View>
              <Pressable
                accessibilityLabel="Close export chooser"
                accessibilityRole="button"
                onPress={closeChooser}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              >
                <AppIcon
                  color={Colors.text}
                  fallback="x"
                  name={{ android: "close", ios: "xmark", web: "close" }}
                  size={18}
                />
              </Pressable>
            </View>
            <View style={styles.separator} />
            {loading ? <Text style={styles.emptyText}>Loading saved sketches...</Text> : null}
            {!loading && sketches?.length === 0 ? (
              <Text style={styles.emptyText}>No sketches to export</Text>
            ) : null}
            {!loading && sketches
              ? sketches.map((sketch, index) => (
                  <View key={sketch.id}>
                    {index > 0 ? <View style={styles.separator} /> : null}
                    <Pressable
                      accessibilityLabel={sketch.title}
                      accessibilityRole="button"
                      disabled={exportingId !== null}
                      onPress={() => void exportSelectedSketch(sketch)}
                      style={({ pressed }) => [
                        styles.sketchRow,
                        exportingId !== null && styles.disabledRow,
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowLabel}>{sketch.title}</Text>
                        <Text style={styles.rowDetail}>{new Date(sketch.updatedAt).toLocaleString()}</Text>
                      </View>
                      <AppIcon
                        color={Colors.accent}
                        fallback=">"
                        name={{ android: "ios_share", ios: "square.and.arrow.up", web: "download" }}
                        size={20}
                      />
                    </Pressable>
                  </View>
                ))
              : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

export default function SettingsScreen() {
  const settingsContext = useSettings();
  const data = useData();
  const { settings, update } = settingsContext;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.appFrame}>
        <View style={styles.header}>
          <Text style={styles.wordmark}>Shadercraft</Text>
          <Text style={styles.eyebrow}>App preferences</Text>
          <Text style={styles.title}>Settings</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          {settingsContext.error ? (
            <View accessibilityRole="alert" style={styles.notice}>
              <Text style={styles.noticeText}>Could not save settings: {settingsContext.error.message}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void settingsContext.retry()}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              >
                <Text style={styles.retryText}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          {data.status === "error" ? (
            <View accessibilityRole="alert" style={styles.notice}>
              <Text style={styles.noticeText}>Local data needs attention. Retry from the launch screen.</Text>
            </View>
          ) : null}
          <AccountSection />
          <DataStorageSection />
          <Section title="Editor">
            <View style={styles.preferenceBlock}>
              <Text style={styles.preferenceLabel}>Editor font size</Text>
              <View style={styles.segmented}>
                {EDITOR_FONT_SIZES.map((size) => {
                  const selected = settings.editorFontSize === size;
                  return (
                    <Pressable
                      accessibilityLabel={String(size)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={size}
                      onPress={() => savePreference(update, { editorFontSize: size })}
                      style={({ pressed }) => [
                        styles.segment,
                        selected && styles.segmentSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                        {size}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.separator} />
            <View style={styles.preferenceBlock}>
              <Text style={styles.preferenceLabel}>Preview performance</Text>
              <Text style={styles.preferenceHint}>Choose how hard visible shader previews work while animating.</Text>
              <View style={styles.segmented}>
                {PREVIEW_PERFORMANCE_OPTIONS.map(({ label, mode }) => {
                  const selected = settings.previewPerformance === mode;
                  return (
                    <Pressable
                      accessibilityLabel={label}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={mode}
                      onPress={() => savePreference(update, { previewPerformance: mode })}
                      style={({ pressed }) => [
                        styles.segment,
                        selected && styles.segmentSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.separator} />
            <Pressable
              accessibilityLabel="Show line numbers"
              accessibilityRole="button"
              accessibilityState={{ checked: settings.showEditorLineNumbers }}
              onPress={() =>
                savePreference(update, {
                  showEditorLineNumbers: !settings.showEditorLineNumbers,
                })
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.rowLabel}>Show line numbers</Text>
                <Text style={styles.rowDetail}>
                  {settings.showEditorLineNumbers
                    ? "Visible in editable GLSL editors."
                    : "Hidden in editable GLSL editors."}
                </Text>
              </View>
              <Text style={styles.toggleValue}>
                {settings.showEditorLineNumbers ? "On" : "Off"}
              </Text>
            </Pressable>
            <View style={styles.separator} />
            <SettingRow
              detail="Preferences and shader edits are saved as you work."
              label="Changes save automatically"
            />
          </Section>
        </ScrollView>

        <BottomNavigation activeItem="settings" />
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
  },
  wordmark: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  eyebrow: {
    marginTop: Spacing.xxl,
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 3,
    color: Colors.text,
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -1,
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxxl,
  },
  section: {
    marginTop: Spacing.sm,
  },
  sectionTitle: {
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.xs,
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  card: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
  },
  preferenceBlock: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  preferenceLabel: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  preferenceHint: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  segmented: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  segment: {
    alignItems: "center",
    backgroundColor: Colors.surfaceRaised,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 40,
  },
  segmentSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  segmentText: {
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "800",
  },
  segmentTextSelected: {
    color: Colors.background,
  },
  row: {
    minHeight: 58,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  sketchRow: {
    minHeight: 62,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  rowCopy: {
    flex: 1,
  },
  rowLabel: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  rowDetail: {
    marginTop: 3,
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  disabledRow: {
    opacity: 0.52,
  },
  disabledText: {
    color: Colors.textMuted,
  },
  toggleValue: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
  },
  accountSummary: {
    padding: Spacing.lg,
    gap: Spacing.xs,
  },
  email: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  syncStatus: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 12,
    fontWeight: "800",
  },
  syncDetail: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.border,
  },
  notice: {
    marginBottom: Spacing.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.coral,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    gap: Spacing.sm,
  },
  noticeText: {
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    justifyContent: "center",
    borderRadius: Radius.sm,
    backgroundColor: Colors.coral,
  },
  retryText: {
    color: Colors.background,
    fontSize: 13,
    fontWeight: "800",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.62)",
  },
  modalSheet: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    overflow: "hidden",
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  modalDetail: {
    marginTop: 4,
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceRaised,
  },
  emptyText: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    color: Colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.72,
  },
});
