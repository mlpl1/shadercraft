import { fireEvent, render, screen } from "@testing-library/react-native";

import { PreviewControls } from "../preview-controls";

const props = (overrides: Partial<Parameters<typeof PreviewControls>[0]> = {}) => ({
  paused: false,
  collapsed: false,
  onTogglePause: jest.fn(),
  onRestart: jest.fn(),
  onToggleCollapse: jest.fn(),
  ...overrides,
});

describe("PreviewControls", () => {
  it("offers to pause while running", async () => {
    await render(<PreviewControls {...props()} />);

    expect(screen.getByLabelText("Pause preview")).toBeTruthy();
  });

  it("offers to resume while paused", async () => {
    await render(<PreviewControls {...props({ paused: true })} />);

    expect(screen.getByLabelText("Resume preview")).toBeTruthy();
  });

  it("reports a pause toggle", async () => {
    const current = props();
    await render(<PreviewControls {...current} />);

    await fireEvent.press(screen.getByLabelText("Pause preview"));

    expect(current.onTogglePause).toHaveBeenCalled();
  });

  it("reports a restart", async () => {
    const current = props();
    await render(<PreviewControls {...current} />);

    await fireEvent.press(screen.getByLabelText("Restart preview"));

    expect(current.onRestart).toHaveBeenCalled();
  });

  it("labels the collapse control as hiding while the preview is showing", async () => {
    await render(<PreviewControls {...props()} />);

    expect(screen.getByLabelText("Hide preview")).toBeTruthy();
  });

  it("reports a collapse toggle and labels it by current state", async () => {
    const current = props({ collapsed: true });
    await render(<PreviewControls {...current} />);

    await fireEvent.press(screen.getByLabelText("Show preview"));

    expect(current.onToggleCollapse).toHaveBeenCalled();
  });

  it("still offers restart while collapsed, so the timeline can be reset before reopening", async () => {
    const current = props({ collapsed: true });
    await render(<PreviewControls {...current} />);

    await fireEvent.press(screen.getByLabelText("Restart preview"));

    expect(current.onRestart).toHaveBeenCalled();
  });
});
