import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";

import { Colors } from "../constants/theme";

export type CoordinateMode = "normalized" | "centered";

type LiveShaderPreviewProps = {
  mode: CoordinateMode;
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

export function LiveShaderPreview({ mode }: LiveShaderPreviewProps) {
  const modeRef = useRef(mode);
  const frameRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

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
    const startedAt = globalThis.performance.now();

    const render = () => {
      if (!mountedRef.current) return;

      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform2f(resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(coordinateMode, modeRef.current === "centered" ? 1 : 0);
      gl.uniform1f(time, (globalThis.performance.now() - startedAt) / 1000);
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
