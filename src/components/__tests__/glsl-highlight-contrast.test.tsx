import { render, screen } from "@testing-library/react-native";

import { GlslInput } from "../glsl-input";

describe("GLSL highlight contrast", () => {
  it("keeps the highlight layer above the transparent native input", async () => {
    await render(<GlslInput errors={[]} initialValue="vec3 color = 1.0;" onChange={() => undefined} />);

    expect(screen.getByTestId("glsl-input").props.style).toEqual(
      expect.objectContaining({ backgroundColor: "transparent", zIndex: 1 }),
    );
    expect(screen.getByTestId("glsl-highlight").props.style).toEqual(
      expect.objectContaining({ opacity: 1, zIndex: 2 }),
    );
  });
});