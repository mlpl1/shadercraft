import { render, screen } from "@testing-library/react-native";

import { LessonStageBlock } from "../lesson-stage-block";
import type { LessonStage } from "../../data/course/types";

jest.mock("../shader-sandbox", () => {
  const React = require("react") as typeof import("react");
  const { Text, View } = require("react-native") as typeof import("react-native");

  return {
    ShaderSandbox: ({ source, active }: { source: string; active?: boolean }) =>
      React.createElement(
        View,
        { testID: "sandbox" },
        React.createElement(Text, null, `${active === false ? "inactive" : "active"}:${source}`),
      ),
  };
});

const STAGE: LessonStage = {
  id: "a-stage",
  position: 2,
  title: "Divide by the resolution",
  body: "A body long enough to read like real teaching prose rather than a placeholder.",
  source: "fragColor = vec4(1.0, 0.0, 0.0, 1.0);",
};

describe("LessonStageBlock", () => {
  it("renders the stage's ordinal, title, body and source", async () => {
    await render(
      <LessonStageBlock isMounted isVisible position={2} stage={STAGE} />,
    );

    expect(screen.getByText("Stage 2")).toBeTruthy();
    expect(screen.getByText("Divide by the resolution")).toBeTruthy();
    expect(screen.getByText(/real teaching prose/)).toBeTruthy();
    expect(screen.getByTestId("stage-source")).toBeTruthy();
  });

  it("renders a sandbox once mounted", async () => {
    await render(
      <LessonStageBlock isMounted isVisible position={1} stage={STAGE} />,
    );

    expect(screen.getByTestId("sandbox")).toHaveTextContent(/^active:fragColor/);
  });

  it("renders a placeholder instead of a sandbox before mounting", async () => {
    await render(
      <LessonStageBlock isMounted={false} isVisible={false} position={1} stage={STAGE} />,
    );

    expect(screen.queryByTestId("sandbox")).toBeNull();
    expect(screen.getByTestId("stage-preview-placeholder")).toBeTruthy();
  });

  it("marks a mounted but off-screen sandbox inactive", async () => {
    await render(
      <LessonStageBlock isMounted isVisible={false} position={1} stage={STAGE} />,
    );

    expect(screen.getByTestId("sandbox")).toHaveTextContent(/^inactive:/);
  });

  it("still shows the source while the preview is unmounted", async () => {
    await render(
      <LessonStageBlock isMounted={false} isVisible={false} position={3} stage={STAGE} />,
    );

    expect(screen.getByTestId("stage-source")).toBeTruthy();
    expect(screen.getByText("Stage 3")).toBeTruthy();
  });
});
