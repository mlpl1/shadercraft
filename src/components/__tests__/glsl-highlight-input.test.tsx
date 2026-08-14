import { render, screen } from "@testing-library/react-native";

import { GlslInput } from "../glsl-input";

describe("GlslInput syntax highlighting", () => {
  it("renders highlighted source behind the native input", async () => {
    await render(<GlslInput errors={[]} initialValue="vec3 color = 1.0;" onChange={() => undefined} />);

    expect(screen.getByTestId("glsl-highlight")).toBeTruthy();
    expect(screen.getByTestId("glsl-highlight-type")).toHaveTextContent("vec3");
    expect(screen.getByTestId("glsl-highlight-number")).toHaveTextContent("1.0");
    expect(screen.getByTestId("glsl-input")).toBeTruthy();
  });
});
