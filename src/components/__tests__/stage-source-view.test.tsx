import { act, fireEvent, render, screen } from "@testing-library/react-native";

import { StageSourceView } from "../stage-source-view";

// Typed with its parameter rather than inferred from a bare thunk: `jest.fn(() => …)` infers a
// zero-argument signature, which type-checks the call away and would have let an assertion on the
// copied text pass while checking nothing.
const mockSetStringAsync = jest.fn((_text: string) => Promise.resolve(true));

jest.mock("expo-clipboard", () => ({
  setStringAsync: (text: string) => mockSetStringAsync(text),
}));

// Blank lines between logical groups, the shape Module 3's stages introduced and the shape that
// broke the previous per-line rendering.
const SOURCE = "vec2 uv = fragCoord / iResolution.xy;\n\nfloat d = length(uv);\n\nfragColor = vec4(d);";

beforeEach(() => {
  mockSetStringAsync.mockClear();
});

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

it("copies the whole source, not the visible portion of it", async () => {
  await render(<StageSourceView source={SOURCE} />);

  await fireEvent.press(screen.getByTestId("stage-source-copy"));

  // The listing scrolls horizontally and is often taller than the viewport, so what a learner can see
  // is not what they mean to copy.
  expect(mockSetStringAsync).toHaveBeenCalledWith(SOURCE);
});

it("confirms the copy, then returns to its resting label", async () => {
  jest.useFakeTimers();
  try {
    await render(<StageSourceView source={SOURCE} />);
    expect(screen.getByTestId("stage-source-copy")).toHaveTextContent("Copy");

    await fireEvent.press(screen.getByTestId("stage-source-copy"));
    expect(screen.getByTestId("stage-source-copy")).toHaveTextContent("Copied");

    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId("stage-source-copy")).toHaveTextContent("Copy");
  } finally {
    jest.useRealTimers();
  }
});

it("drops a pending confirmation when the stage's source changes", async () => {
  jest.useFakeTimers();
  try {
    const view = await render(<StageSourceView source={SOURCE} />);
    await fireEvent.press(screen.getByTestId("stage-source-copy"));
    expect(screen.getByTestId("stage-source-copy")).toHaveTextContent("Copied");

    // Stage blocks are recycled as a lesson scrolls, so a confirmation left standing would read as
    // belonging to a listing the learner never copied.
    await view.rerender(<StageSourceView source="fragColor = vec4(1.0);" />);

    expect(screen.getByTestId("stage-source-copy")).toHaveTextContent("Copy");
  } finally {
    jest.useRealTimers();
  }
});

describe("helpers", () => {
  const HELPERS = "float hash(vec2 p) {\n  return fract(sin(p.x) * 43758.5453);\n}";
  const BODY = "float n = hash(uv);";

  it("shows helpers above the body, separated by a blank line", async () => {
    await render(<StageSourceView helpers={HELPERS} source={BODY} />);

    // The prose discusses these functions, and the compiled shader declares them above mainImage.
    // A listing that omitted them would leave the reader looking for code that is not there.
    expect(screen.getByTestId("stage-source-code").props.children).toBe(`${HELPERS}\n\n${BODY}`);
  });

  it("copies helpers along with the body", async () => {
    await render(<StageSourceView helpers={HELPERS} source={BODY} />);

    await fireEvent.press(screen.getByTestId("stage-source-copy"));

    // Copying the body alone would hand over code that cannot compile: hash would be undeclared.
    expect(mockSetStringAsync).toHaveBeenCalledWith(`${HELPERS}\n\n${BODY}`);
  });

  it("numbers the helper lines too", async () => {
    await render(<StageSourceView helpers={HELPERS} source={BODY} />);

    // Three helper lines, one blank separator, one body line.
    expect(screen.getByText("5")).toBeTruthy();
  });

  it("leaves the listing untouched when a stage declares none", async () => {
    await render(<StageSourceView source={BODY} />);

    expect(screen.getByTestId("stage-source-code").props.children).toBe(BODY);
  });
});
