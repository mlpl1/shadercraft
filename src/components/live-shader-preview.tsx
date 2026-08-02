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
  | "time-fast";

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
  } else if (u_mode > 7.5) {
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
  const startedAtRef = useRef(globalThis.performance.now());

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
      <GLView onContextCreate={createContext} style={styles.glView} />
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
