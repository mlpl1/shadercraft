import { render, screen } from "@testing-library/react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { ShaderSandbox } from "../shader-sandbox";

// `GLView` never receives a context under Jest, so it is replaced with a view that records the props
// the sandbox hands it. This mirrors how `lesson-workspace.test.tsx` stands in for the preview.
jest.mock("expo-gl", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");

  return {
    GLView: ({ style }: { style?: StyleProp<ViewStyle> }) =>
      React.createElement(View, { style, testID: "gl-view" }),
  };
});

describe("ShaderSandbox", () => {
  it("renders a GL surface", async () => {
    await render(<ShaderSandbox source="fragColor = vec4(1.0);" />);

    expect(screen.getByTestId("gl-view")).toBeTruthy();
  });

  it("shows a placeholder until a program has compiled", async () => {
    await render(<ShaderSandbox source="fragColor = vec4(1.0);" />);

    expect(screen.getByText("Preview starts once your shader compiles")).toBeTruthy();
  });

  it("honours an explicit height", async () => {
    await render(<ShaderSandbox height={120} source="fragColor = vec4(1.0);" />);

    // The style prop is an array — the base stylesheet entry plus the height override.
    expect(screen.getByTestId("shader-sandbox").props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ height: 120 })]),
    );
  });
});
