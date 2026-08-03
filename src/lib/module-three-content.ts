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
  "luma-and-contrast": {
    intro:
      "Brightness is not the average of red, green, and blue. Convert color to perceptual luma, then use that scalar signal to adjust contrast, isolate value bands, and manage exposure.",
    conceptTitle: "Read the light inside a color",
    conceptLede:
      "A weighted dot product compresses RGB into one useful measurement without treating every channel as equally bright.",
    tryHint: "Inspect and reshape the brightness signal",
    presets: [
      {
        label: "Perceptual luma",
        mode: "light-luma",
        value: "dot(rgb, lumaWeights)",
        filename: "luma.glsl",
        code: [
          "vec3 weights = vec3(0.2126, 0.7152, 0.0722);",
          "float luma = dot(color, weights);",
          "color = vec3(luma);",
          "fragColor = vec4(color, 1.0);",
        ],
      },
      {
        label: "More contrast",
        mode: "light-contrast",
        value: "(rgb - .5) * 1.65 + .5",
        filename: "contrast.glsl",
        code: [
          "float amount = 1.65;",
          "vec3 centered = color - 0.5;",
          "color = centered * amount + 0.5;",
          "fragColor = vec4(color, 1.0);",
        ],
      },
      {
        label: "Value bands",
        mode: "light-threshold",
        value: "floor(luma * 5.0)",
        filename: "luma_bands.glsl",
        code: [
          "float luma = dot(color, LUMA);",
          "float band = floor(luma * 5.0) / 4.0;",
          "color = mix(shadow, highlight, band);",
          "fragColor = vec4(color, 1.0);",
        ],
      },
      {
        label: "Exposure curve",
        mode: "light-exposure",
        value: "1.0 - exp(-rgb * 1.7)",
        filename: "exposure.glsl",
        code: [
          "float exposure = 1.7;",
          "color = vec3(1.0) - exp(-color * exposure);",
          "fragColor = vec4(color, 1.0);",
        ],
      },
    ],
    sections: [
      {
        title: "Human vision favors green",
        body:
          "The Rec. 709 luma weights assign the most influence to green, less to red, and very little to blue. The dot product turns those three weighted contributions into a single brightness estimate you can reuse as a mask or control value.",
      },
      {
        title: "Contrast pivots around a midpoint",
        body:
          "Subtracting 0.5 moves mid-gray to zero. Scaling then pushes darker values down and brighter values up; adding 0.5 restores the original range. Values may leave 0–1, so clamp when later operations require a bounded signal.",
      },
      {
        title: "Exposure rolls into white",
        body:
          "Multiplication brightens linearly and can clip abruptly. The exponential exposure curve rises quickly but approaches white gradually, preserving a softer highlight transition that feels closer to light accumulating on a sensor.",
      },
    ],
    takeaway:
      "Luma converts color into structure. Once brightness is a scalar field, the same threshold, remapping, and easing tools used for shapes can art-direct the light in an image.",
  },
};
