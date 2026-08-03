import type { ShaderPreviewMode } from "../components/live-shader-preview";
import type { ModuleThreeLessonId } from "./curriculum";

export type ModuleThreePreset = {
  code: string[];
  filename: string;
  label: string;
  mode: ShaderPreviewMode;
  value: string;
};

export type ModuleThreeLessonContent = {
  conceptLede: string;
  conceptTitle: string;
  intro: string;
  presets: ModuleThreePreset[];
  sections: { body: string; title: string }[];
  takeaway: string;
  tryHint: string;
};

export const MODULE_THREE_CONTENT: Record<ModuleThreeLessonId, ModuleThreeLessonContent> = {
  "color-mixing": {
    intro:
      "Color is another signal you can shape with coordinates. Learn to interpolate two or more colors, control the transition curve, and turn spatial measurements into deliberate palettes.",
    conceptTitle: "Treat color as a field",
    conceptLede:
      "mix() interpolates every channel at once; the real design decision is the value you feed into it.",
    tryHint: "Compare four spatial color-mixing strategies",
    presets: [
      {
        label: "Linear blend",
        mode: "light-mix-linear",
        value: "mix(a, b, uv.x)",
        filename: "linear_mix.glsl",
        code: [
          "vec3 a = vec3(0.08, 0.84, 1.0);",
          "vec3 b = vec3(0.72, 0.30, 1.0);",
          "float t = uv.x;",
          "vec3 color = mix(a, b, t);",
          "fragColor = vec4(color, 1.0);",
        ],
      },
      {
        label: "Soft center",
        mode: "light-mix-smooth",
        value: "smoothstep(.2, .8, x)",
        filename: "smooth_mix.glsl",
        code: [
          "vec3 a = vec3(0.78, 0.96, 0.39);",
          "vec3 b = vec3(0.08, 0.56, 1.0);",
          "float t = smoothstep(0.2, 0.8, uv.x);",
          "vec3 color = mix(a, b, t);",
          "fragColor = vec4(color, 1.0);",
        ],
      },
      {
        label: "Three stops",
        mode: "light-mix-three",
        value: "cyan → violet → coral",
        filename: "three_stop_mix.glsl",
        code: [
          "vec3 left = mix(cyan, violet, uv.x * 2.0);",
          "vec3 right = mix(violet, coral, uv.x * 2.0 - 1.0);",
          "vec3 color = mix(left, right, step(0.5, uv.x));",
          "fragColor = vec4(color, 1.0);",
        ],
      },
      {
        label: "Radial blend",
        mode: "light-mix-radial",
        value: "mix(a, b, length(p))",
        filename: "radial_mix.glsl",
        code: [
          "vec2 p = uv * 2.0 - 1.0;",
          "float t = smoothstep(0.0, 0.9, length(p));",
          "vec3 color = mix(warm, cool, t);",
          "fragColor = vec4(color, 1.0);",
        ],
      },
    ],
    sections: [
      {
        title: "Interpolation is channel-wise",
        body:
          "For colors a and b, mix(a, b, t) computes a * (1 - t) + b * t for red, green, and blue independently. A t of 0 returns a, 1 returns b, and values between them trace a straight path through RGB space.",
      },
      {
        title: "Shape the blend factor",
        body:
          "A raw UV coordinate creates an even gradient. Passing it through smoothstep delays both ends and emphasizes the center transition. Distance, noise, time, or a shape mask can all become t, turning the same two colors into entirely different compositions.",
      },
      {
        title: "Build longer palettes in segments",
        body:
          "A multi-stop gradient is several small mixes joined across adjacent ranges. Remap each range back to 0–1 before mixing, then choose its result with a threshold. This keeps every stop intentional and reusable.",
      },
    ],
    takeaway:
      "Color mixing becomes procedural when the blend factor comes from the image itself. First choose the endpoints, then design the scalar field that travels between them.",
  },
};
