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

function normalizeParameter(value: unknown): ShaderParameterDefinition {
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
  const parameters = value.parameters.map((parameter) => {
    const normalized = normalizeParameter(parameter);
    if (keys.has(normalized.key)) {
      throw new Error(`duplicate parameter key: ${normalized.key}`);
    }
    keys.add(normalized.key);
    return normalized;
  });

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
    !RESERVED_SHADER_PARAMETER_KEYS.has(key)
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
