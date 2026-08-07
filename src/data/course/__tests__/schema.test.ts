import { parseAuthoredModules } from "../schema";

const stage = (position: number, overrides: Record<string, unknown> = {}) => ({
  id: `stage-${position}`,
  position,
  title: `Stage ${position}`,
  body: "This body is deliberately long enough to clear the sixty word minimum that the schema enforces, because a stage explaining itself in a dozen words is the thinness this whole redesign exists to prevent, and the rule has to bite somewhere. The floor matches the figure the syllabus design commits to, rather than sitting below it where an author could satisfy the build with half the depth the course actually asks for.",
  source: "fragColor = vec4(1.0, 0.0, 0.0, 1.0);",
  ...overrides,
});

const lesson = (overrides: Record<string, unknown> = {}) => ({
  id: "a-lesson",
  moduleId: "a-module",
  position: 1,
  title: "A lesson",
  shortTitle: "Lesson",
  intro: "An intro long enough to clear its own sixty word minimum, which exists so a lesson cannot ship as a title and a shrug the way the previous curriculum did across all fourteen of its published lessons without anything at all noticing. Sixty is what the syllabus design commits to, so the enforced floor and the stated standard are finally the same number.",
  takeaway: "A takeaway carrying enough words to clear the thirty word minimum the schema applies to this field, which is the figure the syllabus design states rather than the lower one the code used to enforce.",
  stages: [stage(1), stage(2), stage(3)],
  ...overrides,
});

const publishedModule = (overrides: Record<string, unknown> = {}) => ({
  id: "a-module",
  position: 1,
  status: "published",
  title: "A module",
  description: "A module description.",
  plannedLessonCount: 0,
  plannedTopics: [],
  lessons: [lesson()],
  ...overrides,
});

describe("curriculum authoring schema", () => {
  it("accepts published lessons and planned modules", () => {
    const modules = [
      publishedModule(),
      {
        id: "b-module",
        position: 2,
        status: "planned",
        title: "Shader animation",
        description: "Animate a shader with time.",
        plannedLessonCount: 2,
        plannedTopics: ["Time uniforms", "Looping motion"],
        lessons: [],
      },
    ];

    expect(() => parseAuthoredModules(modules)).not.toThrow();
  });

  it("rejects duplicate lesson IDs", () => {
    const lessons = [lesson(), lesson({ position: 2 })];

    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(
      /duplicate lesson id/i,
    );
  });

  it("rejects published modules without lessons", () => {
    expect(() =>
      parseAuthoredModules([publishedModule({ lessons: [] })]),
    ).toThrow(/published module/i);
  });

  it("rejects planned modules with lessons", () => {
    const plannedModuleWithLessons = {
      id: "b-module",
      position: 2,
      status: "planned",
      title: "Shader animation",
      description: "Animate a shader with time.",
      plannedLessonCount: 0,
      plannedTopics: [],
      lessons: [lesson({ moduleId: "b-module" })],
    };

    expect(() =>
      parseAuthoredModules([publishedModule(), plannedModuleWithLessons]),
    ).toThrow(/planned module/i);
  });
});

describe("stage validation", () => {
  it("accepts a lesson with three stages", () => {
    expect(() => parseAuthoredModules([publishedModule()])).not.toThrow();
  });

  it("accepts a lesson with five stages", () => {
    const lessons = [lesson({ stages: [1, 2, 3, 4, 5].map((n) => stage(n)) })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).not.toThrow();
  });

  it("rejects fewer than three stages", () => {
    const lessons = [lesson({ stages: [stage(1), stage(2)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/between 3 and 5/i);
  });

  it("rejects more than five stages", () => {
    const lessons = [lesson({ stages: [1, 2, 3, 4, 5, 6].map((n) => stage(n)) })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/between 3 and 5/i);
  });

  it("rejects non-contiguous stage positions", () => {
    const lessons = [lesson({ stages: [stage(1), stage(2), stage(4)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/contiguous/i);
  });

  it("rejects duplicate stage ids across the release", () => {
    const lessons = [lesson({ stages: [stage(1), stage(2), stage(3, { id: "stage-1" })] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/duplicate stage id/i);
  });

  it("rejects an empty source", () => {
    const lessons = [lesson({ stages: [stage(1, { source: "  " }), stage(2), stage(3)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/source must not be empty/i);
  });
});

describe("stage source respects the sandbox contract", () => {
  it.each([
    ["precision highp float;\nfragColor = vec4(1.0);", "precision"],
    ["void main() { }", "void main("],
    ["#version 300 es\nfragColor = vec4(1.0);", "#version"],
    ["gl_FragColor = vec4(1.0);", "gl_FragColor"],
    ["vec4 c = texture(tex, uv);", "texture("],
    ["fragColor = vec4(iMouse.xy, 0.0, 1.0);", "iMouse"],
    ["fragColor = vec4(float(iFrame));", "iFrame"],
    ["fragColor = vec4(iTimeDelta);", "iTimeDelta"],
  ])("rejects source containing %s", (source) => {
    const lessons = [lesson({ stages: [stage(1, { source }), stage(2), stage(3)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/must not contain/i);
  });

  it("allows iResolution and iTime", () => {
    const source = "vec2 uv = fragCoord / iResolution.xy;\nfragColor = vec4(uv, sin(iTime), 1.0);";
    const lessons = [lesson({ stages: [stage(1, { source }), stage(2), stage(3)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).not.toThrow();
  });
});

describe("prose depth", () => {
  it("rejects a short intro", () => {
    const lessons = [lesson({ intro: "Too short." })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/intro.*60 words/i);
  });

  it("rejects a short stage body", () => {
    const lessons = [lesson({ stages: [stage(1, { body: "Too short." }), stage(2), stage(3)] })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/body.*60 words/i);
  });

  it("rejects a short takeaway", () => {
    const lessons = [lesson({ takeaway: "Too short." })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).toThrow(/takeaway.*30 words/i);
  });
});

describe("tryThis", () => {
  it("is optional", () => {
    const [parsedModule] = parseAuthoredModules([publishedModule()]);
    const [parsedLesson] = parsedModule.lessons;

    expect(parsedLesson.tryThis).toBeUndefined();
    expect(parsedLesson).not.toHaveProperty("tryThis");
  });

  it("is accepted when present", () => {
    const lessons = [lesson({ tryThis: "Change the divisor and watch the gradient stretch." })];
    expect(() => parseAuthoredModules([publishedModule({ lessons })])).not.toThrow();
  });
});
