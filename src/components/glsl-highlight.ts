export type GlslTokenKind =
  | "comment"
  | "directive"
  | "keyword"
  | "number"
  | "plain"
  | "string"
  | "type";

export type GlslToken = {
  kind: GlslTokenKind;
  text: string;
};

const TYPES = new Set([
  "bool",
  "bvec2",
  "bvec3",
  "bvec4",
  "float",
  "int",
  "ivec2",
  "ivec3",
  "ivec4",
  "mat2",
  "mat3",
  "mat4",
  "sampler2D",
  "samplerCube",
  "vec2",
  "vec3",
  "vec4",
]);

const KEYWORDS = new Set([
  "attribute",
  "break",
  "const",
  "continue",
  "discard",
  "do",
  "else",
  "for",
  "if",
  "in",
  "inout",
  "out",
  "precision",
  "return",
  "uniform",
  "varying",
  "void",
  "while",
]);

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/;
const NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[fFuU]?/;

export function tokenizeGlsl(source: string): GlslToken[] {
  const result: GlslToken[] = [];
  let index = 0;
  let lineStart = true;

  const push = (kind: GlslTokenKind, text: string) => {
    if (text.length > 0) result.push({ kind, text });
  };

  while (index < source.length) {
    const rest = source.slice(index);

    if (lineStart && /^[ \t]*#/.test(rest)) {
      const end = source.indexOf("\n", index);
      const next = end === -1 ? source.length : end;
      push("directive", source.slice(index, next));
      index = next;
      lineStart = false;
      continue;
    }

    if (rest.startsWith("//")) {
      const end = source.indexOf("\n", index);
      const next = end === -1 ? source.length : end;
      push("comment", source.slice(index, next));
      index = next;
      lineStart = false;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = source.indexOf("*/", index + 2);
      const next = end === -1 ? source.length : end + 2;
      const text = source.slice(index, next);
      push("comment", text);
      lineStart = text.includes("\n") ? text.endsWith("\n") : false;
      index = next;
      continue;
    }

    const first = source[index];
    if (first === '"' || first === "'") {
      let end = index + 1;
      while (end < source.length) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }
        if (source[end] === first) {
          end += 1;
          break;
        }
        end += 1;
      }
      push("string", source.slice(index, end));
      index = end;
      lineStart = false;
      continue;
    }

    const number = rest.match(NUMBER);
    if (number) {
      push("number", number[0]);
      index += number[0].length;
      lineStart = false;
      continue;
    }

    const identifier = rest.match(IDENTIFIER);
    if (identifier) {
      const text = identifier[0];
      push(TYPES.has(text) ? "type" : KEYWORDS.has(text) ? "keyword" : "plain", text);
      index += text.length;
      lineStart = false;
      continue;
    }

    push("plain", first);
    index += 1;
    lineStart = first === "\n";
  }

  return result;
}
