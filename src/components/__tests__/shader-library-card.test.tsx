import { fireEvent, render, screen } from "@testing-library/react-native";

import { ShaderLibraryCard } from "../shader-library-card";
import { DEFAULT_SKETCH_METADATA } from "../../data/sketches/sketch-metadata";
import type { Sketch } from "../../data/sketches/sketch-repository";

const mockSandbox = jest.fn();

jest.mock("../shader-sandbox", () => ({
  ShaderSandbox: (props: unknown) => {
    mockSandbox(props);
    const { View } = require("react-native") as typeof import("react-native");
    return <View testID="library-card-sandbox" />;
  },
}));

const sketch: Sketch = {
  id: "sketch-a",
  title: "Noise wave",
  source: "fragColor = vec4(0.25);",
  metadata: {
    ...DEFAULT_SKETCH_METADATA,
    category: "Experiments",
    parameters: [
      {
        key: "uStrength",
        label: "Strength",
        min: 0,
        max: 1,
        step: 0.1,
        defaultValue: 0.5,
        value: 0.7,
      },
    ],
  },
  metadataWarning: null,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-14T10:00:00.000Z",
};

describe("ShaderLibraryCard", () => {
  beforeEach(() => {
    mockSandbox.mockClear();
  });

  it("passes the saved source, parameters, and visibility to the preview", async () => {
    await render(<ShaderLibraryCard active={false} onPress={jest.fn()} sketch={sketch} />);

    expect(mockSandbox).toHaveBeenLastCalledWith(
      expect.objectContaining({
        active: false,
        parameters: sketch.metadata.parameters,
        source: sketch.source,
      }),
    );
  });

  it("opens the sketch when pressed", async () => {
    const onPress = jest.fn();
    await render(<ShaderLibraryCard active onPress={onPress} sketch={sketch} />);

    await fireEvent.press(screen.getByTestId("shader-library-card-sketch-a"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});