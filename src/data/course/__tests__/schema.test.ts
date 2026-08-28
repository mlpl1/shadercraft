import { parseAuthoredModules } from "../schema";
import { SHADERCRAFT_BLANK } from "../tutorial-exercise";

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

describe("stage helpers", () => {
  const withHelpers = (helpers: unknown) =>
    parseAuthoredModules([
      publishedModule({
        lessons: [lesson({ stages: [stage(1, { helpers }), stage(2), stage(3)] })],
      }),
    ]);

  it("accepts a stage that declares helper functions", () => {
    expect(() => withHelpers("float hash(vec2 p) {\n  return fract(p.x);\n}")).not.toThrow();
  });

  it("rejects helpers that redefine mainImage", () => {
    // `SHADER_SOURCE_FORBIDDEN_TOKENS` bans `void main(`, which does NOT match `void mainImage(` —
    // the character after `void main` is `I`, not `(`. Without a dedicated check this would pass
    // validation and fail to link on device with a duplicate definition.
    expect(() =>
      withHelpers("void mainImage(out vec4 fragColor, in vec2 fragCoord) {}"),
    ).toThrow(/mainImage/);
  });

  it("rejects helpers carrying wrapper-owned declarations", () => {
    expect(() => withHelpers("precision highp float;\nfloat f() { return 1.0; }")).toThrow(
      /precision/,
    );
    expect(() => withHelpers("#version 300 es")).toThrow(/#version/);
  });

  it("rejects a present but blank helpers field", () => {
    // Absent and blank would otherwise mean the same thing in two representations.
    expect(() => withHelpers("   ")).toThrow(/must not be empty/);
  });
});

describe("tutorials", () => {
  const step = (position: number, overrides: Record<string, unknown> = {}) => ({
    id: `step-${position}`,
    position,
    title: `Step ${position}`,
    brief:
      "A brief long enough to clear the twenty-five word floor, which exists so a step cannot ship as a single terse imperative telling the learner to go and do something unexplained.",
    sourceTemplate: `fragColor = vec4(${SHADERCRAFT_BLANK});`,
    answerChoices: [
      { id: "white", fragment: "1.0" },
      { id: "black", fragment: "0.0" },
      { id: "half", fragment: "0.5" },
      { id: "quarter", fragment: "0.25" },
    ],
    correctChoiceId: "white",
    ...overrides,
  });

  const tutorial = (overrides: Record<string, unknown> = {}) => ({
    id: "a-tutorial",
    moduleId: "a-module",
    position: 1,
    title: "A tutorial",
    summary:
      "A summary carrying enough words to clear the twenty word floor that the schema applies to this particular field, so the fixture exercises the rules rather than tripping over them.",
    steps: [step(1)],
    ...overrides,
  });

  const withTutorials = (tutorials: unknown, moduleOverrides: Record<string, unknown> = {}) =>
    parseAuthoredModules([publishedModule({ tutorials, ...moduleOverrides })]);

  it("accepts a published module carrying a tutorial", () => {
    expect(() => withTutorials([tutorial()])).not.toThrow();
  });

  it("accepts a published module with no tutorials at all", () => {
    expect(() => parseAuthoredModules([publishedModule()])).not.toThrow();
  });

  it("rejects an empty tutorial list rather than treating it as absent", () => {
    // Absent and empty would otherwise be two representations of the same thing.
    expect(() => withTutorials([])).toThrow(/omit tutorials/i);
  });

  it("rejects a tutorial on a planned module", () => {
    // A tutorial unlocks when its module completes, and a planned module never completes, so this
    // would be permanently unreachable rather than merely early.
    expect(() =>
      parseAuthoredModules([
        {
          id: "b-module",
          position: 1,
          status: "planned",
          title: "Planned",
          description: "Later.",
          plannedLessonCount: 1,
          plannedTopics: ["Something"],
          lessons: [],
          tutorials: [tutorial({ moduleId: "b-module" })],
        },
      ]),
    ).toThrow(/cannot carry tutorials/i);
  });

  it.each([
    ["no marker", "fragColor = vec4(1.0);"],
    ["two markers", `fragColor = vec4(${SHADERCRAFT_BLANK}, ${SHADERCRAFT_BLANK});`],
  ])("rejects a source template with %s", (_label, sourceTemplate) => {
    expect(() =>
      withTutorials([tutorial({ steps: [step(1, { sourceTemplate })] })]),
    ).toThrow(/exactly one blank/i);
  });

  it.each([
    ["three", ["white", "black", "half"]],
    ["five", ["white", "black", "half", "quarter", "extra"]],
  ])("rejects %s choices", (_label, ids) => {
    expect(() =>
      withTutorials([
        tutorial({
          steps: [
            step(1, {
              answerChoices: ids.map((id, index) => ({ id, fragment: `${index}.0` })),
            }),
          ],
        }),
      ]),
    ).toThrow(/4/i);
  });

  it("rejects duplicate choice ids", () => {
    expect(() =>
      withTutorials([
        tutorial({
          steps: [
            step(1, {
              answerChoices: [
                { id: "white", fragment: "1.0" },
                { id: "white", fragment: "0.0" },
                { id: "half", fragment: "0.5" },
                { id: "quarter", fragment: "0.25" },
              ],
            }),
          ],
        }),
      ]),
    ).toThrow(/duplicate tutorial choice id/i);
  });

  it("rejects blank choice fragments", () => {
    expect(() =>
      withTutorials([
        tutorial({
          steps: [
            step(1, {
              answerChoices: [
                { id: "white", fragment: " " },
                { id: "black", fragment: "0.0" },
                { id: "half", fragment: "0.5" },
                { id: "quarter", fragment: "0.25" },
              ],
            }),
          ],
        }),
      ]),
    ).toThrow(/fragment must not be blank/i);
  });

  it("rejects an unknown correct choice id", () => {
    expect(() =>
      withTutorials([tutorial({ steps: [step(1, { correctChoiceId: "missing" })] })]),
    ).toThrow(/correct choice/i);
  });

  it("applies the sandbox contract after every substitution", () => {
    expect(() =>
      withTutorials([
        tutorial({
          steps: [
            step(1, {
              answerChoices: [
                { id: "white", fragment: "1.0" },
                { id: "black", fragment: "gl_FragColor = vec4(0.0);" },
                { id: "half", fragment: "0.5" },
                { id: "quarter", fragment: "0.25" },
              ],
            }),
          ],
        }),
      ]),
    ).toThrow(/gl_FragColor/);
  });

  it("rejects choices that render the same source", () => {
    expect(() =>
      withTutorials([
        tutorial({
          steps: [
            step(1, {
              answerChoices: [
                { id: "white", fragment: "1.0" },
                { id: "black", fragment: "1.0" },
                { id: "half", fragment: "0.5" },
                { id: "quarter", fragment: "0.25" },
              ],
            }),
          ],
        }),
      ]),
    ).toThrow(/duplicate rendered source/i);
  });

  it("rejects a tutorial belonging to a different module", () => {
    expect(() => withTutorials([tutorial({ moduleId: "elsewhere" })])).toThrow(/must belong/i);
  });

  it("rejects a step brief that is a bare imperative", () => {
    expect(() =>
      withTutorials([tutorial({ steps: [step(1, { brief: "Make it red." })] })]),
    ).toThrow(/brief must be at least/i);
  });
});
