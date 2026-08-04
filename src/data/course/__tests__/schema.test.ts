import { parseAuthoredModules } from "../schema";

const validModules = [
  {
    id: "shader-basics",
    position: 1,
    status: "published",
    title: "Shader basics",
    description: "Build a first fragment shader.",
    plannedLessonCount: 0,
    plannedTopics: [],
    lessons: [
      {
        id: "normalized-coordinates",
        moduleId: "shader-basics",
        position: 1,
        title: "Normalized coordinates",
        shortTitle: "Coordinates",
        intro: "Start with the pixel coordinate system.",
        conceptTitle: "Coordinate space",
        conceptLede: "Normalize fragment coordinates before drawing.",
        tryHint: "Change the divisor.",
        takeaway: "Coordinates can be normalized.",
        previewCaption: "UV preview",
        presets: [
          {
            id: "normalized-default",
            position: 1,
            label: "Default",
            previewKey: "normalized",
            previewParameters: { animated: false, restartable: true },
            value: "vec2 uv = gl_FragCoord.xy / u_resolution.xy;",
            filename: "normalized.frag",
            codeLines: [
              "void main() {",
              "  vec2 uv = gl_FragCoord.xy / u_resolution.xy;",
              "}",
            ],
            highlightedLines: [2],
          },
        ],
        sections: [
          {
            id: "why-normalize",
            position: 1,
            title: "Why normalize",
            body: "Normalized values are resolution independent.",
          },
        ],
      },
    ],
  },
  {
    id: "shader-animation",
    position: 2,
    status: "planned",
    title: "Shader animation",
    description: "Animate a shader with time.",
    plannedLessonCount: 2,
    plannedTopics: ["Time uniforms", "Looping motion"],
    lessons: [],
  },
];

function copyModules() {
  return JSON.parse(JSON.stringify(validModules));
}

describe("curriculum authoring schema", () => {
  it("accepts published lessons and planned modules", () => {
    expect(() => parseAuthoredModules(validModules)).not.toThrow();
  });

  it("rejects duplicate lesson IDs", () => {
    const duplicateLessonIds = copyModules();
    duplicateLessonIds[0].lessons.push({ ...duplicateLessonIds[0].lessons[0], position: 2 });

    expect(() => parseAuthoredModules(duplicateLessonIds)).toThrow(/duplicate lesson id/i);
  });

  it("accepts every preview parameter the installed app supports", () => {
    const supportedParameters = copyModules();
    supportedParameters[0].lessons[0].presets[0].previewParameters = {
      animated: true,
      restartable: false,
    };

    expect(() => parseAuthoredModules(supportedParameters)).not.toThrow();
  });

  it("rejects preview parameters the installed app does not implement", () => {
    const unknownParameter = copyModules();
    unknownParameter[0].lessons[0].presets[0].previewParameters = { showGrid: true, scale: 1 };

    expect(() => parseAuthoredModules(unknownParameter)).toThrow(/preview parameter/i);
  });

  it("rejects a supported preview parameter authored with the wrong type", () => {
    const wronglyTypedParameter = copyModules();
    wronglyTypedParameter[0].lessons[0].presets[0].previewParameters = { restartable: "yes" };

    expect(() => parseAuthoredModules(wronglyTypedParameter)).toThrow(/boolean/i);
  });

  it("accepts a default preset that names one of the lesson's own presets", () => {
    const authoredDefault = copyModules();
    authoredDefault[0].lessons[0].defaultPresetId = "normalized-default";

    expect(() => parseAuthoredModules(authoredDefault)).not.toThrow();
  });

  it("rejects a default preset that does not exist in the lesson", () => {
    const unknownDefault = copyModules();
    unknownDefault[0].lessons[0].defaultPresetId = "not-a-preset";

    expect(() => parseAuthoredModules(unknownDefault)).toThrow(/default preset/i);
  });

  it("rejects unknown preview keys", () => {
    const unknownPreviewKey = copyModules();
    unknownPreviewKey[0].lessons[0].presets[0].previewKey = "remote-arbitrary-shader";

    expect(() => parseAuthoredModules(unknownPreviewKey)).toThrow(/preview key/i);
  });

  it("rejects highlights outside the preset code", () => {
    const outOfRangeHighlight = copyModules();
    outOfRangeHighlight[0].lessons[0].presets[0].highlightedLines = [4];

    expect(() => parseAuthoredModules(outOfRangeHighlight)).toThrow(/highlighted line/i);
  });

  it("rejects published modules without lessons", () => {
    const publishedModuleWithoutLessons = copyModules();
    publishedModuleWithoutLessons[0].lessons = [];

    expect(() => parseAuthoredModules(publishedModuleWithoutLessons)).toThrow(/published module/i);
  });

  it("rejects published modules whose lesson has no required child content", () => {
    const publishedModuleWithHollowLesson = copyModules();
    publishedModuleWithHollowLesson[0].lessons[0].presets = [];
    publishedModuleWithHollowLesson[0].lessons[0].sections = [];

    expect(() => parseAuthoredModules(publishedModuleWithHollowLesson)).toThrow();
  });

  it("rejects planned modules with lessons", () => {
    const plannedModuleWithLessons = copyModules();
    plannedModuleWithLessons[1].lessons = [copyModules()[0].lessons[0]];

    expect(() => parseAuthoredModules(plannedModuleWithLessons)).toThrow(/planned module/i);
  });
});
