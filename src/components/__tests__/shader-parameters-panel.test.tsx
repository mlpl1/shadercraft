import { Alert } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { ShaderParametersPanel } from "../shader-parameters-panel";
import type { ShaderParameterDefinition } from "../../data/sketches/sketch-metadata";

jest.mock("@react-native-community/slider", () => "Slider");

const GAIN: ShaderParameterDefinition = {
  key: "u_gain",
  label: "Gain",
  min: 0,
  max: 2,
  step: 0.1,
  defaultValue: 1,
  value: 1.2,
};

const props = (overrides: Partial<Parameters<typeof ShaderParametersPanel>[0]> = {}) => ({
  parameters: [GAIN],
  onChange: jest.fn(),
  onClose: jest.fn(),
  ...overrides,
});

async function openAddForm() {
  await fireEvent.press(screen.getByLabelText("Manage shader parameters"));
  await fireEvent.press(screen.getByLabelText("Add shader parameter"));
}

async function completeForm(values: Partial<Record<string, string>> = {}) {
  const fields = {
    key: "u_speed",
    label: "Speed",
    min: "0",
    max: "3",
    step: "0.1",
    defaultValue: "1",
    ...values,
  };

  await fireEvent.changeText(screen.getByLabelText("Parameter key"), fields.key);
  await fireEvent.changeText(screen.getByLabelText("Parameter label"), fields.label);
  await fireEvent.changeText(screen.getByLabelText("Minimum value"), fields.min);
  await fireEvent.changeText(screen.getByLabelText("Maximum value"), fields.max);
  await fireEvent.changeText(screen.getByLabelText("Step value"), fields.step);
  await fireEvent.changeText(screen.getByLabelText("Default value"), fields.defaultValue);
}

describe("ShaderParametersPanel", () => {
  it("shows saved parameter labels and current values in compact slider mode", async () => {
    await render(<ShaderParametersPanel {...props()} />);

    expect(screen.getByText("Gain")).toBeTruthy();
    expect(screen.getByText("1.2")).toBeTruthy();
    expect(screen.getByTestId("parameter-slider-u_gain")).toBeTruthy();
  });

  it("emits a new clamped parameter array when a slider changes", async () => {
    const current = props();
    await render(<ShaderParametersPanel {...current} />);

    await fireEvent(screen.getByTestId("parameter-slider-u_gain"), "valueChange", 3);

    expect(current.onChange).toHaveBeenCalledWith([
      expect.objectContaining({ key: "u_gain", value: 2 }),
    ]);
  });

  it("returns from management to the compact sliders without closing the panel", async () => {
    const current = props();
    await render(<ShaderParametersPanel {...current} />);

    await fireEvent.press(screen.getByLabelText("Manage shader parameters"));
    await fireEvent.press(screen.getByRole("button", { name: "Done managing parameters" }));

    expect(screen.getByTestId("parameter-slider-u_gain")).toBeTruthy();
    expect(current.onClose).not.toHaveBeenCalled();
  });

  it("opens the parameter form from manage mode", async () => {
    await render(<ShaderParametersPanel {...props()} />);

    await openAddForm();

    expect(screen.getByLabelText("Parameter key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add parameter" })).toBeTruthy();
  });

  it.each([
    ["invalid", "9speed", "Use a valid GLSL uniform key."],
    ["reserved", "float", "Use a valid GLSL uniform key."],
    ["duplicate", "u_gain", "A parameter with this key already exists."],
  ])("shows an inline error for a %s key", async (_kind, key, message) => {
    const current = props();
    await render(<ShaderParametersPanel {...current} />);
    await openAddForm();
    await completeForm({ key });

    await fireEvent.press(screen.getByRole("button", { name: "Add parameter" }));

    expect(screen.getByText(message)).toBeTruthy();
    expect(current.onChange).not.toHaveBeenCalled();
  });

  it("rejects a blank range field before emitting a definition", async () => {
    const current = props({ parameters: [] });
    await render(<ShaderParametersPanel {...current} />);
    await openAddForm();
    await completeForm({ min: "" });

    await fireEvent.press(screen.getByRole("button", { name: "Add parameter" }));

    expect(screen.getByText("Enter finite numeric values for every range field.")).toBeTruthy();
    expect(current.onChange).not.toHaveBeenCalled();
  });
  it("adds a valid definition through the shared metadata normalizer", async () => {
    const current = props({ parameters: [] });
    await render(<ShaderParametersPanel {...current} />);
    await openAddForm();
    await completeForm();

    await fireEvent.press(screen.getByRole("button", { name: "Add parameter" }));

    expect(current.onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        key: "u_speed",
        label: "Speed",
        min: 0,
        max: 3,
        step: 0.1,
        defaultValue: 1,
        value: 1,
      }),
    ]);
  });

  it("preserves a current value that remains in range when editing", async () => {
    const current = props({ parameters: [{ ...GAIN, value: 1.6 }] });
    await render(<ShaderParametersPanel {...current} />);
    await fireEvent.press(screen.getByLabelText("Manage shader parameters"));
    await fireEvent.press(screen.getByLabelText("Edit Gain"));
    await fireEvent.changeText(screen.getByLabelText("Parameter label"), "Master gain");

    await fireEvent.press(screen.getByRole("button", { name: "Save parameter" }));

    expect(current.onChange).toHaveBeenCalledWith([
      expect.objectContaining({ key: "u_gain", label: "Master gain", value: 1.6 }),
    ]);
  });

  it("waits for removal confirmation before emitting the remaining definitions", async () => {
    const current = props();
    const alert = jest.spyOn(Alert, "alert");
    await render(<ShaderParametersPanel {...current} />);
    await fireEvent.press(screen.getByLabelText("Manage shader parameters"));

    await fireEvent.press(screen.getByLabelText("Remove Gain"));

    expect(alert).toHaveBeenCalledWith(
      "Remove parameter?",
      'Remove "Gain" from this sketch?',
      expect.arrayContaining([expect.objectContaining({ text: "Cancel" }), expect.objectContaining({ text: "Remove" })]),
    );
    expect(current.onChange).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0]?.[2] ?? [];
    buttons.find((button) => button.text === "Remove")?.onPress?.();

    expect(current.onChange).toHaveBeenCalledWith([]);
    alert.mockRestore();
  });
});
