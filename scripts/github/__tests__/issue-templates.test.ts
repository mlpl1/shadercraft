import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readTemplate(filename: string) {
  return readFileSync(resolve(process.cwd(), ".github", "ISSUE_TEMPLATE", filename), "utf8");
}

function expectTopLevelField(template: string, field: string) {
  expect(template).toMatch(new RegExp(`^${field}:\\s*.+$`, "m"));
}

function captureTopLevelField(template: string, field: string) {
  const match = template.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
  expect(match).not.toBeNull();
  return match?.[1].trim() ?? "";
}

function expectPublicInformationConsent(template: string) {
  const idMatches = [...template.matchAll(/^\s*id:\s*public-information\s*$/gm)];
  expect(idMatches).toHaveLength(1);

  const idLine = idMatches[0];
  const start = idLine.index ?? 0;
  const validationBlock = template.slice(start, start + 300);

  expect(validationBlock).toMatch(/^\s*validations:\s*$/m);
  expect(validationBlock).toMatch(/^\s*required:\s*true\s*$/m);
}

describe("GitHub issue templates", () => {
  const bugTemplate = readTemplate("bug-report.yml");
  const featureTemplate = readTemplate("feature-request.yml");

  test.each([
    ["bug report", bugTemplate],
    ["feature request", featureTemplate],
  ])("keeps the %s chooser contract intact", (_name, template) => {
    expectTopLevelField(template, "name");
    expectTopLevelField(template, "description");
    expectTopLevelField(template, "title");
    expect(template).toMatch(/^labels:\s*.+$/m);
    expect(template).toMatch(/^body:\s*$/m);
    expectPublicInformationConsent(template);
  });

  it("keeps chooser names and titles distinct", () => {
    expect(captureTopLevelField(bugTemplate, "name")).not.toBe(captureTopLevelField(featureTemplate, "name"));
    expect(captureTopLevelField(bugTemplate, "title")).not.toBe(captureTopLevelField(featureTemplate, "title"));
  });
});
