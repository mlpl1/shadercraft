import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { GlslInput } from "../glsl-input";

describe("GlslInput syntax highlighting", () => {
  it("renders highlighted source behind the native input", async () => {
    await render(<GlslInput errors={[]} initialValue="vec3 color = 1.0;" onChange={() => undefined} />);

    expect(screen.getByTestId("glsl-highlight")).toBeTruthy();
    expect(screen.getByTestId("glsl-highlight-type")).toHaveTextContent("vec3");
    expect(screen.getByTestId("glsl-highlight-number")).toHaveTextContent("1.0");
    expect(screen.getByTestId("glsl-input")).toBeTruthy();
  });

  it("applies the selected editor font metrics to highlighted and editable text", async () => {
    await render(
      <GlslInput errors={[]} fontSize={16} initialValue="vec3 color = 1.0;" onChange={() => undefined} />,
    );

    const highlightStyle = StyleSheet.flatten(screen.getByTestId("glsl-highlight").props.style);
    const inputStyle = StyleSheet.flatten(screen.getByTestId("glsl-input").props.style);

    expect(highlightStyle.fontSize).toBe(16);
    expect(inputStyle.fontSize).toBe(16);
    expect(highlightStyle.lineHeight).toBe(25);
    expect(inputStyle.lineHeight).toBe(25);
  });
});