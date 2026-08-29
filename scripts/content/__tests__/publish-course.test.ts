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
          intro: "An intro long enough to clear its own sixty word minimum, which exists so a lesson cannot ship as a title and a shrug the way the previous curriculum did across all fourteen of its published lessons without anything at all noticing. Sixty is what the syllabus design commits to, so the enforced floor and the stated standard are finally the same number.",
          takeaway: "A takeaway carrying enough words to clear the thirty word minimum the schema applies to this field, which is the figure the syllabus design states rather than the lower one the code used to enforce.",
          stages: [1, 2, 3].map((position) => ({
            id: `stage-${position}`,
            position,
            title: `Stage ${position}`,
            body: "This body is deliberately long enough to clear the sixty word minimum that the schema enforces, because a stage explaining itself in a dozen words is the thinness this whole redesign exists to prevent, and the rule has to bite somewhere. The floor matches the figure the syllabus design commits to, rather than sitting below it where an author could satisfy the build with half the depth the course actually asks for.",
            source: "fragColor = vec4(1.0, 0.0, 0.0, 1.0);",
          })),
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

type FakeOptions = {
  publishResult?: import("../publish-course").AdminRpcResult;
  /** Rewrites what the read path returns, to model a publish and read path that disagree. */
  readBack?: (published: unknown) => import("../publish-course").AdminRpcResult;
};

/**
 * Models a working server rather than returning one canned result for every call: the publish RPC
 * remembers its payload and the read RPC hands it back. That default is what makes the failure
 * cases below meaningful — each one is a specific, deliberate deviation from a server that works.
 */
function fakeAdminClient(options: FakeOptions = {}): FakeAdminClient {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let published: unknown = null;

  return {
    calls,
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === "publish_course_release") {
        published = args.p_payload;
        return options.publishResult ?? { error: null };
      }
      return options.readBack ? options.readBack(published) : { data: published, error: null };
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

test("publishes the checksummed payload and then reads it back", async () => {
  const admin = fakeAdminClient();
  const deps = baseDeps({ createAdminClient: () => admin, log: () => {} });

  await publishCourseRelease("course-2026-08-03", deps);

  // Two calls, in this order: the write, then the read that proves it survived.
  expect(admin.calls.map(({ fn }) => fn)).toEqual([
    "publish_course_release",
    "get_course_release",
  ]);
  expect(admin.calls[1].args).toEqual({ p_release_id: "course-2026-08-03" });
  const payload = admin.calls[0].args.p_payload as { id: string; checksum: string; modules: unknown };
  expect(payload.id).toBe("course-2026-08-03");
  expect(payload.checksum).toMatch(/^[a-f0-9]{64}$/);
  expect(payload.modules).toEqual(validModules());
});

test("fails when the RPC reports an error", async () => {
  const admin = fakeAdminClient({
    publishResult: { error: { message: "release already published with a different checksum" } },
  });
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

test("fails when the published release cannot be read back at all", async () => {
  const admin = fakeAdminClient({ readBack: () => ({ data: null, error: null }) });
  const deps = baseDeps({ createAdminClient: () => admin });

  await expect(publishCourseRelease("course-2026-08-03", deps)).rejects.toThrow(
    /reported success but get_course_release returned no payload/,
  );
});

test("fails when the read path returns different content from the write path", async () => {
  // The failure this verification exists for, and the one nothing else catches. Every schema change
  // is a chance for the insert and the read to disagree, and the dangerous version of that is
  // content that still parses perfectly — a field silently altered or lost rather than a broken
  // shape. Here one stage title differs. The write RPC reported success, the payload validates, and
  // only the checksum recomputed from the returned content shows anything is wrong.
  const admin = fakeAdminClient({
    readBack: (published) => {
      const release = JSON.parse(JSON.stringify(published)) as {
        modules: { lessons: { stages: { title: string }[] }[] }[];
      };
      release.modules[0].lessons[0].stages[0].title = "Quietly different";
      return { data: release, error: null };
    },
  });
  const deps = baseDeps({ createAdminClient: () => admin });

  await expect(publishCourseRelease("course-2026-08-03", deps)).rejects.toThrow(
    /does not survive the round trip/,
  );
});

test("fails when the read path returns a shape the app would reject", async () => {
  // Distinct from a checksum mismatch: this payload never reaches the comparison because the
  // device's own validator would refuse it first, so the error names that rather than a digest.
  const admin = fakeAdminClient({
    readBack: (published) => ({
      data: { ...(published as object), minimumAppVersion: "not-a-version" },
      error: null,
    }),
  });
  const deps = baseDeps({ createAdminClient: () => admin });

  await expect(publishCourseRelease("course-2026-08-03", deps)).rejects.toThrow(
    /reads back in a shape the app would reject/,
  );
});

test("surfaces a read failure rather than reporting a successful publish", async () => {
  const admin = fakeAdminClient({
    readBack: () => ({ error: { message: "permission denied for function get_course_release" } }),
  });
  const deps = baseDeps({ createAdminClient: () => admin });

  await expect(publishCourseRelease("course-2026-08-03", deps)).rejects.toThrow(
    /permission denied for function get_course_release/,
  );
});

test("logs only after the round trip is proven", async () => {
  // A success line printed before verification would be a lie the operator acts on.
  const logs: string[] = [];
  const admin = fakeAdminClient({ readBack: () => ({ data: null, error: null }) });
  const deps = baseDeps({ createAdminClient: () => admin, log: (message) => logs.push(message) });

  await expect(publishCourseRelease("course-2026-08-03", deps)).rejects.toThrow();
  expect(logs).toEqual([]);
});

test("reports every countable thing the release carries, tutorials included", async () => {
  // The summary is what an operator checks a publish against, so anything it omits reads as absent.
  // It omitted tutorials on the first release that had any.
  const logs: string[] = [];
  const withTutorial = (): CourseModule[] => {
    const [module] = validModules();
    return [
      {
        ...module,
        tutorials: [
          {
            id: "a-tutorial",
            moduleId: module.id,
            position: 1,
            title: "A tutorial",
            summary:
              "A summary carrying enough words to clear the twenty word floor the schema applies to this field, so the fixture exercises reporting rather than validation.",
            steps: [1, 2].map((position) => ({
              id: `step-${position}`,
              position,
              title: `Step ${position}`,
              brief:
                "A brief long enough to clear the twenty-five word floor, which exists so a step cannot ship as a single terse imperative telling the learner to go and do something unexplained.",
              sourceTemplate:
                "float axis = uv.x;\nfragColor = vec4(/*__SHADERCRAFT_BLANK__*/);",
              answerChoices: [
                { id: "axis", fragment: "axis" },
                { id: "horizontal", fragment: "uv.x" },
                { id: "vertical", fragment: "uv.y" },
                { id: "absolute", fragment: "abs(axis)" },
              ],
              correctChoiceId: "axis",
            })),
          },
        ],
      },
    ];
  };

  const deps = baseDeps({
    loadAuthoredModules: withTutorial,
    log: (message) => logs.push(message),
  });

  await publishCourseRelease("course-2026-08-03", deps);

  expect(JSON.parse(logs[0])).toMatchObject({ modules: 1, lessons: 1, stages: 3, tutorials: 1, steps: 2 });
});
