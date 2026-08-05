import type { CourseModule } from "../../../src/data/course/types";
import { publishCourseRelease, type AdminClient, type PublishDeps } from "../publish-course";

function validModules(): CourseModule[] {
  return [
    {
      id: "module-one",
      position: 1,
      status: "published",
      title: "Module One",
      description: "Description",
      plannedLessonCount: 0,
      plannedTopics: [],
      lessons: [
        {
          id: "lesson-one",
          moduleId: "module-one",
          position: 1,
          title: "Lesson One",
          shortTitle: "Lesson",
          intro: "Intro",
          conceptTitle: "Concept",
          conceptLede: "Lede",
          tryHint: "Hint",
          takeaway: "Takeaway",
          previewCaption: "Caption",
          presets: [
            {
              id: "preset-one",
              position: 1,
              label: "Default",
              previewKey: "normalized",
              previewParameters: {},
              value: "value",
              filename: "f.glsl",
              codeLines: ["line one"],
              highlightedLines: [1],
            },
          ],
          sections: [{ id: "section-one", position: 1, title: "Title", body: "Body" }],
        },
      ],
    },
  ];
}

function invalidModules(): CourseModule[] {
  // Published module with a planned topic: rejected by parseCourseRelease's shared content
  // validation, before any network access.
  return [
    {
      id: "module-one",
      position: 1,
      status: "published",
      title: "Module One",
      description: "Description",
      plannedLessonCount: 1,
      plannedTopics: ["Should not be here"],
      lessons: [],
    },
  ];
}

type FakeAdminClient = AdminClient & { calls: { fn: string; args: Record<string, unknown> }[] };

function fakeAdminClient(result: import("../publish-course").AdminRpcResult = { error: null }): FakeAdminClient {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return result;
    },
  };
}

function baseDeps(overrides: Partial<PublishDeps> = {}): PublishDeps {
  return {
    env: { SUPABASE_URL: "https://project-ref.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example" },
    loadAuthoredModules: validModules,
    createAdminClient: () => fakeAdminClient(),
    ...overrides,
  };
}

test("refuses to publish when SUPABASE_URL is missing", async () => {
  let createAdminClientCalled = false;
  const deps = baseDeps({
    env: { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_example" },
    createAdminClient: () => {
      createAdminClientCalled = true;
      return fakeAdminClient();
    },
  });

  await expect(publishCourseRelease("course-2026-08-03", deps)).rejects.toThrow(/SUPABASE_URL/);
  expect(createAdminClientCalled).toBe(false);
});

test("refuses to publish when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
  let createAdminClientCalled = false;
  const deps = baseDeps({
    env: { SUPABASE_URL: "https://project-ref.supabase.co" },
    createAdminClient: () => {
      createAdminClientCalled = true;
      return fakeAdminClient();
    },
  });

  await expect(publishCourseRelease("course-2026-08-03", deps)).rejects.toThrow(
    /SUPABASE_SERVICE_ROLE_KEY/,
  );
  expect(createAdminClientCalled).toBe(false);
});

test("refuses a release id that does not match the id pattern before loading content", async () => {
  let loadAuthoredModulesCalled = false;
  const deps = baseDeps({
    loadAuthoredModules: () => {
      loadAuthoredModulesCalled = true;
      return validModules();
    },
  });

  await expect(publishCourseRelease("Course_2026!", deps)).rejects.toThrow(/Invalid release id/);
  expect(loadAuthoredModulesCalled).toBe(false);
});

test("runs content validation before creating an admin client", async () => {
  let createAdminClientCalled = false;
  const deps = baseDeps({
    loadAuthoredModules: invalidModules,
    createAdminClient: () => {
      createAdminClientCalled = true;
      return fakeAdminClient();
    },
  });

  await expect(publishCourseRelease("course-2026-08-03", deps)).rejects.toThrow();
  expect(createAdminClientCalled).toBe(false);
});

test("sends exactly one publish_course_release RPC with the checksummed payload", async () => {
  const admin = fakeAdminClient();
  const deps = baseDeps({ createAdminClient: () => admin, log: () => {} });

  await publishCourseRelease("course-2026-08-03", deps);

  expect(admin.calls).toHaveLength(1);
  expect(admin.calls[0].fn).toBe("publish_course_release");
  const payload = admin.calls[0].args.p_payload as { id: string; checksum: string; modules: unknown };
  expect(payload.id).toBe("course-2026-08-03");
  expect(payload.checksum).toMatch(/^[a-f0-9]{64}$/);
  expect(payload.modules).toEqual(validModules());
});

test("fails when the RPC reports an error", async () => {
  const admin = fakeAdminClient({ error: { message: "release already published with a different checksum" } });
  const deps = baseDeps({ createAdminClient: () => admin });

  await expect(publishCourseRelease("course-2026-08-03", deps)).rejects.toThrow(
    /already published with a different checksum/,
  );
});

test("never logs the service-role key", async () => {
  const logs: string[] = [];
  const deps = baseDeps({
    env: {
      SUPABASE_URL: "https://project-ref.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "sb_secret_do_not_log_me",
    },
    log: (message) => logs.push(message),
  });

  await publishCourseRelease("course-2026-08-03", deps);

  expect(logs.length).toBeGreaterThan(0);
  expect(logs.some((message) => message.includes("sb_secret_do_not_log_me"))).toBe(false);
});
