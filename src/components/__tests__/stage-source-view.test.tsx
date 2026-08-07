import { render, screen } from "@testing-library/react-native";

import { StageSourceView } from "../stage-source-view";

// Blank lines between logical groups, the shape Module 3's stages introduced and the shape that
// broke the previous per-line rendering.
const SOURCE = "vec2 uv = fragCoord / iResolution.xy;\n\nfloat d = length(uv);\n\nfragColor = vec4(d);";

it("renders the source as a single selectable node so a selection can span lines", async () => {
  await render(<StageSourceView source={SOURCE} />);

  const code = screen.getByTestId("stage-source-code");

  // One node holding everything: selection cannot cross `Text` boundaries, so splitting the source
  // per line would cap a learner at copying one line at a time.
  expect(code.props.children).toBe(SOURCE);
  expect(code.props.selectable).toBe(true);
});

it("numbers every line including the blank ones", async () => {
  await render(<StageSourceView source={SOURCE} />);

  // Half of the alignment contract: a number per source line, blanks included. The other half — that
  // each of those numbers sits beside the line it counts — is a layout fact. An empty `Text` lays out
  // at zero height while its gutter number keeps a full line, which is what made the old per-line
  // code column drift, and no assertion here can see a height. What is checkable is that the source
  // reaches the tree intact (above) and that the gutter counts it correctly (here); the rest is only
  // observable on a device.
  expect(SOURCE.split("\n")).toHaveLength(5);
  for (const number of ["1", "2", "3", "4", "5"]) {
    expect(screen.getByText(number)).toBeTruthy();
  }
});
