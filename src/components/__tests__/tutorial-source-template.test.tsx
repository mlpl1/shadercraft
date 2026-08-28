import { render, screen } from "@testing-library/react-native";

import { TutorialSourceTemplate } from "../tutorial-source-template";
import { SHADERCRAFT_BLANK } from "../../data/course/tutorial-exercise";

const template = `float radius = ${SHADERCRAFT_BLANK};\nfragColor = vec4(radius);`;

test("shows the template blank before an answer is selected", async () => {
  await render(<TutorialSourceTemplate template={template} />);

  expect(screen.getByText("float radius = ", { exact: false })).toBeTruthy();
  expect(screen.getByText("Choose an answer")).toBeTruthy();
  expect(screen.getByText(";\nfragColor = vec4(radius);", { exact: false })).toBeTruthy();
  expect(
    screen.getByLabelText(
      "Source template: float radius = Choose an answer; fragColor = vec4(radius);",
    ),
  ).toBeTruthy();
});

test("shows the selected fragment in the complete readable expression", async () => {
  await render(<TutorialSourceTemplate selectedFragment="0.25" template={template} />);

  expect(screen.getByText("0.25")).toBeTruthy();
  expect(
    screen.getByLabelText("Source template: float radius = 0.25; fragColor = vec4(radius);"),
  ).toBeTruthy();
});
