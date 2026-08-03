import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";

import { Colors } from "../constants/theme";

export type CoordinateMode =
  | "normalized"
  | "centered"
  | "pixel-space"
  | "aspect-aware";
export type ShaderPreviewMode =
  | CoordinateMode
  | "rgb-gradient"
  | "color-mix"
  | "luminance"
  | "channel-split"
  | "time-static"
  | "time-play"
  | "time-slow"
  | "time-fast"
  | "transform-translate"
  | "transform-scale"
  | "transform-rotate"
  | "transform-repeat"
  | "challenge-grid"
  | "challenge-rings"
  | "challenge-orbit"
  | "challenge-final"
  | "logo-scanlines"
  | "logo-ribbon"
  | "logo-cutout"
  | "logo-final"
  | "edge-hard"
  | "edge-smooth"
  | "edge-outline"
  | "edge-animated"
  | "primitive-circle"
  | "primitive-box"
  | "primitive-rounded-box"
  | "primitive-combined"
  | "boolean-union"
  | "boolean-intersection"
  | "boolean-subtraction"
  | "boolean-xor"
  | "repeat-grid"
  | "repeat-rotate"
  | "repeat-layer"
  | "repeat-animate"
  | "synthesis-badge"
  | "synthesis-face"
  | "synthesis-flower"
  | "synthesis-final"
  | "light-mix-linear"
  | "light-mix-smooth"
  | "light-mix-three"
  | "light-mix-radial";

type LiveShaderPreviewProps = {
  mode: ShaderPreviewMode;
  restartToken?: number;
};

const vertexShaderSource = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision highp float;

uniform vec2 u_resolution;
uniform float u_mode;
uniform float u_time;
varying vec2 v_uv;

float gridLine(float value, float scale) {
  float cell = fract(value * scale);
  float distanceToEdge = min(cell, 1.0 - cell);
  return 1.0 - smoothstep(0.0, 0.025, distanceToEdge);
}

float sdBox(vec2 p, vec2 halfSize) {
  vec2 q = abs(p) - halfSize;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}

float sdRoundBox(vec2 p, vec2 halfSize, float radius) {
  return sdBox(p, halfSize - vec2(radius)) - radius;
}

void main() {
  vec2 normalized = v_uv;
  vec2 centered = v_uv * 2.0 - 1.0;
  centered.x *= u_resolution.x / u_resolution.y;

  vec2 displayUv = mix(normalized, centered * 0.5 + 0.5, u_mode);
  vec3 cyan = vec3(0.314, 0.835, 1.0);
  vec3 violet = vec3(0.608, 0.482, 1.0);
  vec3 coral = vec3(1.0, 0.42, 0.42);
  vec3 color = mix(cyan, violet, smoothstep(0.0, 1.0, displayUv.x));
  color = mix(color, coral, smoothstep(0.25, 1.0, displayUv.y) * 0.55);

  vec2 gridUv = mix(normalized, centered, u_mode);
  float scale = mix(10.0, 5.0, u_mode);
  float grid = max(gridLine(gridUv.x, scale), gridLine(gridUv.y, scale));
  color = mix(color * 0.62, vec3(0.96), grid * 0.18);

  float xAxis = 1.0 - smoothstep(0.0, 0.012, abs(centered.y));
  float yAxis = 1.0 - smoothstep(0.0, 0.012, abs(centered.x));
  float axes = max(xAxis, yAxis) * u_mode;
  color = mix(color, vec3(0.78, 0.96, 0.39), axes * 0.78);

  vec2 markerPosition = vec2(
    0.5 + cos(u_time * 0.8) * 0.24,
    0.5 + sin(u_time * 1.1) * 0.2
  );
  float marker = 1.0 - smoothstep(0.018, 0.024, distance(normalized, markerPosition));
  color = mix(color, vec3(1.0), marker);

  float vignette = 1.0 - smoothstep(0.35, 0.82, distance(normalized, vec2(0.5)));
  color *= 0.74 + vignette * 0.26;

  if (u_mode > 1.5 && u_mode < 2.5) {
    vec2 pixelGrid = floor(normalized * vec2(16.0, 10.0));
    vec2 pixelUv = pixelGrid / vec2(15.0, 9.0);
    color = vec3(pixelUv, 0.28);
    float cellX = gridLine(normalized.x, 16.0);
    float cellY = gridLine(normalized.y, 10.0);
    color = mix(color, vec3(0.95), max(cellX, cellY) * 0.2);
  } else if (u_mode > 2.5 && u_mode < 3.5) {
    float radius = length(centered);
    float rings = 1.0 - smoothstep(0.018, 0.035, abs(fract(radius * 4.0) - 0.5));
    color = mix(vec3(0.08, 0.12, 0.18), vec3(0.31, 0.84, 1.0), rings * 0.72);
    float axes = max(
      1.0 - smoothstep(0.0, 0.012, abs(centered.x)),
      1.0 - smoothstep(0.0, 0.012, abs(centered.y))
    );
    color = mix(color, vec3(0.78, 0.96, 0.39), axes);
  } else if (u_mode > 3.5 && u_mode < 4.5) {
    color = vec3(normalized.x, normalized.y, 0.2);
  } else if (u_mode > 4.5 && u_mode < 5.5) {
    vec3 warm = vec3(1.0, 0.25, 0.12);
    vec3 cool = vec3(0.12, 0.45, 1.0);
    color = mix(warm, cool, smoothstep(0.0, 1.0, normalized.x));
  } else if (u_mode > 5.5 && u_mode < 6.5) {
    float value = smoothstep(0.0, 1.0, normalized.x);
    color = vec3(value);
  } else if (u_mode > 6.5 && u_mode < 7.5) {
    color = vec3(normalized.x, 1.0 - normalized.y, normalized.y);
  } else if (u_mode > 7.5 && u_mode < 11.5) {
    float speed = 1.0;
    if (u_mode < 8.5) speed = 0.0;
    else if (u_mode > 9.5 && u_mode < 10.5) speed = 0.5;
    else if (u_mode > 10.5) speed = 2.0;

    float t = u_time * speed;
    vec2 p = centered;
    float wave = 0.5 + 0.5 * sin(p.x * 8.0 - t * 3.0);
    float pulse = 0.5 + 0.5 * sin(t * 2.0);
    vec3 dark = vec3(0.04, 0.07, 0.11);
    vec3 lime = vec3(0.78, 0.96, 0.39);
    vec3 blue = vec3(0.31, 0.84, 1.0);
    color = mix(dark, mix(blue, lime, pulse), wave);
  } else if (u_mode > 11.5 && u_mode < 15.5) {
    vec2 p = centered;
    if (u_mode < 12.5) {
      p -= vec2(0.35, -0.18);
    } else if (u_mode < 13.5) {
      p *= 1.8;
    } else if (u_mode < 14.5) {
      float angle = 0.65;
      mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
      p = rotation * p;
    } else {
      p = fract((p * 0.5 + 0.5) * 3.0) - 0.5;
      p.x *= u_resolution.x / u_resolution.y;
    }

    float box = max(abs(p.x), abs(p.y));
    float shape = 1.0 - smoothstep(0.28, 0.30, box);
    float inner = 1.0 - smoothstep(0.12, 0.14, length(p));
    vec3 background = vec3(0.035, 0.055, 0.085);
    color = mix(background, vec3(0.31, 0.84, 1.0), shape);
    color = mix(color, vec3(0.78, 0.96, 0.39), inner);
  } else if (u_mode > 15.5 && u_mode < 19.5) {
    vec2 p = centered;
    float gridX = gridLine(p.x + u_time * 0.035, 5.0);
    float gridY = gridLine(p.y, 5.0);
    float gridMask = max(gridX, gridY) * 0.22;
    float radius = length(p);
    float rings = 1.0 - smoothstep(0.025, 0.05, abs(fract(radius * 4.0 - u_time * 0.22) - 0.5));
    vec2 orbiter = vec2(cos(u_time), sin(u_time)) * 0.42;
    float orbit = 1.0 - smoothstep(0.055, 0.075, distance(p, orbiter));
    vec3 dark = vec3(0.025, 0.04, 0.07);
    vec3 lime = vec3(0.78, 0.96, 0.39);
    vec3 blue = vec3(0.31, 0.84, 1.0);
    vec3 violet = vec3(0.61, 0.48, 1.0);

    if (u_mode < 16.5) {
      color = mix(dark, blue, gridMask * 2.4);
    } else if (u_mode < 17.5) {
      color = mix(dark, violet, rings * 0.85);
    } else if (u_mode < 18.5) {
      float orbitPath = 1.0 - smoothstep(0.008, 0.018, abs(radius - 0.42));
      color = mix(dark, blue, orbitPath * 0.35);
      color = mix(color, lime, orbit);
    } else {
      color = mix(dark, blue, gridMask * 1.3);
      color = mix(color, violet, rings * 0.58);
      color = mix(color, lime, orbit);
      color *= 0.82 + 0.18 * (0.5 + 0.5 * sin(u_time * 2.0));
    }
  } else if (u_mode > 19.5 && u_mode < 23.5) {
    vec2 p = centered;
    float row = floor((p.y + 0.70) * 17.0);
    float random = fract(sin(row * 91.73) * 43758.5453);
    float randomRight = fract(sin((row + 19.0) * 73.17) * 24634.6345);
    float leftEdge;
    float rightEdge;

    if (p.y > 0.27) {
      float upper = smoothstep(0.27, 0.68, p.y);
      leftEdge = mix(-0.68, -0.29, upper);
      rightEdge = mix(0.50, 0.63, upper);
    } else if (p.y > -0.27) {
      float middle = clamp((0.27 - p.y) / 0.54, 0.0, 1.0);
      leftEdge = mix(-0.68, 0.28, smoothstep(0.43, 1.0, middle));
      rightEdge = mix(-0.28, 0.68, smoothstep(0.0, 0.57, middle));
    } else {
      float lower = smoothstep(-0.68, -0.27, p.y);
      leftEdge = mix(-0.63, -0.52, lower);
      rightEdge = mix(0.29, 0.67, lower);
    }

    leftEdge += (random - 0.5) * 0.035;
    rightEdge += (randomRight - 0.5) * 0.04;
    float envelope = smoothstep(leftEdge, leftEdge + 0.018, p.x);
    envelope *= 1.0 - smoothstep(rightEdge - 0.018, rightEdge, p.x);
    envelope *= 1.0 - smoothstep(0.67, 0.71, abs(p.y));

    float stripeDistance = abs(fract((p.y + 0.70) * 17.0) - 0.5);
    float rowCenterY = (row + 0.5) / 17.0 - 0.70;
    float verticalPhase = (rowCenterY + 0.68) / 1.36;
    if (u_mode > 22.5) {
      verticalPhase -= u_time * 0.08;
    }
    float bowlWeight = 0.5 - 0.5 * cos(verticalPhase * 12.5663706);
    float lineHalfWidth = mix(0.10, 0.34, bowlWeight);
    float scanlines = 1.0 - smoothstep(
      lineHalfWidth,
      lineHalfWidth + 0.035,
      stripeDistance
    );
    float finalMask = envelope * scanlines;
    vec3 ink = mix(vec3(0.58, 0.92, 0.25), vec3(0.84, 1.0, 0.48), normalized.y);
    vec3 background = vec3(0.035, 0.075, 0.075);

    if (u_mode < 20.5) {
      color = mix(background, ink, scanlines);
    } else if (u_mode < 21.5) {
      color = mix(background, ink, envelope);
    } else if (u_mode < 22.5) {
      color = mix(background, ink, finalMask);
    } else {
      float softLines = 1.0 - smoothstep(
        lineHalfWidth + 0.03,
        lineHalfWidth + 0.11,
        stripeDistance
      );
      float glow = envelope * softLines;
      color = background + ink * finalMask + ink * glow * 0.10;
      color *= 0.94 + 0.06 * sin(u_time * 1.2 + p.y * 4.0);
    }
  } else if (u_mode > 23.5 && u_mode < 43.5) {
    vec2 p = centered;
    vec3 background = vec3(0.025, 0.04, 0.065);
    vec3 lime = vec3(0.78, 0.96, 0.39);
    vec3 cyan = vec3(0.31, 0.84, 1.0);
    vec3 violet = vec3(0.61, 0.48, 1.0);
    float circleDistance = length(p) - 0.42;
    float boxDistance = sdBox(p, vec2(0.36));
    float mask = 0.0;

    if (u_mode < 24.5) {
      mask = 1.0 - step(0.0, circleDistance);
      color = mix(background, lime, mask);
    } else if (u_mode < 25.5) {
      mask = 1.0 - smoothstep(-0.025, 0.025, circleDistance);
      color = mix(background, cyan, mask);
    } else if (u_mode < 26.5) {
      mask = 1.0 - smoothstep(0.018, 0.035, abs(circleDistance));
      color = mix(background, lime, mask);
    } else if (u_mode < 27.5) {
      float radius = 0.34 + 0.08 * sin(u_time * 2.0);
      mask = 1.0 - smoothstep(-0.02, 0.02, length(p) - radius);
      color = mix(background, mix(cyan, violet, normalized.y), mask);
    } else if (u_mode < 28.5) {
      mask = 1.0 - smoothstep(-0.018, 0.018, length(p) - 0.4);
      color = mix(background, cyan, mask);
    } else if (u_mode < 29.5) {
      mask = 1.0 - smoothstep(-0.018, 0.018, sdBox(p, vec2(0.38, 0.28)));
      color = mix(background, lime, mask);
    } else if (u_mode < 30.5) {
      mask = 1.0 - smoothstep(-0.018, 0.018, sdRoundBox(p, vec2(0.42, 0.3), 0.1));
      color = mix(background, violet, mask);
    } else if (u_mode < 31.5) {
      float circleMask = 1.0 - smoothstep(-0.02, 0.02, length(p + vec2(0.2, 0.0)) - 0.3);
      float boxMask = 1.0 - smoothstep(-0.02, 0.02, sdBox(p - vec2(0.2, 0.0), vec2(0.28)));
      color = background + cyan * circleMask * 0.8 + lime * boxMask * 0.8;
    } else if (u_mode < 35.5) {
      float a = length(p + vec2(0.18, 0.0)) - 0.34;
      float b = sdRoundBox(p - vec2(0.18, 0.0), vec2(0.32), 0.08);
      float distanceField;
      if (u_mode < 32.5) distanceField = min(a, b);
      else if (u_mode < 33.5) distanceField = max(a, b);
      else if (u_mode < 34.5) distanceField = max(a, -b);
      else distanceField = max(min(a, b), -max(a, b));
      mask = 1.0 - smoothstep(-0.018, 0.018, distanceField);
      color = mix(background, u_mode < 34.5 ? lime : violet, mask);
    } else if (u_mode < 39.5) {
      vec2 cell = fract((p * 0.5 + 0.5) * 4.0) - 0.5;
      cell.x *= u_resolution.x / u_resolution.y;
      if (u_mode > 36.5) {
        float angle = (floor((p.x * 0.5 + 0.5) * 4.0) + floor((p.y * 0.5 + 0.5) * 4.0)) * 0.35;
        if (u_mode > 38.5) angle += u_time;
        mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        cell = rotation * cell;
      }
      float repeatedCircle = length(cell) - 0.16;
      float repeatedBox = sdBox(cell, vec2(0.13));
      if (u_mode < 36.5) mask = 1.0 - smoothstep(-0.018, 0.018, repeatedCircle);
      else if (u_mode < 37.5) mask = 1.0 - smoothstep(-0.018, 0.018, repeatedBox);
      else if (u_mode < 38.5) {
        float circles = 1.0 - smoothstep(-0.018, 0.018, repeatedCircle);
        float boxes = 1.0 - smoothstep(-0.018, 0.018, repeatedBox);
        color = background + cyan * circles * 0.7 + violet * boxes * 0.5;
      } else mask = 1.0 - smoothstep(-0.018, 0.018, repeatedBox);
      if (u_mode < 37.5 || u_mode > 38.5) color = mix(background, lime, mask);
    } else {
      float outer = length(p) - 0.52;
      float ring = 1.0 - smoothstep(0.015, 0.035, abs(outer));
      if (u_mode < 40.5) {
        float cross = max(
          1.0 - smoothstep(0.055, 0.075, abs(p.x)),
          1.0 - smoothstep(0.055, 0.075, abs(p.y))
        );
        color = background + cyan * ring + lime * cross * (1.0 - step(0.42, length(p)));
      } else if (u_mode < 41.5) {
        float head = 1.0 - smoothstep(-0.02, 0.02, sdRoundBox(p, vec2(0.46, 0.36), 0.1));
        float eyes = max(
          1.0 - smoothstep(0.045, 0.065, length(p - vec2(-0.18, 0.1))),
          1.0 - smoothstep(0.045, 0.065, length(p - vec2(0.18, 0.1)))
        );
        float mouth = 1.0 - smoothstep(0.015, 0.03, abs(sdBox(p + vec2(0.0, 0.15), vec2(0.2, 0.02))));
        color = background + violet * head * 0.65 + lime * max(eyes, mouth);
      } else if (u_mode < 42.5) {
        float petals = 0.0;
        for (int i = 0; i < 6; i++) {
          float angle = float(i) * 1.04719755;
          vec2 offset = vec2(cos(angle), sin(angle)) * 0.3;
          petals = max(petals, 1.0 - smoothstep(-0.015, 0.02, length(p - offset) - 0.2));
        }
        float centerDot = 1.0 - smoothstep(0.12, 0.14, length(p));
        color = background + violet * petals * 0.75 + lime * centerDot;
      } else {
        float pulse = 0.92 + 0.08 * sin(u_time * 2.0);
        float disc = 1.0 - smoothstep(-0.02, 0.02, length(p) - 0.5 * pulse);
        float cut = 1.0 - smoothstep(-0.02, 0.02, sdRoundBox(p, vec2(0.3), 0.08));
        float frame = 1.0 - smoothstep(0.015, 0.03, abs(length(p) - 0.58));
        color = background + cyan * disc * (1.0 - cut) + violet * cut * 0.7 + lime * frame;
      }
    }
  } else if (u_mode > 43.5) {
    vec2 p = centered;
    vec3 dark = vec3(0.025, 0.04, 0.065);
    vec3 cyan = vec3(0.08, 0.84, 1.0);
    vec3 violet = vec3(0.72, 0.30, 1.0);
    vec3 coral = vec3(1.0, 0.36, 0.22);
    vec3 lime = vec3(0.78, 0.96, 0.39);

    if (u_mode < 44.5) {
      color = mix(cyan, violet, normalized.x);
    } else if (u_mode < 45.5) {
      float t = smoothstep(0.2, 0.8, normalized.x);
      color = mix(lime, cyan, t);
    } else if (u_mode < 46.5) {
      float t = normalized.x * 2.0;
      vec3 left = mix(cyan, violet, clamp(t, 0.0, 1.0));
      vec3 right = mix(violet, coral, clamp(t - 1.0, 0.0, 1.0));
      color = mix(left, right, step(0.5, normalized.x));
    } else {
      float t = smoothstep(0.0, 0.92, length(p));
      color = mix(coral, cyan, t);
      color = mix(dark, color, 0.9 + 0.1 * cos(length(p) * 12.0));
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

function compileShader(
  gl: ExpoWebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create shader");

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? "Unknown shader compilation error";
    gl.deleteShader(shader);
    throw new Error(message);
  }

  return shader;
}

export function LiveShaderPreview({ mode, restartToken = 0 }: LiveShaderPreviewProps) {
  const modeRef = useRef(mode);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const startedAtRef = useRef(0);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    startedAtRef.current = globalThis.performance.now();
  }, [restartToken]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const createContext = (gl: ExpoWebGLRenderingContext) => {
    if (startedAtRef.current === 0) startedAtRef.current = globalThis.performance.now();

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to create shader program");

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Unable to link shader program");
    }

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 1, -1, -1, 1,
        -1, 1, 1, -1, 1, 1,
      ]),
      gl.STATIC_DRAW,
    );

    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    const resolution = gl.getUniformLocation(program, "u_resolution");
    const coordinateMode = gl.getUniformLocation(program, "u_mode");
    const time = gl.getUniformLocation(program, "u_time");
    startedAtRef.current = globalThis.performance.now();

    const render = () => {
      if (!mountedRef.current) return;

      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
      const modeValue: Record<ShaderPreviewMode, number> = {
        normalized: 0,
        centered: 1,
        "pixel-space": 2,
        "aspect-aware": 3,
        "rgb-gradient": 4,
        "color-mix": 5,
        luminance: 6,
        "channel-split": 7,
        "time-static": 8,
        "time-play": 9,
        "time-slow": 10,
        "time-fast": 11,
        "transform-translate": 12,
        "transform-scale": 13,
        "transform-rotate": 14,
        "transform-repeat": 15,
        "challenge-grid": 16,
        "challenge-rings": 17,
        "challenge-orbit": 18,
        "challenge-final": 19,
        "logo-scanlines": 20,
        "logo-ribbon": 21,
        "logo-cutout": 22,
        "logo-final": 23,
        "edge-hard": 24,
        "edge-smooth": 25,
        "edge-outline": 26,
        "edge-animated": 27,
        "primitive-circle": 28,
        "primitive-box": 29,
        "primitive-rounded-box": 30,
        "primitive-combined": 31,
        "boolean-union": 32,
        "boolean-intersection": 33,
        "boolean-subtraction": 34,
        "boolean-xor": 35,
        "repeat-grid": 36,
        "repeat-rotate": 37,
        "repeat-layer": 38,
        "repeat-animate": 39,
        "synthesis-badge": 40,
        "synthesis-face": 41,
        "synthesis-flower": 42,
        "synthesis-final": 43,
        "light-mix-linear": 44,
        "light-mix-smooth": 45,
        "light-mix-three": 46,
        "light-mix-radial": 47,
      };
      gl.uniform1f(coordinateMode, modeValue[modeRef.current]);
      gl.uniform1f(time, (globalThis.performance.now() - startedAtRef.current) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.endFrameEXP();

      frameRef.current = requestAnimationFrame(render);
    };

    render();
  };

  return (
    <View style={styles.container}>
      <GLView key="shape-synthesis-v1" onContextCreate={createContext} style={styles.glView} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 190,
    backgroundColor: Colors.surfaceRaised,
  },
  glView: {
    flex: 1,
  },
});
