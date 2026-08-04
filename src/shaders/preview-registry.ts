export const SHADER_PREVIEW_MODE_VALUES = {
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
  "light-luma": 48,
  "light-contrast": 49,
  "light-threshold": 50,
  "light-exposure": 51,
  "palette-cosine": 52,
  "palette-phase": 53,
  "palette-spatial": 54,
  "palette-animated": 55,
  "lighting-albedo": 56,
  "lighting-diffuse": 57,
  "lighting-rim": 58,
  "lighting-final": 59,
};

export type ShaderPreviewKey = keyof typeof SHADER_PREVIEW_MODE_VALUES;

export function isPreviewKey(value: string): value is ShaderPreviewKey {
  return Object.hasOwn(SHADER_PREVIEW_MODE_VALUES, value);
}

/**
 * The preview parameters this build of the app knows how to act on, with the type each one must be
 * authored as. Content may choose which of these a preset opts into, but authoring a name that is
 * absent here fails validation: a release can widen the supported set only by shipping an app that
 * implements the behavior, never by naming preview behavior the installed app cannot execute.
 */
export const SHADER_PREVIEW_PARAMETER_TYPES = {
  /**
   * Whether the workspace's live badge presents the preview as running or paused. `false` shows
   * "Paused"; this is purely a presentation label and does not gate the preview's render loop, nor
   * is it cross-validated against the shader behind `previewKey`.
   */
  animated: "boolean",
  /** Whether the workspace offers a control that restarts the preview timeline. */
  restartable: "boolean",
} as const;

export type ShaderPreviewParameterName = keyof typeof SHADER_PREVIEW_PARAMETER_TYPES;

export function getPreviewParameterType(
  name: string,
): (typeof SHADER_PREVIEW_PARAMETER_TYPES)[ShaderPreviewParameterName] | undefined {
  return Object.hasOwn(SHADER_PREVIEW_PARAMETER_TYPES, name)
    ? SHADER_PREVIEW_PARAMETER_TYPES[name as ShaderPreviewParameterName]
    : undefined;
}
