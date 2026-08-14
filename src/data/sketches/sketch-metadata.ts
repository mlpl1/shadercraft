export type ShaderParameterDefinition = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  value: number;
};

export type SketchMetadata = {
  version: 1;
  category: string;
  parameters: ShaderParameterDefinition[];
};

export type SketchMetadataParseResult = {
  metadata: SketchMetadata;
  warning: string | null;
};

export const DEFAULT_SKETCH_METADATA: SketchMetadata = {
  version: 1,
  category: "Drafts",
  parameters: [],
};

const INVALID_METADATA_WARNING = "Saved shader parameters were invalid and have been reset.";
const RESERVED_SHADER_PARAMETER_KEYS = new Set([
  "iResolution",
  "iTime",
  "gl_FragColor",
  "gl_FragCoord",
  "main",
  "mainImage",
]);
const GLSL_RESERVED_KEYWORDS = new Set([
  // GLSL ES 1.00 keywords (Khronos spec section 3.7).
  "attribute", "const", "uniform", "varying", "break", "continue", "do", "for", "while",
  "if", "else", "in", "out", "inout", "float", "int", "void", "bool", "true", "false",
  "lowp", "mediump", "highp", "precision", "invariant", "discard", "return",
  "mat2", "mat3", "mat4", "vec2", "vec3", "vec4", "ivec2", "ivec3", "ivec4",
  "bvec2", "bvec3", "bvec4", "sampler2D", "samplerCube", "struct",
  // Reserved for future use by GLSL ES 1.00.
  "asm", "class", "union", "enum", "typedef", "template", "this", "packed",
  "goto", "switch", "default", "inline", "noinline", "volatile", "public", "static",
  "extern", "external", "interface", "flat", "long", "short", "double", "half", "fixed",
  "unsigned", "superp", "input", "output", "hvec2", "hvec3", "hvec4", "dvec2", "dvec3", "dvec4",
  "fvec2", "fvec3", "fvec4", "sampler1D", "sampler3D", "sampler1DShadow", "sampler2DShadow",
  "sampler2DRect", "sampler3DRect", "sampler2DRectShadow", "sizeof", "cast", "namespace", "using",
]);
const GLSL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function freshDefaultSketchMetadata(): SketchMetadata {
  return {
    version: 1,
    category: "Drafts",
    parameters: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeShaderParameterDefinition(value: unknown): ShaderParameterDefinition {
  if (!isRecord(value)) {
    throw new Error("parameter must be an object");
  }

  if (typeof value.key !== "string" || typeof value.label !== "string") {
    throw new Error("parameter key and label must be strings");
  }

  const key = value.key.trim();
  const label = value.label.trim();
  if (!isValidShaderParameterKey(key) || label.length === 0) {
    throw new Error("parameter key or label is invalid");
  }

  const min = requireFiniteNumber(value.min, "min");
  const max = requireFiniteNumber(value.max, "max");
  const step = requireFiniteNumber(value.step, "step");
  const defaultValue = requireFiniteNumber(value.defaultValue, "defaultValue");
  const currentValue = requireFiniteNumber(value.value, "value");
  if (max <= min || step <= 0) {
    throw new Error("parameter range is invalid");
  }

  return {
    key,
    label,
    min,
    max,
    step,
    defaultValue: clamp(defaultValue, min, max),
    value: clamp(currentValue, min, max),
  };
}

function normalizeSketchMetadata(value: unknown): SketchMetadata {
  if (!isRecord(value) || value.version !== 1 || typeof value.category !== "string") {
    throw new Error("metadata shape is invalid");
  }

  const category = value.category.trim();
  if (category.length === 0 || !Array.isArray(value.parameters)) {
    throw new Error("metadata category or parameters are invalid");
  }

  const keys = new Set<string>();
  const parameters: ShaderParameterDefinition[] = [];
  for (let index = 0; index < value.parameters.length; index += 1) {
    if (!(index in value.parameters)) {
      throw new Error("parameter list contains a missing entry");
    }
    const parameter = value.parameters[index];
    const normalized = normalizeShaderParameterDefinition(parameter);
    if (keys.has(normalized.key)) {
      throw new Error(`duplicate parameter key: ${normalized.key}`);
    }
    keys.add(normalized.key);
    parameters.push(normalized);
  }

  return {
    version: 1,
    category,
    parameters,
  };
}

export function isValidShaderParameterKey(key: string): boolean {
  return (
    typeof key === "string" &&
    GLSL_IDENTIFIER_PATTERN.test(key) &&
    !RESERVED_SHADER_PARAMETER_KEYS.has(key) &&
    !GLSL_RESERVED_KEYWORDS.has(key) &&
    !key.startsWith("gl_") &&
    !key.includes("__")
  );
}

export function parseSketchMetadataResult(value: unknown): SketchMetadataParseResult {
  try {
    return {
      metadata: normalizeSketchMetadata(value === undefined ? freshDefaultSketchMetadata() : value),
      warning: null,
    };
  } catch {
    return {
      metadata: freshDefaultSketchMetadata(),
      warning: INVALID_METADATA_WARNING,
    };
  }
}

export function parseSketchMetadata(value: unknown): SketchMetadata {
  return parseSketchMetadataResult(value).metadata;
}

export function serializeSketchMetadata(metadata: SketchMetadata): string {
  return JSON.stringify(normalizeSketchMetadata(metadata));
}
