import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { AppIcon } from "./app-icon";
import { Colors, Radius, Spacing } from "../constants/theme";
import type { Sketch } from "../data/sketches/sketch-repository";

type SketchListSheetProps = {
  sketches: Sketch[];
  activeSketchId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export function SketchListSheet({
  sketches,
  activeSketchId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: SketchListSheetProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");

  const submitRename = (id: string) => {
    const trimmed = draftTitle.trim();
    setRenamingId(null);
    // An empty title would leave a row with nothing to tap, so a blank submission is a cancel.
    if (trimmed.length > 0) onRename(id, trimmed);
  };

  // Deleting the only sketch would leave the editor with nothing to open, and the screen would
  // immediately recreate a starter — confusing rather than helpful.
  const canDelete = sketches.length > 1;

  return (
    <View style={styles.sheet}>
      <View style={styles.header}>
        <Text style={styles.heading}>Sketches</Text>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" hitSlop={8} onPress={onClose}>
          <AppIcon
            color={Colors.textMuted}
            fallback="X"
            name={{ android: "close", ios: "xmark", web: "close" }}
            size={20}
          />
        </Pressable>
      </View>

      <ScrollView style={styles.list}>
        {sketches.map((sketch) => (
          <View key={sketch.id} style={styles.row}>
            {renamingId === sketch.id ? (
              <TextInput
                autoFocus
                onChangeText={setDraftTitle}
                onSubmitEditing={() => submitRename(sketch.id)}
                style={styles.titleInput}
                testID="sketch-title-input"
                value={draftTitle}
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: sketch.id === activeSketchId }}
                onPress={() => onSelect(sketch.id)}
                style={styles.rowTitle}
                testID={`sketch-row-${sketch.id}`}
              >
                <Text
                  numberOfLines={1}
                  style={[styles.title, sketch.id === activeSketchId && styles.titleActive]}
                >
                  {sketch.title}
                </Text>
              </Pressable>
            )}

            <Pressable
              accessibilityLabel={`Rename ${sketch.title}`}
              accessibilityRole="button"
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
              disabled={!canDelete}
              hitSlop={8}
              onPress={() => onDelete(sketch.id)}
              testID={`sketch-delete-${sketch.id}`}
            >
              <Text style={[styles.action, !canDelete && styles.actionDisabled]}>Delete</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        onPress={onCreate}
        style={({ pressed }) => [styles.createButton, pressed && styles.createButtonPressed]}
      >
        <Text style={styles.createButtonText}>New sketch</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: "70%",
    paddingBottom: Spacing.lg,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
  },
  heading: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "600",
  },
  list: {
    flexGrow: 0,
  },
  row: {
    alignItems: "center",
    borderTopColor: Colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },
  rowTitle: {
    flex: 1,
  },
  title: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  titleActive: {
    color: Colors.accent,
    fontWeight: "600",
  },
  titleInput: {
    borderBottomColor: Colors.accent,
    borderBottomWidth: 1,
    color: Colors.text,
    flex: 1,
    fontSize: 14,
    paddingVertical: Spacing.xs,
  },
  action: {
    color: Colors.textSubtle,
    fontSize: 12,
  },
  actionDisabled: {
    opacity: 0.4,
  },
  createButton: {
    alignItems: "center",
    backgroundColor: Colors.accent,
    borderRadius: Radius.md,
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.lg,
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
});
