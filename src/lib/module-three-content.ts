import type { ShaderPreviewMode } from "../components/live-shader-preview";
import type { ModuleThreeLessonId } from "./curriculum";

export type ModuleThreePreset = {
  code: string[];
  filename: string;
  highlightedLines: number[];
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
        highlightedLines: [4],
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
        highlightedLines: [3],
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
        highlightedLines: [1, 2, 3],
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
        highlightedLines: [2, 3],
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
        highlightedLines: [2],
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
        highlightedLines: [2, 3],
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
        highlightedLines: [2],
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
        highlightedLines: [2],
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
  "procedural-palettes": {
    intro:
      "A palette can be a function instead of a list. Use offset, amplitude, frequency, and phase to generate smooth families of colors from one scalar input.",
    conceptTitle: "Compose color with cosine",
    conceptLede:
      "Four vec3 parameters control the center, range, repetition, and channel timing of an entire gradient.",
    tryHint: "Change how one palette function travels through color",
    presets: [
      {
        label: "Cosine ramp",
        mode: "palette-cosine",
        value: "a + b*cos(TAU*(c*t+d))",
        filename: "cosine_palette.glsl",
        highlightedLines: [2],
        code: [
          "vec3 palette(float t) {",
          "  return a + b * cos(TAU * (c * t + d));",
          "}",
          "vec3 color = palette(uv.x);",
          "fragColor = vec4(color, 1.0);",
        ],
      },
      {
        label: "Channel phase",
        mode: "palette-phase",
        value: "d = vec3(0, .33, .67)",
        filename: "channel_phase.glsl",
        highlightedLines: [1],
        code: [
          "vec3 d = vec3(0.0, 0.33, 0.67);",
          "vec3 color = a + b * cos(TAU * (c * uv.x + d));",
          "fragColor = vec4(color, 1.0);",
        ],
      },
      {
        label: "Spatial palette",
        mode: "palette-spatial",
        value: "t = radius + angle",
        filename: "spatial_palette.glsl",
        highlightedLines: [2, 3],
        code: [
          "vec2 p = uv * 2.0 - 1.0;",
          "float t = length(p) * 0.75;",
          "t += atan(p.y, p.x) * 0.12;",
          "vec3 color = palette(t);",
          "fragColor = vec4(color, 1.0);",
        ],
      },
      {
        label: "Animated palette",
        mode: "palette-animated",
        value: "t = radius - time*.12",
        filename: "animated_palette.glsl",
        highlightedLines: [1],
        code: [
          "float t = length(p) * 0.8 - u_time * 0.12;",
          "vec3 phase = d + 0.1 * sin(u_time * 0.35);",
          "vec3 color = a + b * cos(TAU * (c * t + phase));",
          "fragColor = vec4(color, 1.0);",
        ],
      },
    ],
    sections: [
      {
        title: "Offset and amplitude set the range",
        body:
          "Parameter a is the palette's center color, while b controls how far each channel swings above and below it. Starting both near 0.5 tends to keep the result inside displayable 0–1 values.",
      },
      {
        title: "Frequency and phase create character",
        body:
          "Parameter c controls how often each channel cycles as t changes. Parameter d shifts those cycles relative to each other. Separating the red, green, and blue phases produces richer hue travel than moving every channel together.",
      },
      {
        title: "The input connects palette to form",
        body:
          "The palette function does not know about pixels. Feed it uv.x for a strip, distance for rings, angle for a wheel, a shape distance for colored edges, or time for motion. The same palette becomes a reusable rendering tool.",
      },
    ],
    takeaway:
      "A procedural palette separates color design from spatial design. Tune the four color parameters once, then reuse the function with any scalar field your shader produces.",
  },
  "color-light-challenge": {
    intro:
      "Combine Module 3 into a luminous procedural orb. Build its albedo from a palette, recover a surface normal, add diffuse and rim light, then animate a polished final composition.",
    conceptTitle: "Make a flat field feel illuminated",
    conceptLede:
      "A normal, a light direction, and a few dot products are enough to suggest three-dimensional form in a fragment shader.",
    tryHint: "Assemble the final material one lighting layer at a time",
    presets: [
      {
        label: "Palette albedo",
        mode: "lighting-albedo",
        value: "palette(normal.y)",
        filename: "01_albedo.glsl",
        highlightedLines: [3],
        code: [
          "float orb = 1.0 - smoothstep(r - aa, r + aa, length(p));",
          "vec3 normal = sphereNormal(p, r);",
          "vec3 albedo = palette(normal.y * 0.35 + 0.2);",
          "color = mix(background, albedo, orb);",
        ],
      },
      {
        label: "Diffuse light",
        mode: "lighting-diffuse",
        value: "max(dot(n, light), 0)",
        filename: "02_diffuse.glsl",
        highlightedLines: [2],
        code: [
          "vec3 lightDir = normalize(vec3(-0.55, 0.65, 0.75));",
          "float diffuse = max(dot(normal, lightDir), 0.0);",
          "vec3 lit = albedo * (0.16 + diffuse * 0.92);",
          "color = mix(background, lit, orb);",
        ],
      },
      {
        label: "Rim light",
        mode: "lighting-rim",
        value: "pow(1.0 - normal.z, 2.5)",
        filename: "03_rim.glsl",
        highlightedLines: [1],
        code: [
          "float rim = pow(1.0 - max(normal.z, 0.0), 2.5);",
          "vec3 lit = albedo * (0.12 + diffuse * 0.72);",
          "lit += cyan * rim * 0.85;",
          "color = mix(background, lit, orb);",
        ],
      },
      {
        label: "Final material",
        mode: "lighting-final",
        value: "diffuse + rim + specular",
        filename: "04_final_material.glsl",
        highlightedLines: [2, 3, 5],
        code: [
          "vec3 lightDir = orbitingLight(u_time);",
          "float diffuse = max(dot(normal, lightDir), 0.0);",
          "float specular = pow(max(dot(normal, halfDir), 0.0), 42.0);",
          "vec3 lit = albedo * (0.14 + diffuse * 0.9);",
          "lit += cyan * rim * 0.6 + warm * specular * 1.3;",
        ],
      },
    ],
    sections: [
      {
        title: "Recover a sphere normal",
        body:
          "Inside a circle of radius r, the missing z coordinate of a sphere is sqrt(r² - x² - y²). Combining p.x, p.y, and z produces a normal that turns a flat circle into a surface whose orientation changes across every fragment.",
      },
      {
        title: "Layer distinct lighting cues",
        body:
          "Diffuse light measures how directly the surface faces the light. Rim light strengthens edges that turn away from the camera. Specular light compares the surface normal with the halfway direction between the light and viewer, creating a tight highlight.",
      },
      {
        title: "Keep ambient light in the mix",
        body:
          "Multiplying only by diffuse makes the unlit side perfectly black. A small ambient term preserves the palette in shadow, while a restrained halo connects the bright material to its background without hiding the orb's silhouette.",
      },
    ],
    takeaway:
      "Convincing procedural light is a controlled sum of readable cues. Preserve the base palette, add each lighting term for a reason, and animate the light direction instead of rebuilding the material.",
  },
};
