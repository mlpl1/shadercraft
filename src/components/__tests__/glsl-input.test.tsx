import { fireEvent, render, screen } from "@testing-library/react-native";

import { GlslInput } from "../glsl-input";

const noop = () => undefined;

/**
 * In @testing-library/react-native 14 every `fireEvent` variant returns a promise, so an unawaited
 * event overlaps the next `act()` scope and tears the rendered tree down mid-test.
 */
const setSelection = async (start: number, end: number) => {
  await fireEvent(screen.getByTestId("glsl-input"), "selectionChange", {
    nativeEvent: { selection: { start, end } },
  });
};

describe("GlslInput", () => {
  it("renders the initial source", async () => {
    await render(<GlslInput errors={[]} initialValue="float a = 1.0;" onChange={noop} />);

    expect(screen.getByTestId("glsl-input").props.value).toBe("float a = 1.0;");
  });

  it("numbers every logical line", async () => {
    await render(<GlslInput errors={[]} initialValue={"a;\nb;\nc;"} onChange={noop} />);

    expect(screen.getByTestId("glsl-gutter-line-1")).toBeTruthy();
    expect(screen.getByTestId("glsl-gutter-line-3")).toBeTruthy();
    expect(screen.queryByTestId("glsl-gutter-line-4")).toBeNull();
  });

  it("reports edits to the caller", async () => {
    const onChange = jest.fn();
    await render(<GlslInput errors={[]} initialValue="a;" onChange={onChange} />);

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "b;");

    expect(onChange).toHaveBeenCalledWith("b;");
  });

  it("renumbers the gutter as lines are added", async () => {
    await render(<GlslInput errors={[]} initialValue="a;" onChange={noop} />);
    expect(screen.queryByTestId("glsl-gutter-line-2")).toBeNull();

    await fireEvent.changeText(screen.getByTestId("glsl-input"), "a;\nb;");

    expect(screen.getByTestId("glsl-gutter-line-2")).toBeTruthy();
  });

  it("inserts a symbol at the caret and reports the result", async () => {
    const onChange = jest.fn();
    await render(<GlslInput errors={[]} initialValue="vec2 p = ;" onChange={onChange} />);

    await setSelection(9, 9);
    await fireEvent.press(screen.getByTestId("glsl-symbol-vec2"));

    expect(onChange).toHaveBeenCalledWith("vec2 p = vec2;");
  });

  it("leaves the caret after the inserted symbol", async () => {
    await render(<GlslInput errors={[]} initialValue="vec2 p = ;" onChange={noop} />);

    await setSelection(9, 9);
    await fireEvent.press(screen.getByTestId("glsl-symbol-vec2"));

    expect(screen.getByTestId("glsl-input").props.selection).toEqual({ start: 13, end: 13 });
  });

  it("stops overriding the caret once the input reports its own selection", async () => {
    await render(<GlslInput errors={[]} initialValue="vec2 p = ;" onChange={noop} />);

    await setSelection(9, 9);
    await fireEvent.press(screen.getByTestId("glsl-symbol-vec2"));
    await setSelection(2, 2);

    expect(screen.getByTestId("glsl-input").props.selection).toBeUndefined();
  });

  it("appends a symbol when the caret position is unknown", async () => {
    const onChange = jest.fn();
    await render(<GlslInput errors={[]} initialValue="a" onChange={onChange} />);

    await fireEvent.press(screen.getByText(";"));

    expect(onChange).toHaveBeenCalledWith("a;");
  });

  it("replaces the selected range when text is selected", async () => {
    const onChange = jest.fn();
    await render(<GlslInput errors={[]} initialValue="vec2 p = bad;" onChange={onChange} />);

    await setSelection(9, 12);
    await fireEvent.press(screen.getByTestId("glsl-symbol-vec3"));

    expect(onChange).toHaveBeenCalledWith("vec2 p = vec3;");
  });

  it("lists errors with their line numbers", async () => {
    await render(
      <GlslInput
        errors={[{ line: 2, message: "'x' : undeclared identifier", raw: "ERROR: 0:6: bad" }]}
        initialValue={"a;\nb;"}
        onChange={noop}
      />,
    );

    expect(screen.getByText("Line 2")).toBeTruthy();
    expect(screen.getByText("'x' : undeclared identifier")).toBeTruthy();
  });

  it("shows an unlocated error without inventing a line number", async () => {
    await render(
      <GlslInput
        errors={[{ line: null, message: "Compilation failed", raw: "Compilation failed" }]}
        initialValue="a;"
        onChange={noop}
      />,
    );

    expect(screen.getByText("Compilation failed")).toBeTruthy();
    expect(screen.queryByText(/^Line /)).toBeNull();
  });

  it("renders no error list when there are no errors", async () => {
    await render(<GlslInput errors={[]} initialValue="a;" onChange={noop} />);

    expect(screen.queryByTestId("glsl-errors")).toBeNull();
  });

  it("disables the keyboard behaviours that corrupt source code", async () => {
    await render(<GlslInput errors={[]} initialValue="a;" onChange={noop} />);
    const input = screen.getByTestId("glsl-input");

    expect(input.props.autoCorrect).toBe(false);
    expect(input.props.autoCapitalize).toBe("none");
    expect(input.props.spellCheck).toBe(false);
    expect(input.props.multiline).toBe(true);
  });
});
