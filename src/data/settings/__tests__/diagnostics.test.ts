import { buildDiagnostics, type DiagnosticFacts } from "../diagnostics";

describe("buildDiagnostics", () => {
  test("formats only allowlisted facts in stable order", () => {
    const facts = {
      appVersion: "1.2.3",
      buildVersion: "45",
      platform: "ios",
      osVersion: "17.5",
      deviceModel: "iPhone 15",
      curriculumRelease: "release-2026-08",
      contentSchemaVersion: 1,
      cloudSync: "enabled",
      session: "signed-in",
      glRenderer: "Apple GPU",
      glVersion: "WebGL 2.0",
      email: "learner@example.com",
      userId: "user-secret",
      source: "void mainImage() { leak(); }",
      path: "C:/Users/mlp/dev/shadercraft/.env.local",
      supabaseUrl: "https://secret.supabase.co",
    } as DiagnosticFacts & Record<string, string>;

    expect(buildDiagnostics(facts)).toBe(
      [
        "Shadercraft diagnostics",
        "App version: 1.2.3",
        "Build version: 45",
        "Platform: ios",
        "OS version: 17.5",
        "Device model: iPhone 15",
        "Curriculum release: release-2026-08",
        "Content schema version: 1",
        "Cloud sync: enabled",
        "Session: signed-in",
        "GL renderer: Apple GPU",
        "GL version: WebGL 2.0",
      ].join("\n"),
    );

    const output = buildDiagnostics(facts);
    for (const sensitive of [
      "email",
      "learner@example.com",
      "userId",
      "user-secret",
      "source",
      "void mainImage",
      "path",
      ".env.local",
      "supabaseUrl",
      "secret.supabase.co",
    ]) {
      expect(output).not.toContain(sensitive);
    }
  });

  test("omits unavailable optional facts", () => {
    expect(
      buildDiagnostics({
        platform: "web",
        osVersion: "unknown",
        curriculumRelease: "bundled-1",
        contentSchemaVersion: 1,
        cloudSync: "disabled",
        session: "signed-out",
      }),
    ).toBe(
      [
        "Shadercraft diagnostics",
        "Platform: web",
        "OS version: unknown",
        "Curriculum release: bundled-1",
        "Content schema version: 1",
        "Cloud sync: disabled",
        "Session: signed-out",
      ].join("\n"),
    );
  });
});
