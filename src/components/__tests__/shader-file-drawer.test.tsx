import { Alert } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { ShaderFileDrawer } from "../shader-file-drawer";
import type { Sketch } from "../../data/sketches/sketch-repository";

const sketch = (
  id: string,
  title: string,
  category: string,
  updatedAt = "2026-08-06T13:45:00.000Z",
): Sketch => ({
  id,
  title,
  source: "fragColor = vec4(1.0);",
  metadata: { version: 1, category, parameters: [] },
  metadataWarning: null,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt,
});

const props = () => ({
  visible: true,
  sketches: [sketch("a", "Alpha", "Drafts"), sketch("b", "Beta", "Experiments")],
  activeSketchId: "a",
  onSelect: jest.fn(),
  onCreate: jest.fn(),
  onRename: jest.fn(),
  onDelete: jest.fn(),
  onClose: jest.fn(),
});

describe("ShaderFileDrawer", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });
  it("groups sketches by category and formats their modification metadata", async () => {
    await render(<ShaderFileDrawer {...props()} />);

    expect(screen.getByText("Drafts")).toBeTruthy();
    expect(screen.getByText("Experiments")).toBeTruthy();
    expect(screen.getAllByText("Modified Aug 6, 2026")).toHaveLength(2);
  });

  it("marks the active sketch", async () => {
    await render(<ShaderFileDrawer {...props()} />);

    expect(screen.getByTestId("sketch-row-a").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByTestId("sketch-row-b").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
  });

  it("selects another sketch", async () => {
    const current = props();
    await render(<ShaderFileDrawer {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-row-b"));

    expect(current.onSelect).toHaveBeenCalledWith("b");
  });

  it("creates a new sketch", async () => {
    const current = props();
    await render(<ShaderFileDrawer {...current} />);

    await fireEvent.press(screen.getByText("New sketch"));

    expect(current.onCreate).toHaveBeenCalledTimes(1);
  });

  it("renames a sketch through its inline field", async () => {
    const current = props();
    await render(<ShaderFileDrawer {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-rename-a"));
    await fireEvent.changeText(screen.getByTestId("sketch-title-input"), "  Renamed  ");
    await fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(current.onRename).toHaveBeenCalledWith("a", "Renamed");
    expect(screen.queryByTestId("sketch-title-input")).toBeNull();
  });

  it("does not rename a sketch to an empty title", async () => {
    const current = props();
    await render(<ShaderFileDrawer {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-rename-a"));
    await fireEvent.changeText(screen.getByTestId("sketch-title-input"), "  ");
    await fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(current.onRename).not.toHaveBeenCalled();
  });

  it("confirms deletion before deleting a sketch", async () => {
    const current = props();
    const alertSpy = jest.spyOn(Alert, "alert");
    await render(<ShaderFileDrawer {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-delete-b"));

    expect(current.onDelete).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Delete Beta?",
      "This shader file will be permanently deleted.",
      expect.arrayContaining([
        expect.objectContaining({ text: "Cancel" }),
        expect.objectContaining({ text: "Delete", style: "destructive" }),
      ]),
    );

    const deleteAction = alertSpy.mock.calls[0]?.[2]?.find((action) => action.text === "Delete");
    deleteAction?.onPress?.();

    expect(current.onDelete).toHaveBeenCalledWith("b");
  });

  it("refuses to delete the last remaining sketch", async () => {
    const current = { ...props(), sketches: [sketch("a", "Alpha", "Drafts")] };
    const alertSpy = jest.spyOn(Alert, "alert");
    await render(<ShaderFileDrawer {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-delete-a"));

    expect(alertSpy).not.toHaveBeenCalled();
    expect(current.onDelete).not.toHaveBeenCalled();
  });

  it("closes from the Close action and scrim", async () => {
    const close = jest.fn();
    const current = { ...props(), onClose: close };
    await render(<ShaderFileDrawer {...current} />);

    await fireEvent.press(screen.getByLabelText("Close"));
    await fireEvent.press(screen.getByTestId("shader-file-drawer-scrim"));

    expect(close).toHaveBeenCalledTimes(2);
  });

  it("closes from Android back requests", async () => {
    const current = props();
    await render(<ShaderFileDrawer {...current} />);

    await fireEvent(screen.getByTestId("shader-file-drawer-modal"), "requestClose");

    expect(current.onClose).toHaveBeenCalledTimes(1);
  });
});
