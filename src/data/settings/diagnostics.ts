export type DiagnosticFacts = Readonly<{
  appVersion?: string;
  buildVersion?: string;
  platform: string;
  osVersion: string;
  deviceModel?: string;
  curriculumRelease: string;
  contentSchemaVersion: number;
  cloudSync: "enabled" | "disabled";
  session: "signed-in" | "signed-out";
  glRenderer?: string;
  glVersion?: string;
}>;

const fields: Array<[keyof DiagnosticFacts, string]> = [
  ["appVersion", "App version"],
  ["buildVersion", "Build version"],
  ["platform", "Platform"],
  ["osVersion", "OS version"],
  ["deviceModel", "Device model"],
  ["curriculumRelease", "Curriculum release"],
  ["contentSchemaVersion", "Content schema version"],
  ["cloudSync", "Cloud sync"],
  ["session", "Session"],
  ["glRenderer", "GL renderer"],
  ["glVersion", "GL version"],
];

export function buildDiagnostics(facts: DiagnosticFacts): string {
  const lines = ["Shadercraft diagnostics"];
  for (const [key, label] of fields) {
    const value = facts[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      lines.push(`${label}: ${String(value)}`);
    }
  }
  return lines.join("\n");
}
