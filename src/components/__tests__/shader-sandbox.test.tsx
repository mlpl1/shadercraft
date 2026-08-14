import { render, screen } from "@testing-library/react-native";
import type { StyleProp, ViewStyle } from "react-native";

import type { ShaderParameterDefinition } from "../../data/sketches/sketch-metadata";
import { ShaderSandbox } from "../shader-sandbox";

const mockHosts: Array<{
  dispose: jest.Mock;
  hasProgram: jest.Mock;
  render: jest.Mock;
  setBody: jest.Mock;
  setParameterValues: jest.Mock;
}> = [];

jest.mock("../../shaders/shader-program-host", () => ({
  ShaderProgramHost: jest.fn().mockImplementation(() => {
    let hasProgram = false;
    const host = {
      dispose: jest.fn(),
      hasProgram: jest.fn(() => hasProgram),
      render: jest.fn(),
      setBody: jest.fn((body: string) => {
        hasProgram = body.trim().length > 0;
        return { ok: true };
      }),
      setParameterValues: jest.fn(),
    };
    mockHosts.push(host);
    return host;
  }),
}));

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

const GAIN_PARAMETER: ShaderParameterDefinition = {
  key: "u_gain",
  label: "Gain",
  min: 0,
  max: 2,
  step: 0.1,
  defaultValue: 1,
  value: 1,
};

beforeEach(() => {
  mockHosts.length = 0;
});

describe("ShaderSandbox", () => {
  it("passes parameter definitions to the initial shader compilation", async () => {
    await render(
      <ShaderSandbox
        helpers="float boost(float value) { return value * 2.0; }"
        parameters={[GAIN_PARAMETER]}
        source="fragColor = vec4(u_gain);"
      />,
    );

    expect(mockHosts).toHaveLength(1);
    expect(mockHosts[0].setBody).toHaveBeenLastCalledWith(
      "fragColor = vec4(u_gain);",
      "float boost(float value) { return value * 2.0; }",
      [GAIN_PARAMETER],
    );
  });

  it("updates parameter values without recompiling or recreating the host", async () => {
    const view = await render(
      <ShaderSandbox parameters={[GAIN_PARAMETER]} source="fragColor = vec4(u_gain);" />,
    );
    const host = mockHosts[0];
    const initialCompileCount = host.setBody.mock.calls.length;

    await view.rerender(
      <ShaderSandbox
        parameters={[{ ...GAIN_PARAMETER, value: 1.5 }]}
        source="fragColor = vec4(u_gain);"
      />,
    );

    expect(mockHosts).toHaveLength(1);
    expect(host.setBody).toHaveBeenCalledTimes(initialCompileCount);
    expect(host.setParameterValues).toHaveBeenCalledWith({ u_gain: 1.5 });
  });

  it("recompiles when a parameter definition changes", async () => {
    const view = await render(
      <ShaderSandbox parameters={[GAIN_PARAMETER]} source="fragColor = vec4(u_gain);" />,
    );
    const host = mockHosts[0];
    const initialCompileCount = host.setBody.mock.calls.length;

    const changedDefinition = { ...GAIN_PARAMETER, max: 3 };
    await view.rerender(
      <ShaderSandbox parameters={[changedDefinition]} source="fragColor = vec4(u_gain);" />,
    );

    expect(host.setBody).toHaveBeenCalledTimes(initialCompileCount + 1);
    expect(host.setBody).toHaveBeenLastCalledWith(
      "fragColor = vec4(u_gain);",
      undefined,
      [changedDefinition],
    );
  });

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
