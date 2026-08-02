import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppIcon } from "../components/app-icon";
import {
  LiveShaderPreview,
  type CoordinateMode,
  type ShaderPreviewMode,
} from "../components/live-shader-preview";
import { LessonCompletionSheet } from "../components/lesson-completion-sheet";
import { Colors, Radius, Spacing } from "../constants/theme";
import { useProgress } from "../context/progress-context";
import {
  COLORS_FRAGMENT_OUTPUT_LESSON_ID,
  FOUNDATION_CHALLENGE_LESSON_ID,
  getModuleOneLesson,
  getNextModuleOneLesson,
  MODULE_ONE_LESSONS,
  TRANSFORMING_UVS_LESSON_ID,
  type ModuleOneLessonId,
  UNIFORMS_TIME_LESSON_ID,
} from "../lib/curriculum";

const codeLinesByMode: Record<
  CoordinateMode,
  { number: number; code: string; accent?: boolean }[]
> = {
  normalized: [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;", accent: true },
    { number: 2, code: "" },
    { number: 3, code: "vec3 color = vec3(uv, 0.0);" },
    { number: 4, code: "fragColor = vec4(color, 1.0);" },
  ],
  centered: [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;" },
    { number: 2, code: "uv = uv * 2.0 - 1.0;", accent: true },
    { number: 3, code: "uv.x *= resolution.x / resolution.y;", accent: true },
    { number: 4, code: "" },
    { number: 5, code: "vec3 color = vec3(" },
    { number: 6, code: "  uv * 0.5 + 0.5," },
    { number: 7, code: "  0.0" },
    { number: 8, code: ");" },
    { number: 9, code: "fragColor = vec4(color, 1.0);" },
  ],
  "pixel-space": [
    { number: 1, code: "vec2 pixel = fragCoord;", accent: true },
    { number: 2, code: "vec2 uv = pixel / resolution.xy;" },
    { number: 3, code: "vec3 color = vec3(uv, 0.28);" },
    { number: 4, code: "fragColor = vec4(color, 1.0);" },
  ],
  "aspect-aware": [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;" },
    { number: 2, code: "vec2 p = uv * 2.0 - 1.0;" },
    { number: 3, code: "p.x *= resolution.x / resolution.y;", accent: true },
    { number: 4, code: "float radius = length(p);" },
    { number: 5, code: "vec3 color = vec3(radius);" },
    { number: 6, code: "fragColor = vec4(color, 1.0);" },
  ],
};

const coordinatePresetOptions: Array<{
  label: string;
  mode: CoordinateMode;
  value: string;
}> = [
  { label: "Normalized", mode: "normalized", value: "0 → 1" },
  { label: "Centered", mode: "centered", value: "−1 → 1" },
  { label: "Pixel space", mode: "pixel-space", value: "0 → resolution" },
  { label: "Corrected", mode: "aspect-aware", value: "Aspect aware" },
];

type ColorMode =
  | "rgb-gradient"
  | "color-mix"
  | "luminance"
  | "channel-split";

const colorCodeLines: Record<
  ColorMode,
  { number: number; code: string; accent?: boolean }[]
> = {
  "rgb-gradient": [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;" },
    { number: 2, code: "vec3 color = vec3(uv.x, uv.y, 0.2);", accent: true },
    { number: 3, code: "fragColor = vec4(color, 1.0);", accent: true },
  ],
  "color-mix": [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;" },
    { number: 2, code: "vec3 warm = vec3(1.0, 0.25, 0.12);" },
    { number: 3, code: "vec3 cool = vec3(0.12, 0.45, 1.0);" },
    { number: 4, code: "vec3 color = mix(warm, cool, uv.x);", accent: true },
    { number: 5, code: "fragColor = vec4(color, 1.0);", accent: true },
  ],
  luminance: [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;" },
    { number: 2, code: "float value = smoothstep(0.0, 1.0, uv.x);", accent: true },
    { number: 3, code: "vec3 color = vec3(value);" },
    { number: 4, code: "fragColor = vec4(color, 1.0);" },
  ],
  "channel-split": [
    { number: 1, code: "vec2 uv = fragCoord / resolution.xy;" },
    { number: 2, code: "float red = uv.x;" },
    { number: 3, code: "float green = 1.0 - uv.y;" },
    { number: 4, code: "float blue = uv.y;" },
    { number: 5, code: "vec3 color = vec3(red, green, blue);", accent: true },
    { number: 6, code: "fragColor = vec4(color, 1.0);" },
  ],
};

const colorPresetOptions: Array<{
  label: string;
  mode: ColorMode;
  value: string;
}> = [
  { label: "RGB channels", mode: "rgb-gradient", value: "vec3(r, g, b)" },
  { label: "Mix colors", mode: "color-mix", value: "mix(a, b, t)" },
  { label: "Luminance", mode: "luminance", value: "vec3(value)" },
  { label: "Split channels", mode: "channel-split", value: "r · g · b" },
];

const colorFilenames: Record<ColorMode, string> = {
  "rgb-gradient": "fragment_color.glsl",
  "color-mix": "color_mix.glsl",
  luminance: "luminance.glsl",
  "channel-split": "channel_split.glsl",
};

type TimeMode = "time-static" | "time-play" | "time-slow" | "time-fast";

const timePresetOptions: Array<{
  label: string;
  mode: TimeMode;
  value: string;
}> = [
  { label: "Static", mode: "time-static", value: "u_time = 0" },
  { label: "Play", mode: "time-play", value: "u_time" },
  { label: "Half speed", mode: "time-slow", value: "u_time × 0.5" },
  { label: "Double speed", mode: "time-fast", value: "u_time × 2.0" },
];

const timeCodeLines: Record<
  TimeMode,
  { number: number; code: string; accent?: boolean }[]
> = {
  "time-static": [
    { number: 1, code: "uniform float u_time;" },
    { number: 2, code: "float t = 0.0;", accent: true },
    { number: 3, code: "float wave = sin(uv.x * 8.0 - t);" },
    { number: 4, code: "fragColor = vec4(vec3(wave), 1.0);" },
  ],
  "time-play": [
    { number: 1, code: "uniform float u_time;", accent: true },
    { number: 2, code: "float t = u_time;", accent: true },
    { number: 3, code: "float wave = sin(uv.x * 8.0 - t * 3.0);" },
    { number: 4, code: "fragColor = vec4(vec3(wave), 1.0);" },
  ],
  "time-slow": [
    { number: 1, code: "uniform float u_time;" },
    { number: 2, code: "float t = u_time * 0.5;", accent: true },
    { number: 3, code: "float wave = sin(uv.x * 8.0 - t * 3.0);" },
    { number: 4, code: "fragColor = vec4(vec3(wave), 1.0);" },
  ],
  "time-fast": [
    { number: 1, code: "uniform float u_time;" },
    { number: 2, code: "float t = u_time * 2.0;", accent: true },
    { number: 3, code: "float wave = sin(uv.x * 8.0 - t * 3.0);" },
    { number: 4, code: "fragColor = vec4(vec3(wave), 1.0);" },
  ],
};

const timeFilenames: Record<TimeMode, string> = {
  "time-static": "static_uniform.glsl",
  "time-play": "animated_time.glsl",
  "time-slow": "slow_time.glsl",
  "time-fast": "fast_time.glsl",
};

type TransformMode =
  | "transform-translate"
  | "transform-scale"
  | "transform-rotate"
  | "transform-repeat";

const transformPresetOptions: Array<{
  label: string;
  mode: TransformMode;
  value: string;
}> = [
  { label: "Translate", mode: "transform-translate", value: "p − offset" },
  { label: "Scale", mode: "transform-scale", value: "p × 1.8" },
  { label: "Rotate", mode: "transform-rotate", value: "mat2(angle)" },
  { label: "Repeat", mode: "transform-repeat", value: "fract(p × 3)" },
];

const transformCodeLines: Record<
  TransformMode,
  { number: number; code: string; accent?: boolean }[]
> = {
  "transform-translate": [
    { number: 1, code: "vec2 p = centeredUv;" },
    { number: 2, code: "p -= vec2(0.35, -0.18);", accent: true },
    { number: 3, code: "float shape = box(p, vec2(0.3));" },
    { number: 4, code: "fragColor = vec4(vec3(shape), 1.0);" },
  ],
  "transform-scale": [
    { number: 1, code: "vec2 p = centeredUv;" },
    { number: 2, code: "p *= 1.8;", accent: true },
    { number: 3, code: "float shape = box(p, vec2(0.3));" },
    { number: 4, code: "fragColor = vec4(vec3(shape), 1.0);" },
  ],
  "transform-rotate": [
    { number: 1, code: "float a = radians(37.0);" },
    { number: 2, code: "mat2 rot = mat2(cos(a), -sin(a),", accent: true },
    { number: 3, code: "                sin(a),  cos(a));" },
    { number: 4, code: "vec2 p = rot * centeredUv;", accent: true },
    { number: 5, code: "float shape = box(p, vec2(0.3));" },
  ],
  "transform-repeat": [
    { number: 1, code: "vec2 p = centeredUv * 0.5 + 0.5;" },
    { number: 2, code: "p = fract(p * 3.0) - 0.5;", accent: true },
    { number: 3, code: "p.x *= resolution.x / resolution.y;" },
    { number: 4, code: "float shape = box(p, vec2(0.3));" },
    { number: 5, code: "fragColor = vec4(vec3(shape), 1.0);" },
  ],
};

const transformFilenames: Record<TransformMode, string> = {
  "transform-translate": "translate_uv.glsl",
  "transform-scale": "scale_uv.glsl",
  "transform-rotate": "rotate_uv.glsl",
  "transform-repeat": "repeat_uv.glsl",
};

type ChallengeMode =
  | "challenge-grid"
  | "challenge-rings"
  | "challenge-orbit"
  | "challenge-final";

const challengePresetOptions: Array<{
  label: string;
  mode: ChallengeMode;
  value: string;
}> = [
  { label: "Grid layer", mode: "challenge-grid", value: "UV + time" },
  { label: "Pulse rings", mode: "challenge-rings", value: "length + fract" },
  { label: "Orbit", mode: "challenge-orbit", value: "sin + cos" },
  { label: "Composite", mode: "challenge-final", value: "all layers" },
];

const challengeCodeLines: Record<
  ChallengeMode,
  { number: number; code: string; accent?: boolean }[]
> = {
  "challenge-grid": [
    { number: 1, code: "vec2 p = centeredAspectUv;" },
    { number: 2, code: "p.x += u_time * 0.035;", accent: true },
    { number: 3, code: "float grid = gridLines(p, 5.0);" },
    { number: 4, code: "color = mix(dark, blue, grid);" },
  ],
  "challenge-rings": [
    { number: 1, code: "float radius = length(p);" },
    { number: 2, code: "float phase = radius * 4.0 - u_time * 0.22;" },
    { number: 3, code: "float rings = ringMask(fract(phase));", accent: true },
    { number: 4, code: "color = mix(dark, violet, rings);" },
  ],
  "challenge-orbit": [
    { number: 1, code: "vec2 orbit = vec2(cos(u_time), sin(u_time));", accent: true },
    { number: 2, code: "orbit *= 0.42;" },
    { number: 3, code: "float dot = circle(p - orbit, 0.065);" },
    { number: 4, code: "color = mix(color, lime, dot);" },
  ],
  "challenge-final": [
    { number: 1, code: "vec3 color = gridLayer(p, u_time);" },
    { number: 2, code: "color = mix(color, violet, pulseRings(p));" },
    { number: 3, code: "color = mix(color, lime, orbitDot(p));", accent: true },
    { number: 4, code: "color *= 0.9 + 0.1 * sin(u_time * 2.0);" },
    { number: 5, code: "fragColor = vec4(color, 1.0);", accent: true },
  ],
};

const challengeFilenames: Record<ChallengeMode, string> = {
  "challenge-grid": "challenge_grid.glsl",
  "challenge-rings": "challenge_rings.glsl",
  "challenge-orbit": "challenge_orbit.glsl",
  "challenge-final": "foundation_composite.glsl",
};

export default function LessonScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ lessonId?: string }>();
  const requestedLesson = getModuleOneLesson(params.lessonId);
  const requestedLessonIndex = requestedLesson
    ? MODULE_ONE_LESSONS.findIndex((item) => item.id === requestedLesson.id)
    : -1;
  const lesson = requestedLessonIndex >= 0 && requestedLessonIndex < 5
    ? requestedLesson!
    : MODULE_ONE_LESSONS[0];
  const lessonId = lesson.id as ModuleOneLessonId;
  const lessonIndex = MODULE_ONE_LESSONS.findIndex((item) => item.id === lessonId);
  const isColorLesson = lessonId === COLORS_FRAGMENT_OUTPUT_LESSON_ID;
  const isTimeLesson = lessonId === UNIFORMS_TIME_LESSON_ID;
  const isTransformLesson = lessonId === TRANSFORMING_UVS_LESSON_ID;
  const isChallengeLesson = lessonId === FOUNDATION_CHALLENGE_LESSON_ID;
  const [coordinatePreset, setCoordinatePreset] =
    useState<CoordinateMode>("normalized");
  const [colorPreset, setColorPreset] = useState<ColorMode>("rgb-gradient");
  const [timePreset, setTimePreset] = useState<TimeMode>("time-play");
  const [transformPreset, setTransformPreset] =
    useState<TransformMode>("transform-translate");
  const [challengePreset, setChallengePreset] =
    useState<ChallengeMode>("challenge-final");
  const [restartToken, setRestartToken] = useState(0);
  const [showCompletion, setShowCompletion] = useState(false);
  const {
    completeLesson: persistLessonCompletion,
    hasCompletedLesson,
    isHydrated,
    progressPercent,
    uncompleteLesson,
  } = useProgress();
  const isComplete = hasCompletedLesson(lessonId);
  const activeMode: ShaderPreviewMode = isChallengeLesson
    ? challengePreset
    : isTransformLesson
    ? transformPreset
    : isTimeLesson
    ? timePreset
    : isColorLesson
      ? colorPreset
      : coordinatePreset;
  const activeColorPreset = colorPresetOptions.find((preset) => preset.mode === colorPreset)!;
  const activeTimePreset = timePresetOptions.find((preset) => preset.mode === timePreset)!;
  const activeTransformPreset = transformPresetOptions.find(
    (preset) => preset.mode === transformPreset,
  )!;
  const activeChallengePreset = challengePresetOptions.find(
    (preset) => preset.mode === challengePreset,
  )!;
  const codeLines = isChallengeLesson
    ? challengeCodeLines[challengePreset]
    : isTransformLesson
    ? transformCodeLines[transformPreset]
    : isTimeLesson
    ? timeCodeLines[timePreset]
    : isColorLesson
      ? colorCodeLines[colorPreset]
      : codeLinesByMode[coordinatePreset];
  const nextLesson = getNextModuleOneLesson(lessonId);
  const nextImplementedLesson =
    nextLesson?.id === COLORS_FRAGMENT_OUTPUT_LESSON_ID ||
    nextLesson?.id === UNIFORMS_TIME_LESSON_ID ||
    nextLesson?.id === TRANSFORMING_UVS_LESSON_ID ||
    nextLesson?.id === FOUNDATION_CHALLENGE_LESSON_ID
      ? nextLesson
      : undefined;
  const lessonSections = isChallengeLesson
    ? [
        {
          title: "Build from independent layers",
          body: "Start with a moving grid, then create rings and an orbiting point as separate masks. Small, testable layers make a complex shader easier to reason about than one long expression.",
        },
        {
          title: "Reuse one coordinate foundation",
          body: "Normalize, center, and correct aspect ratio once. Every layer then agrees about the origin and distance, so circles stay round and the composition behaves consistently across screens.",
        },
        {
          title: "Compose masks with intention",
          body: "Use mix to assign each mask a palette role, then combine the layers in a deliberate order. Your checkpoint: identify the coordinate, color, time, and transform idea responsible for every visible part.",
        },
      ]
    : isTransformLesson
    ? [
        {
          title: "Move the coordinate system",
          body: "A shader has no movable object to transform. Instead, subtract an offset from the coordinates before evaluating the shape. Moving the coordinate system left makes the rendered shape appear to move right.",
        },
        {
          title: "Scale and rotate around the origin",
          body: "Multiplying coordinates changes how quickly distance grows, so larger coordinate values make a shape appear smaller. Rotation matrices turn coordinates around the origin, which is why centering UVs first matters.",
        },
        {
          title: "Repeat space with fract",
          body: "fract keeps only the fractional part of each coordinate. Scale first and fract folds the plane into repeating cells—one shape function can then draw an entire pattern.",
        },
      ]
    : isTimeLesson
    ? [
        {
          title: "Uniforms connect host and shader",
          body: "A uniform is a read-only value supplied by the app to every fragment invocation. Resolution, pointer position, and elapsed time are common uniforms because they describe shared frame state.",
        },
        {
          title: "Animate with elapsed time",
          body: "u_time usually stores seconds since the animation started. Feeding it into sin creates smooth repeating motion without counting frames or depending on a particular refresh rate.",
        },
        {
          title: "Control speed with multiplication",
          body: "Multiply time before using it: 0.5 runs at half speed and 2.0 runs twice as fast. The animation remains frame-rate independent because its position comes from elapsed time, not frame count.",
        },
      ]
    : isColorLesson
    ? [
        {
          title: "Think in channels",
          body: "A color is data. Red, green, and blue are three independent values, usually between 0.0 and 1.0. Changing one channel changes one ingredient of the final pixel.",
        },
        {
          title: "Turn coordinates into color",
          body: "Feeding uv.x into red and uv.y into green makes position visible. This is a useful debugging technique: gradients reveal whether your coordinates point in the direction and range you expect.",
        },
        {
          title: "Interpolate with mix",
          body: "mix(a, b, t) blends from color a to color b. At t = 0 you get a, at t = 1 you get b, and every value between creates a smooth transition.",
        },
      ]
    : [
        {
          title: "Start with the current fragment",
          body: "gl_FragCoord.xy contains the current pixel position in framebuffer pixels. Its values depend on the viewport, so a 1080-pixel-wide screen produces very different numbers from a 390-pixel-wide phone.",
        },
        {
          title: "Normalize once, use everywhere",
          body: "Divide the fragment coordinate by resolution.xy to convert both axes into a portable 0-to-1 range. This normalized vector is conventionally named uv or st.",
        },
        {
          title: "Choose coordinates for the job",
          body: "Pixel space is useful for exact sizes. Centered space makes symmetry natural. Aspect-aware space keeps distance-based shapes circular instead of stretching with the screen.",
        },
      ];

  const completeLesson = async () => {
    try {
      await persistLessonCompletion(lessonId);
      setShowCompletion(true);
    } catch {
      Alert.alert(
        "Progress not saved",
        "Shadercraft could not save this lesson. Please try again.",
      );
    }
  };

  const confirmUndoCompletion = () => {
    Alert.alert(
      "Mark lesson incomplete?",
      "This lesson will be removed from your completed progress. Later lessons stay saved, but the learning path will begin here again.",
      [
        { text: "Keep completed", style: "cancel" },
        {
          text: "Mark incomplete",
          style: "destructive",
          onPress: () => {
            void uncompleteLesson(lessonId).catch(() => {
              Alert.alert(
                "Progress not saved",
                "Shadercraft could not update this lesson. Please try again.",
              );
            });
          },
        },
      ],
    );
  };

  return (
    <>
      <SafeAreaView edges={["top", "bottom"]} style={styles.safeArea}>
        <View style={styles.appFrame}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back to home"
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <AppIcon
              color={Colors.text}
              fallback="‹"
              name={{ android: "arrow_back", ios: "chevron.left", web: "arrow_back" }}
              size={22}
            />
          </Pressable>

          <View style={styles.headerCopy}>
            <Text style={styles.moduleLabel}>Module 01</Text>
            <Text style={styles.headerTitle}>{lesson.shortTitle}</Text>
          </View>

          <Text style={styles.stepLabel}>{lessonIndex + 1} of {MODULE_ONE_LESSONS.length}</Text>
        </View>

        <View style={styles.lessonProgressTrack}>
          <View
            style={[
              styles.lessonProgressFill,
              { width: `${((lessonIndex + 1) / MODULE_ONE_LESSONS.length) * 100}%` },
            ]}
          />
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.intro}>
            <Text style={styles.eyebrow}>Concept</Text>
            <Text style={styles.title}>{lesson.title}</Text>
            <Text style={styles.lede}>
              {isChallengeLesson
                ? "Combine coordinates, color, time, and transforms into one layered composition. Isolate each ingredient, then study how they work together."
                : isTransformLesson
                ? "Transforming UVs lets you position, resize, rotate, and repeat a shape without changing the shape function itself."
                : isTimeLesson
                ? "Uniforms let the app send shared values into every fragment. Use elapsed time to create smooth, frame-rate-independent motion."
                : isColorLesson
                ? "A fragment shader returns one color for every pixel. Learn how RGB channels, alpha, and color mixing turn numbers into an image."
                : "Fragment shaders run once per pixel. Before drawing shapes, turn each pixel position into a predictable coordinate you can reason about."}
            </Text>
          </View>

          <View style={styles.workspace}>
            <View style={styles.workspaceHeader}>
              <View>
                <Text style={styles.workspaceEyebrow}>Live workspace</Text>
                <Text style={styles.workspaceTitle}>Preview and source</Text>
              </View>
              <View style={styles.liveBadge}>
                <View style={styles.liveDot} />
                <Text style={styles.liveLabel}>
                  {isTimeLesson && timePreset === "time-static" ? "Paused" : "Running"}
                </Text>
              </View>
            </View>

            <View style={styles.previewCard}>
              <LiveShaderPreview mode={activeMode} restartToken={restartToken} />
              <View style={styles.previewFooter}>
                <View>
                  <Text style={styles.previewLabel}>
                    {isChallengeLesson
                      ? "Foundation composition"
                      : isTransformLesson
                      ? "Transformed shape"
                      : isTimeLesson
                        ? "Time animation"
                        : isColorLesson
                          ? "Fragment color"
                          : "UV preview"}
                  </Text>
                  <Text style={styles.previewValue}>
                    {isChallengeLesson
                      ? `${activeChallengePreset.label} · ${activeChallengePreset.value}`
                      : isTransformLesson
                      ? `${activeTransformPreset.label} · ${activeTransformPreset.value}`
                      : isTimeLesson
                      ? `${activeTimePreset.label} · ${activeTimePreset.value}`
                      : isColorLesson
                      ? `${activeColorPreset.label} · ${activeColorPreset.value}`
                      : coordinatePreset === "normalized"
                        ? "0.0 → 1.0 · screen space"
                        : coordinatePreset === "centered"
                          ? "−1.0 → 1.0 · centered"
                          : coordinatePreset === "pixel-space"
                            ? "0 → resolution · pixel coordinates"
                            : "−aspect → aspect · corrected"}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.tryItCard}>
              <View style={styles.tryItHeading}>
                <Text style={styles.tryItTitle}>Try it</Text>
                <Text style={styles.tryItHint}>
                  {isChallengeLesson
                    ? "Inspect one layer at a time"
                    : isTransformLesson
                    ? "Transform the space before drawing"
                    : isTimeLesson
                    ? "Change how time flows"
                    : isColorLesson
                      ? "Change the color expression"
                      : "Change the coordinate range"}
                </Text>
              </View>
              <View accessibilityRole="radiogroup" style={styles.presetControl}>
                {isChallengeLesson && challengePresetOptions.map((preset) => {
                  const selected = challengePreset === preset.mode;

                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={preset.mode}
                      onPress={() => setChallengePreset(preset.mode)}
                      style={({ pressed }) => [
                        styles.preset,
                        selected && styles.selectedPreset,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.presetLabel, selected && styles.selectedPresetLabel]}>
                        {preset.label}
                      </Text>
                      <Text style={[styles.presetValue, selected && styles.selectedPresetValue]}>
                        {preset.value}
                      </Text>
                    </Pressable>
                  );
                })}
                {!isChallengeLesson && isTransformLesson && transformPresetOptions.map((preset) => {
                  const selected = transformPreset === preset.mode;

                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={preset.mode}
                      onPress={() => setTransformPreset(preset.mode)}
                      style={({ pressed }) => [
                        styles.preset,
                        selected && styles.selectedPreset,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.presetLabel, selected && styles.selectedPresetLabel]}>
                        {preset.label}
                      </Text>
                      <Text style={[styles.presetValue, selected && styles.selectedPresetValue]}>
                        {preset.value}
                      </Text>
                    </Pressable>
                  );
                })}
                {!isChallengeLesson && !isTransformLesson && isTimeLesson && timePresetOptions.map((preset) => {
                  const selected = timePreset === preset.mode;

                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={preset.mode}
                      onPress={() => setTimePreset(preset.mode)}
                      style={({ pressed }) => [
                        styles.preset,
                        selected && styles.selectedPreset,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.presetLabel, selected && styles.selectedPresetLabel]}>
                        {preset.label}
                      </Text>
                      <Text style={[styles.presetValue, selected && styles.selectedPresetValue]}>
                        {preset.value}
                      </Text>
                    </Pressable>
                  );
                })}
                {!isChallengeLesson && !isTransformLesson && !isTimeLesson && isColorLesson && colorPresetOptions.map((preset) => {
                  const selected = colorPreset === preset.mode;

                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={preset.mode}
                      onPress={() => setColorPreset(preset.mode)}
                      style={({ pressed }) => [
                        styles.preset,
                        selected && styles.selectedPreset,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.presetLabel, selected && styles.selectedPresetLabel]}>
                        {preset.label}
                      </Text>
                      <Text style={[styles.presetValue, selected && styles.selectedPresetValue]}>
                        {preset.value}
                      </Text>
                    </Pressable>
                  );
                })}
                {!isChallengeLesson && !isTransformLesson && !isTimeLesson && !isColorLesson && coordinatePresetOptions.map((preset) => {
                  const selected = coordinatePreset === preset.mode;

                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={preset.mode}
                      onPress={() => setCoordinatePreset(preset.mode)}
                      style={({ pressed }) => [
                        styles.preset,
                        selected && styles.selectedPreset,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[styles.presetLabel, selected && styles.selectedPresetLabel]}>
                        {preset.label}
                      </Text>
                      <Text style={[styles.presetValue, selected && styles.selectedPresetValue]}>
                        {preset.value}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {isTimeLesson && (
                <Pressable
                  accessibilityLabel="Restart animation timeline"
                  accessibilityRole="button"
                  onPress={() => setRestartToken((token) => token + 1)}
                  style={({ pressed }) => [styles.restartButton, pressed && styles.pressed]}
                >
                  <AppIcon
                    color={Colors.accent}
                    fallback="↻"
                    name={{ android: "refresh", ios: "arrow.counterclockwise", web: "refresh" }}
                    size={17}
                  />
                  <Text style={styles.restartLabel}>Restart timeline</Text>
                </Pressable>
              )}
            </View>

            <View style={styles.codeCard}>
              <View style={styles.codeHeader}>
                <Text style={styles.codeFilename}>
                  {isChallengeLesson
                    ? challengeFilenames[challengePreset]
                    : isTransformLesson
                    ? transformFilenames[transformPreset]
                    : isTimeLesson
                    ? timeFilenames[timePreset]
                    : isColorLesson
                    ? colorFilenames[colorPreset]
                    : coordinatePreset === "normalized"
                      ? "normalized_uv.glsl"
                      : coordinatePreset === "centered"
                        ? "centered_uv.glsl"
                        : coordinatePreset === "pixel-space"
                          ? "pixel_space.glsl"
                          : "aspect_aware.glsl"}
                </Text>
                <Text style={styles.codeLanguage}>LIVE GLSL</Text>
              </View>
              <View style={styles.codeBody}>
                {codeLines.map((line) => (
                  <View key={line.number} style={styles.codeLine}>
                    <Text style={styles.lineNumber}>{line.number}</Text>
                    <Text style={[styles.codeText, line.accent && styles.codeAccent]}>
                      {line.code}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.conceptHeader}>
            <Text style={styles.conceptEyebrow}>Concept breakdown</Text>
            <Text style={styles.conceptTitle}>
              {isChallengeLesson
                ? "Assemble the foundation"
                : isTransformLesson
                ? "Move the space, not the shape"
                : isTimeLesson
                ? "Uniforms in motion"
                : isColorLesson
                  ? "From numbers to pixels"
                  : "Mastering the canvas"}
            </Text>
            <Text style={styles.conceptLede}>
              {isChallengeLesson
                ? "Deconstruct a finished shader into coordinate, mask, motion, and color layers."
                : isTransformLesson
                ? "Apply translation, scale, rotation, and repetition to UVs before evaluating a reusable shape."
                : isTimeLesson
                ? "Connect app state to GLSL and create animation from elapsed seconds."
                : isColorLesson
                ? "Learn how fragment output combines channels, opacity, and interpolation into visible color."
                : "Understand how raw pixels become stable coordinates you can reuse across every screen size."}
            </Text>
          </View>

          {lessonSections.map((section, index) => (
            <View key={section.title} style={styles.section}>
              <Text style={styles.sectionNumber}>
                {String(index + 1).padStart(2, "0")}
              </Text>
              <View style={styles.sectionCopy}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.bodyCopy}>{section.body}</Text>
              </View>
            </View>
          ))}

          <View style={styles.takeaway}>
            <AppIcon
              color={Colors.accent}
              fallback="✦"
              name={{ android: "lightbulb", ios: "lightbulb.fill", web: "lightbulb" }}
              size={22}
            />
            <View style={styles.takeawayCopy}>
              <Text style={styles.takeawayTitle}>Remember</Text>
              <Text style={styles.takeawayBody}>
                {isChallengeLesson
                  ? "Complex shaders are compositions of simple masks. Build and inspect each layer independently, share one aspect-correct coordinate system, then combine colors in a deliberate order."
                  : isTransformLesson
                  ? "Transform coordinates before drawing. Center them before scaling or rotation, remember that coordinate transforms feel inverse to object transforms, and use fract to fold space into repeatable cells."
                  : isTimeLesson
                  ? "Uniforms are shared inputs, not per-pixel variables. Derive motion from elapsed seconds, then multiply time to control speed without tying animation to frame rate."
                  : isColorLesson
                  ? "vec3 stores red, green, and blue. vec4 adds alpha. Use coordinate-driven gradients to inspect your UVs, then mix colors to build intentional palettes."
                  : "The center of normalized UV space is always (0.5, 0.5). After centering it becomes (0.0, 0.0). Correct the x-axis before measuring distance so circles remain circular."}
              </Text>
            </View>
          </View>

          <View style={styles.readyCard}>
            <Text style={styles.readyEyebrow}>Checkpoint</Text>
            <Text style={styles.readyTitle}>Ready to experiment?</Text>
            <Text style={styles.readyBody}>
              Switch between every preset and connect the code changes to what you see in
              the live preview. You can review this lesson again after completing it.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.actionBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isComplete ? "Lesson completed. Tap to mark incomplete" : undefined
            }
            accessibilityState={{ disabled: !isHydrated }}
            disabled={!isHydrated}
            onPress={isComplete ? confirmUndoCompletion : completeLesson}
            style={({ pressed }) => [
              styles.completeButton,
              isComplete && styles.completedButton,
              pressed && styles.pressed,
            ]}
          >
            {isComplete && (
              <AppIcon
                color={Colors.accent}
                fallback="✓"
                name={{ android: "check", ios: "checkmark", web: "check" }}
                size={20}
              />
            )}
            <Text style={[styles.completeLabel, isComplete && styles.completedLabel]}>
              {!isHydrated
                ? "Loading progress…"
                : isComplete
                  ? "Completed · Tap to undo"
                  : "Mark lesson complete"}
            </Text>
          </Pressable>
        </View>
        </View>
      </SafeAreaView>

      <LessonCompletionSheet
        lessonTitle={lesson.title}
        nextActionLabel={nextImplementedLesson ? "Continue to next lesson" : "View course"}
        onClose={() => setShowCompletion(false)}
        onNext={() => {
          setShowCompletion(false);
          if (nextImplementedLesson) {
            router.replace({ pathname: "/lesson", params: { lessonId: nextImplementedLesson.id } });
          } else {
            router.push("/course");
          }
        }}
        progressPercent={progressPercent}
        visible={showCompletion}
      />
    </>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  appFrame: {
    flex: 1,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: Colors.background,
  },
  header: {
    minHeight: 64,
    paddingHorizontal: Spacing.xl,
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 44,
    height: 44,
    marginLeft: -10,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCopy: {
    flex: 1,
    marginLeft: Spacing.xs,
  },
  moduleLabel: {
    color: Colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  headerTitle: {
    marginTop: 2,
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  stepLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
  },
  lessonProgressTrack: {
    height: 2,
    backgroundColor: Colors.border,
  },
  lessonProgressFill: {
    width: "17%",
    height: "100%",
    backgroundColor: Colors.accent,
  },
  content: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxxl,
  },
  intro: {
    marginBottom: Spacing.xxl,
  },
  workspace: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#0F0F11",
    gap: Spacing.md,
  },
  workspaceHeader: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  workspaceEyebrow: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  workspaceTitle: {
    marginTop: 3,
    color: Colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  eyebrow: {
    marginBottom: Spacing.sm,
    color: Colors.accent,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.9,
    textTransform: "uppercase",
  },
  title: {
    maxWidth: 360,
    color: Colors.text,
    fontSize: 30,
    fontWeight: "800",
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  lede: {
    marginTop: Spacing.md,
    color: Colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  previewCard: {
    overflow: "hidden",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  previewFooter: {
    minHeight: 64,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  previewLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  previewValue: {
    marginTop: 3,
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 11,
  },
  liveBadge: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: Radius.round,
    backgroundColor: "rgba(199,244,100,0.1)",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.round,
    backgroundColor: Colors.accent,
  },
  liveLabel: {
    color: Colors.accent,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  section: {
    marginTop: Spacing.xxl,
    flexDirection: "row",
    gap: Spacing.lg,
  },
  conceptHeader: {
    marginTop: 44,
    paddingTop: Spacing.xxl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  conceptEyebrow: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  conceptTitle: {
    marginTop: Spacing.sm,
    color: Colors.text,
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  conceptLede: {
    marginTop: Spacing.sm,
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  sectionNumber: {
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 12,
  },
  sectionCopy: {
    flex: 1,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  bodyCopy: {
    marginTop: Spacing.sm,
    color: Colors.textMuted,
    fontSize: 15,
    lineHeight: 23,
  },
  codeCard: {
    overflow: "hidden",
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: "#0C0F14",
  },
  codeHeader: {
    minHeight: 44,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  codeFilename: {
    color: Colors.textMuted,
    fontFamily: "monospace",
    fontSize: 11,
  },
  codeLanguage: {
    color: Colors.textSubtle,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  codeBody: {
    paddingVertical: Spacing.md,
  },
  codeLine: {
    minHeight: 22,
    paddingRight: Spacing.md,
    flexDirection: "row",
    alignItems: "center",
  },
  lineNumber: {
    width: 36,
    color: "#424B58",
    fontFamily: "monospace",
    fontSize: 11,
    textAlign: "right",
  },
  codeText: {
    flex: 1,
    marginLeft: Spacing.md,
    color: "#C9D1DA",
    fontFamily: "monospace",
    fontSize: 11,
  },
  codeAccent: {
    color: Colors.accent,
  },
  tryItCard: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  tryItHeading: {
    marginBottom: Spacing.md,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  tryItTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  tryItHint: {
    color: Colors.textSubtle,
    fontSize: 11,
  },
  presetControl: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  preset: {
    flex: 1,
    flexBasis: "46%",
    minHeight: 64,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    justifyContent: "center",
  },
  selectedPreset: {
    borderColor: Colors.accent,
    backgroundColor: "rgba(199,244,100,0.08)",
  },
  presetLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  selectedPresetLabel: {
    color: Colors.text,
  },
  presetValue: {
    marginTop: 4,
    color: Colors.textSubtle,
    fontFamily: "monospace",
    fontSize: 11,
  },
  selectedPresetValue: {
    color: Colors.accent,
  },
  restartButton: {
    marginTop: Spacing.md,
    minHeight: 42,
    paddingHorizontal: Spacing.md,
    alignSelf: "flex-start",
    borderRadius: Radius.round,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  restartLabel: {
    color: Colors.accent,
    fontSize: 12,
    fontWeight: "800",
  },
  takeaway: {
    marginTop: Spacing.xxl,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: "rgba(199,244,100,0.08)",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
  },
  takeawayCopy: {
    flex: 1,
  },
  takeawayTitle: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "800",
  },
  takeawayBody: {
    marginTop: 5,
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
  },
  readyCard: {
    marginTop: Spacing.xxxl,
    padding: Spacing.xl,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: "center",
  },
  readyEyebrow: {
    color: Colors.accent,
    fontFamily: "monospace",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  readyTitle: {
    marginTop: Spacing.sm,
    color: Colors.text,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  readyBody: {
    marginTop: Spacing.sm,
    color: Colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  inlineCode: {
    color: Colors.text,
    fontFamily: "monospace",
  },
  actionBar: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  completeButton: {
    minHeight: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  completedButton: {
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: "rgba(199,244,100,0.08)",
  },
  completeLabel: {
    color: Colors.background,
    fontSize: 15,
    fontWeight: "800",
  },
  completedLabel: {
    color: Colors.accent,
  },
  pressed: {
    opacity: 0.68,
  },
});
