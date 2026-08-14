import { fireEvent, render, screen } from "@testing-library/react-native";

import { SketchListSheet } from "../sketch-list-sheet";
import { DEFAULT_SKETCH_METADATA } from "../../data/sketches/sketch-metadata";
import type { Sketch } from "../../data/sketches/sketch-repository";

const sketch = (id: string, title: string): Sketch => ({
  id,
  title,
  source: "fragColor = vec4(1.0);",
  metadata: DEFAULT_SKETCH_METADATA,
  metadataWarning: null,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
});

const props = () => ({
  sketches: [sketch("a", "Alpha"), sketch("b", "Beta")],
  activeSketchId: "a",
  onSelect: jest.fn(),
  onCreate: jest.fn(),
  onRename: jest.fn(),
  onDelete: jest.fn(),
  onClose: jest.fn(),
});

describe("SketchListSheet", () => {
  it("lists every sketch", async () => {
    await render(<SketchListSheet {...props()} />);

    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("marks the active sketch", async () => {
    await render(<SketchListSheet {...props()} />);

    expect(screen.getByTestId("sketch-row-a").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
    expect(screen.getByTestId("sketch-row-b").props.accessibilityState).toEqual(
      expect.objectContaining({ selected: false }),
    );
  });

  it("selects another sketch", async () => {
    const current = props();
    await render(<SketchListSheet {...current} />);

    await fireEvent.press(screen.getByText("Beta"));

    expect(current.onSelect).toHaveBeenCalledWith("b");
  });

  it("creates a new sketch", async () => {
    const current = props();
    await render(<SketchListSheet {...current} />);

    await fireEvent.press(screen.getByText("New sketch"));

    expect(current.onCreate).toHaveBeenCalled();
  });

  it("closes", async () => {
    const current = props();
    await render(<SketchListSheet {...current} />);

    await fireEvent.press(screen.getByLabelText("Close"));

    expect(current.onClose).toHaveBeenCalled();
  });

  it("renames a sketch through its inline field", async () => {
    const current = props();
    await render(<SketchListSheet {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-rename-a"));
    await fireEvent.changeText(screen.getByTestId("sketch-title-input"), "Renamed");
    await fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(current.onRename).toHaveBeenCalledWith("a", "Renamed");
  });

  it("trims a renamed title", async () => {
    const current = props();
    await render(<SketchListSheet {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-rename-a"));
    await fireEvent.changeText(screen.getByTestId("sketch-title-input"), "  Padded  ");
    await fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(current.onRename).toHaveBeenCalledWith("a", "Padded");
  });

  it("ignores a rename to an empty title", async () => {
    const current = props();
    await render(<SketchListSheet {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-rename-a"));
    await fireEvent.changeText(screen.getByTestId("sketch-title-input"), "   ");
    await fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(current.onRename).not.toHaveBeenCalled();
  });

  it("leaves rename mode after submitting", async () => {
    const current = props();
    await render(<SketchListSheet {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-rename-a"));
    await fireEvent.changeText(screen.getByTestId("sketch-title-input"), "Renamed");
    await fireEvent(screen.getByTestId("sketch-title-input"), "submitEditing");

    expect(screen.queryByTestId("sketch-title-input")).toBeNull();
  });

  it("deletes a sketch", async () => {
    const current = props();
    await render(<SketchListSheet {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-delete-b"));

    expect(current.onDelete).toHaveBeenCalledWith("b");
  });

  it("refuses to delete the last remaining sketch", async () => {
    const current = { ...props(), sketches: [sketch("a", "Alpha")] };
    await render(<SketchListSheet {...current} />);

    await fireEvent.press(screen.getByTestId("sketch-delete-a"));

    expect(current.onDelete).not.toHaveBeenCalled();
  });
});
