import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Slider from "@react-native-community/slider";

import { Colors, Radius, Spacing } from "../constants/theme";
import {
  isValidShaderParameterKey,
  normalizeShaderParameterDefinition,
  type ShaderParameterDefinition,
} from "../data/sketches/sketch-metadata";

type ShaderParametersPanelProps = {
  parameters: ShaderParameterDefinition[];
  onChange: (next: ShaderParameterDefinition[]) => void;
  onClose: () => void;
};

type ParameterDraft = {
  key: string;
  label: string;
  min: string;
  max: string;
  step: string;
  defaultValue: string;
};

const EMPTY_DRAFT: ParameterDraft = {
  key: "",
  label: "",
  min: "0",
  max: "1",
  step: "0.1",
  defaultValue: "0",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function draftFrom(parameter: ShaderParameterDefinition): ParameterDraft {
  return {
    key: parameter.key,
    label: parameter.label,
    min: String(parameter.min),
    max: String(parameter.max),
    step: String(parameter.step),
    defaultValue: String(parameter.defaultValue),
  };
}

function numberFrom(value: string): number | null {
  if (value.trim().length === 0) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Compact live controls by default, with the structural editing tools behind Manage. This keeps
 * the shader tuning path slider-first while still letting a learner define their own uniforms.
 */
export function ShaderParametersPanel({
  parameters,
  onChange,
  onClose,
}: ShaderParametersPanelProps) {
  const [managing, setManaging] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ParameterDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);

  const updateDraft = (field: keyof ParameterDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(null);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingIndex(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const openAdd = () => {
    setFormOpen(true);
    setDraft(EMPTY_DRAFT);
    setEditingIndex(null);
    setError(null);
  };

  const openEdit = (index: number) => {
    setFormOpen(true);
    setDraft(draftFrom(parameters[index]));
    setEditingIndex(index);
    setError(null);
  };

  const saveDefinition = () => {
    const key = draft.key.trim();
    const label = draft.label.trim();
    if (!isValidShaderParameterKey(key)) {
      setError("Use a valid GLSL uniform key.");
      return;
    }
    if (parameters.some((parameter, index) => parameter.key === key && index !== editingIndex)) {
      setError("A parameter with this key already exists.");
      return;
    }
    if (label.length === 0) {
      setError("Enter a parameter label.");
      return;
    }

    const min = numberFrom(draft.min);
    const max = numberFrom(draft.max);
    const step = numberFrom(draft.step);
    const defaultValue = numberFrom(draft.defaultValue);
    if (min === null || max === null || step === null || defaultValue === null) {
      setError("Enter finite numeric values for every range field.");
      return;
    }

    try {
      const currentValue = editingIndex === null ? defaultValue : parameters[editingIndex].value;
      const definition = normalizeShaderParameterDefinition({
        key,
        label,
        min,
        max,
        step,
        defaultValue,
        value: currentValue,
      });
      const next = [...parameters];
      if (editingIndex === null) next.push(definition);
      else next[editingIndex] = definition;
      onChange(next);
      closeForm();
    } catch {
      setError("Maximum must exceed minimum and step must be greater than zero.");
    }
  };

  const confirmRemove = (index: number) => {
    const parameter = parameters[index];
    Alert.alert("Remove parameter?", `Remove \"${parameter.label}\" from this sketch?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => onChange(parameters.filter((_, currentIndex) => currentIndex !== index)),
      },
    ]);
  };

  if (managing) {
    const editing = editingIndex !== null;
    return (
      <View style={styles.panel}>
        <View style={styles.header}>
          <Text style={styles.heading}>Manage parameters</Text>
          <Pressable
            accessibilityLabel="Close shader parameters"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClose}
          >
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>

        {formOpen ? (
          <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
            <Field label="Parameter key" onChangeText={(value) => updateDraft("key", value)} value={draft.key} />
            <Field label="Parameter label" onChangeText={(value) => updateDraft("label", value)} value={draft.label} />
            <Field label="Minimum value" onChangeText={(value) => updateDraft("min", value)} value={draft.min} />
            <Field label="Maximum value" onChangeText={(value) => updateDraft("max", value)} value={draft.max} />
            <Field label="Step value" onChangeText={(value) => updateDraft("step", value)} value={draft.step} />
            <Field label="Default value" onChangeText={(value) => updateDraft("defaultValue", value)} value={draft.defaultValue} />
            {error !== null && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
            <View style={styles.formActions}>
              <Pressable accessibilityRole="button" onPress={closeForm} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={saveDefinition} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>{editing ? "Save parameter" : "Add parameter"}</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <>
            <ScrollView contentContainerStyle={styles.definitionList} keyboardShouldPersistTaps="handled">
              {parameters.map((parameter, index) => (
                <View key={parameter.key} style={styles.definitionRow}>
                  <View style={styles.definitionText}>
                    <Text style={styles.definitionLabel}>{parameter.label}</Text>
                    <Text style={styles.definitionKey}>{parameter.key}</Text>
                  </View>
                  <Pressable accessibilityLabel={`Edit ${parameter.label}`} accessibilityRole="button" onPress={() => openEdit(index)}>
                    <Text style={styles.action}>Edit</Text>
                  </Pressable>
                  <Pressable accessibilityLabel={`Remove ${parameter.label}`} accessibilityRole="button" onPress={() => confirmRemove(index)}>
                    <Text style={[styles.action, styles.removeAction]}>Remove</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
            <Pressable accessibilityLabel="Add shader parameter" accessibilityRole="button" onPress={openAdd} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Add parameter</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.heading}>Parameters</Text>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="Manage shader parameters" accessibilityRole="button" onPress={() => setManaging(true)}>
            <Text style={styles.action}>Manage</Text>
          </Pressable>
          <Pressable accessibilityLabel="Close shader parameters" accessibilityRole="button" hitSlop={8} onPress={onClose}>
            <Text style={styles.close}>Close</Text>
          </Pressable>
        </View>
      </View>
      {parameters.length === 0 ? (
        <Text style={styles.empty}>No saved parameters yet.</Text>
      ) : (
        parameters.map((parameter) => (
          <View key={parameter.key} style={styles.sliderRow}>
            <View style={styles.sliderHeading}>
              <Text style={styles.sliderLabel}>{parameter.label}</Text>
              <Text style={styles.sliderValue}>{parameter.value}</Text>
            </View>
            <Slider
              accessibilityLabel={`${parameter.label} value`}
              maximumValue={parameter.max}
              minimumTrackTintColor={Colors.accent}
              minimumValue={parameter.min}
              onValueChange={(value) => onChange(parameters.map((item) => (
                item.key === parameter.key ? { ...item, value: clamp(value, item.min, item.max) } : item
              )))}
              step={parameter.step}
              testID={`parameter-slider-${parameter.key}`}
              thumbTintColor={Colors.accent}
              value={parameter.value}
            />
          </View>
        ))
      )}
    </View>
  );
}

function Field({ label, onChangeText, value }: { label: string; onChangeText: (value: string) => void; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={label === "Parameter key" || label === "Parameter label" ? "default" : "decimal-pad"}
        onChangeText={onChangeText}
        selectTextOnFocus
        style={styles.input}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: Colors.surface, borderTopColor: Colors.border, borderTopWidth: StyleSheet.hairlineWidth, padding: Spacing.md },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: Spacing.sm },
  headerActions: { alignItems: "center", flexDirection: "row", gap: Spacing.lg },
  heading: { color: Colors.text, fontSize: 14, fontWeight: "600" },
  close: { color: Colors.textMuted, fontSize: 12 },
  action: { color: Colors.cyan, fontSize: 12 },
  removeAction: { color: Colors.coral },
  empty: { color: Colors.textSubtle, fontSize: 12, paddingVertical: Spacing.sm },
  sliderRow: { paddingVertical: Spacing.sm },
  sliderHeading: { flexDirection: "row", justifyContent: "space-between" },
  sliderLabel: { color: Colors.textMuted, fontSize: 13 },
  sliderValue: { color: Colors.accent, fontSize: 13, fontVariant: ["tabular-nums"] },
  definitionList: { gap: Spacing.xs },
  definitionRow: { alignItems: "center", borderBottomColor: Colors.border, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: Spacing.md, paddingVertical: Spacing.sm },
  definitionText: { flex: 1 },
  definitionLabel: { color: Colors.text, fontSize: 14 },
  definitionKey: { color: Colors.textSubtle, fontSize: 11 },
  form: { gap: Spacing.sm, paddingBottom: Spacing.sm },
  field: { gap: Spacing.xs },
  fieldLabel: { color: Colors.textMuted, fontSize: 12 },
  input: { borderColor: Colors.border, borderRadius: Radius.sm, borderWidth: StyleSheet.hairlineWidth, color: Colors.text, fontSize: 14, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  error: { color: Colors.coral, fontSize: 12 },
  formActions: { flexDirection: "row", gap: Spacing.sm, justifyContent: "flex-end", marginTop: Spacing.sm },
  secondaryButton: { borderColor: Colors.border, borderRadius: Radius.sm, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  secondaryButtonText: { color: Colors.textMuted, fontSize: 13, fontWeight: "600" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.accent, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  primaryButtonText: { color: Colors.background, fontSize: 13, fontWeight: "700" },
});
