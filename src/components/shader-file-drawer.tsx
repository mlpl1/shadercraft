import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppIcon } from "./app-icon";
import { Colors, Radius, Spacing } from "../constants/theme";
import type { Sketch } from "../data/sketches/sketch-repository";

type ShaderFileDrawerProps = {
  busy?: boolean;
  visible: boolean;
  sketches: Sketch[];
  activeSketchId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

function formatModifiedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "Modified recently";

  return `Modified ${date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  })}`;
}

function groupByCategory(sketches: Sketch[]): Array<[string, Sketch[]]> {
  const grouped = new Map<string, Sketch[]>();

  for (const sketch of sketches) {
    const category = sketch.metadata.category;
    const files = grouped.get(category);
    if (files) files.push(sketch);
    else grouped.set(category, [sketch]);
  }

  return [...grouped.entries()];
}

export function ShaderFileDrawer({
  busy = false,
  visible,
  sketches,
  activeSketchId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: ShaderFileDrawerProps) {
  const insets = useSafeAreaInsets();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const progress = useRef(new Animated.Value(0)).current;
  const categories = groupByCategory(sketches);
  const canDelete = sketches.length > 1;

  useEffect(() => {
    Animated.timing(progress, {
      duration: visible ? 180 : 0,
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

  const submitRename = (id: string) => {
    if (busy) return;
    const trimmed = draftTitle.trim();
    setRenamingId(null);
    if (trimmed.length > 0) onRename(id, trimmed);
  };

  const confirmDelete = (sketch: Sketch) => {
    if (busy || !canDelete) return;

    Alert.alert("Delete " + sketch.title + "?", "This shader file will be permanently deleted.", [
      { style: "cancel", text: "Cancel" },
      { onPress: () => onDelete(sketch.id), style: "destructive", text: "Delete" },
    ]);
  };

  const requestClose = () => {
    if (!busy) onClose();
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={requestClose}
      testID="shader-file-drawer-modal"
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Close file drawer"
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={requestClose}
          style={styles.scrim}
          testID="shader-file-drawer-scrim"
        />

        <Animated.View
          style={[
            styles.drawer,
            { paddingLeft: insets.left },
            {
              transform: [
                {
                  translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-288, 0] }),
                },
              ],
            },
          ]}
          testID="shader-file-drawer-panel"
        >
          <View
            style={[styles.header, { paddingTop: Spacing.lg + insets.top }]}
            testID="shader-file-drawer-header"
          >
            <Text style={styles.heading}>Shadercraft Files</Text>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              hitSlop={8}
              onPress={requestClose}
            >
              <AppIcon
                color={Colors.textMuted}
                fallback="X"
                name={{ android: "close", ios: "xmark", web: "close" }}
                size={20}
              />
            </Pressable>
          </View>

          <ScrollView style={styles.list}>
            {categories.map(([category, files]) => (
              <View key={category} style={styles.category}>
                <Text style={styles.categoryHeading}>{category}</Text>
                {files.map((sketch) => (
                  <View key={sketch.id} style={styles.row}>
                    {renamingId === sketch.id ? (
                      <TextInput
                        autoFocus
                        editable={!busy}
                        onChangeText={setDraftTitle}
                        onSubmitEditing={() => submitRename(sketch.id)}
                        style={styles.titleInput}
                        testID="sketch-title-input"
                        value={draftTitle}
                      />
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{
                          disabled: busy,
                          selected: sketch.id === activeSketchId,
                        }}
                        disabled={busy}
                        onPress={() => onSelect(sketch.id)}
                        style={[
                          styles.file,
                          sketch.id === activeSketchId && styles.fileActive,
                        ]}
                        testID={`sketch-row-${sketch.id}`}
                      >
                        <Text
                          numberOfLines={1}
                          style={[styles.title, sketch.id === activeSketchId && styles.titleActive]}
                        >
                          {sketch.title}
                        </Text>
                        <Text style={styles.modified}>{formatModifiedAt(sketch.updatedAt)}</Text>
                      </Pressable>
                    )}

                    <View style={styles.actions}>
                      <Pressable
                        accessibilityLabel={`Rename ${sketch.title}`}
                        accessibilityRole="button"
                        disabled={busy}
                        hitSlop={8}
                        onPress={() => {
                          setRenamingId(sketch.id);
                          setDraftTitle(sketch.title);
                        }}
                        testID={`sketch-rename-${sketch.id}`}
                      >
                        <Text style={styles.action}>Rename</Text>
                      </Pressable>
                      <Pressable
                        accessibilityLabel={`Delete ${sketch.title}`}
                        accessibilityRole="button"
                        disabled={busy || !canDelete}
                        hitSlop={8}
                        onPress={() => confirmDelete(sketch)}
                        testID={`sketch-delete-${sketch.id}`}
                      >
                        <Text style={[styles.action, (busy || !canDelete) && styles.actionDisabled]}>
                          Delete
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>

          <View
            style={[styles.footer, { paddingBottom: Spacing.lg + insets.bottom }]}
            testID="shader-file-drawer-footer"
          >
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onCreate}
              style={({ pressed }) => [
                styles.createButton,
                (pressed || busy) && styles.createButtonPressed,
              ]}
            >
              <Text style={styles.createButtonText}>New sketch</Text>
            </Pressable>
            <Text style={styles.storage}>Internal App Storage</Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  scrim: {
    backgroundColor: "rgba(0, 0, 0, 0.78)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  drawer: {
    backgroundColor: Colors.background,
    borderRightColor: Colors.border,
    borderRightWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    maxWidth: 288,
    position: "absolute",
    top: 0,
    width: "82%",
  },
  header: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderBottomColor: Colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  heading: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  list: {
    flex: 1,
  },
  category: {
    borderBottomColor: Colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: Spacing.sm,
  },
  categoryHeading: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.8,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    textTransform: "uppercase",
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  file: {
    borderRadius: Radius.sm,
    flex: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  fileActive: {
    backgroundColor: Colors.accent,
  },
  title: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: "600",
  },
  titleActive: {
    color: Colors.background,
  },
  modified: {
    color: Colors.textSubtle,
    fontSize: 10,
    marginTop: Spacing.xs,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  action: {
    color: Colors.textSubtle,
    fontSize: 11,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  titleInput: {
    borderBottomColor: Colors.accent,
    borderBottomWidth: 1,
    color: Colors.text,
    flex: 1,
    fontSize: 13,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  footer: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  createButton: {
    alignItems: "center",
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
  },
  createButtonPressed: {
    opacity: 0.85,
  },
  createButtonText: {
    color: Colors.background,
    fontSize: 14,
    fontWeight: "700",
  },
  storage: {
    color: Colors.textSubtle,
    fontSize: 11,
  },
});
