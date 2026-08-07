import { render, screen } from "@testing-library/react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { ShaderSandbox } from "../shader-sandbox";

// `GLView` fires `onContextCreate` with the project's fake GL context, so the render loop actually
// runs under Jest. This mirrors how `lesson-workspace.test.tsx` stands in for the preview.
jest.mock("expo-gl", () => {
  const React = require("react") as typeof import("react");
  const { View } = require("react-native") as typeof import("react-native");
  const { createFakeGl } = require("../../shaders/testing/fake-gl") as typeof import("../../shaders/testing/fake-gl");

  return {
    GLView: ({
      onContextCreate,
      style,
    }: {
      onContextCreate?: (gl: unknown) => void;
      style?: StyleProp<ViewStyle>;
    }) => {
      React.useEffect(() => {
        onContextCreate?.(createFakeGl());
      }, [onContextCreate]);

      return React.createElement(View, { style, testID: "gl-view" });
    },
  };
});

describe("ShaderSandbox", () => {
  it("renders a GL surface", async () => {
    await render(<ShaderSandbox source="fragColor = vec4(1.0);" />);

    expect(screen.getByTestId("gl-view")).toBeTruthy();
  });

  it("shows a placeholder until a program has compiled", async () => {
    // An empty body never reaches `ShaderProgramHost.setBody`'s compile path (it takes the
    // half-typed-source early return), so `hasProgram()` stays false regardless of `active` — unlike
    // a compiling source, which would flip it true on mount even while inactive, since compilation
    // isn't gated by `active`, only the frame loop is.
    await render(<ShaderSandbox active={false} source="" />);

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

describe("ShaderSandbox render loop", () => {
  beforeEach(() => {
    jest.spyOn(globalThis, "requestAnimationFrame").mockImplementation(() => 1 as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("draws when active", async () => {
    await render(<ShaderSandbox source="fragColor = vec4(1.0);" />);

    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
  });

  it("does not start the loop when mounted inactive", async () => {
    await render(<ShaderSandbox active={false} source="fragColor = vec4(1.0);" />);

    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });

  it("starts the loop when it becomes active", async () => {
    const view = await render(<ShaderSandbox active={false} source="fragColor = vec4(1.0);" />);
    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();

    await view.rerender(<ShaderSandbox active source="fragColor = vec4(1.0);" />);

    expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
  });

  it("does not schedule twice when active is set again", async () => {
    const view = await render(<ShaderSandbox active source="fragColor = vec4(1.0);" />);
    const afterMount = (globalThis.requestAnimationFrame as jest.Mock).mock.calls.length;

    await view.rerender(<ShaderSandbox active source="fragColor = vec4(1.0);" />);

    expect((globalThis.requestAnimationFrame as jest.Mock).mock.calls.length).toBe(afterMount);
  });
});
