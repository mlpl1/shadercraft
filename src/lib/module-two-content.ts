import type { ShaderPreviewMode } from "../components/live-shader-preview";
import type { ModuleTwoLessonId } from "./curriculum";

export type ModuleTwoPreset = {
  code: string[];
  filename: string;
  highlightedLines: number[];
  label: string;
  mode: ShaderPreviewMode;
  value: string;
};

export type ModuleTwoLessonContent = {
  conceptLede: string;
  conceptTitle: string;
  intro: string;
  presets: ModuleTwoPreset[];
  sections: { body: string; title: string }[];
  takeaway: string;
  tryHint: string;
};

export const MODULE_TWO_CONTENT: Record<ModuleTwoLessonId, ModuleTwoLessonContent> = {
  "step-and-smoothstep": {
    intro:
      "Threshold functions turn continuous measurements into visible boundaries. Compare a hard decision with a controllable, anti-aliased transition.",
    conceptTitle: "Turn distance into an edge",
    conceptLede: "A shape appears when a distance field crosses a threshold.",
    tryHint: "Compare four ways to reveal a distance",
    presets: [
      {
        label: "Hard step",
        mode: "edge-hard",
        value: "step(edge, x)",
        filename: "hard_threshold.glsl",
        highlightedLines: [2],
        code: [
          "float d = length(p) - 0.42;",
          "float mask = 1.0 - step(0.0, d);",
          "fragColor = vec4(vec3(mask), 1.0);",
        ],
      },
      {
        label: "Smooth edge",
        mode: "edge-smooth",
        value: "smoothstep(a, b, x)",
        filename: "smooth_edge.glsl",
        highlightedLines: [2],
        code: [
          "float d = length(p) - 0.42;",
          "float mask = 1.0 - smoothstep(-0.025, 0.025, d);",
          "fragColor = vec4(cyan * mask, 1.0);",
        ],
      },
      {
        label: "Outline",
        mode: "edge-outline",
        value: "abs(distance)",
        filename: "distance_outline.glsl",
        highlightedLines: [1],
        code: [
          "float d = abs(length(p) - 0.42);",
          "float line = 1.0 - smoothstep(0.018, 0.035, d);",
          "fragColor = vec4(lime * line, 1.0);",
        ],
      },
      {
        label: "Animated",
        mode: "edge-animated",
        value: "radius + sin(time)",
        filename: "animated_threshold.glsl",
        highlightedLines: [1],
        code: [
          "float radius = 0.34 + 0.08 * sin(u_time * 2.0);",
          "float d = length(p) - radius;",
          "float mask = 1.0 - smoothstep(-0.02, 0.02, d);",
        ],
      },
    ],
    sections: [
      {
        title: "Measure before deciding",
        body: "A distance field stores how far each fragment is from a boundary. Negative values are inside, zero is exactly on the edge, and positive values are outside. Keeping this measurement continuous makes the same field reusable.",
      },
      {
        title: "step makes a binary choice",
        body: "step(edge, value) returns 0 below the threshold and 1 at or above it. It is ideal for logical masks, but a one-pixel transition can shimmer or look jagged when the shape moves.",
      },
      {
        title: "smoothstep gives the edge width",
        body: "smoothstep blends between two thresholds with a smooth curve. Place those thresholds on either side of zero to create a controlled anti-aliased boundary without changing the underlying shape.",
      },
    ],
    takeaway:
      "Keep distance and visibility separate: first calculate d, then convert d into a fill, outline, or soft edge. One distance field can support many visual treatments.",
  },
  "circles-and-boxes": {
    intro:
      "Signed distance functions describe reusable geometric primitives. Build circles, boxes, and rounded rectangles from compact mathematical measurements.",
    conceptTitle: "Primitive shapes from distance",
    conceptLede: "Small functions turn coordinates into scalable, composable geometry.",
    tryHint: "Swap the primitive while keeping the edge code",
    presets: [
      {
        label: "Circle",
        mode: "primitive-circle",
        value: "length(p) - r",
        filename: "circle_sdf.glsl",
        highlightedLines: [2],
        code: [
          "float circleSdf(vec2 p, float r) {",
          "  return length(p) - r;",
          "}",
          "float mask = 1.0 - smoothstep(-0.018, 0.018, circleSdf(p, 0.4));",
        ],
      },
      {
        label: "Box",
        mode: "primitive-box",
        value: "sdBox(p, size)",
        filename: "box_sdf.glsl",
        highlightedLines: [2],
        code: [
          "vec2 q = abs(p) - vec2(0.38, 0.28);",
          "float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);",
          "float mask = 1.0 - smoothstep(-0.018, 0.018, d);",
        ],
      },
      {
        label: "Rounded box",
        mode: "primitive-rounded-box",
        value: "sdBox - radius",
        filename: "rounded_box.glsl",
        highlightedLines: [2, 3],
        code: [
          "float radius = 0.10;",
          "float d = sdBox(p, vec2(0.42, 0.30) - radius);",
          "d -= radius;",
          "float mask = 1.0 - smoothstep(-0.018, 0.018, d);",
        ],
      },
      {
        label: "Combined",
        mode: "primitive-combined",
        value: "two independent masks",
        filename: "primitive_layers.glsl",
        highlightedLines: [1, 2],
        code: [
          "float circle = fill(circleSdf(p + vec2(0.2, 0.0), 0.3));",
          "float box = fill(boxSdf(p - vec2(0.2, 0.0), vec2(0.28)));",
          "vec3 color = cyan * circle + lime * box;",
        ],
      },
    ],
    sections: [
      {
        title: "Circles come from length",
        body: "length(p) measures radial distance from the origin. Subtracting a radius moves the zero boundary outward, producing a signed field that is negative inside the circle.",
      },
      {
        title: "Boxes measure each axis",
        body: "A box begins with abs(p), which mirrors all quadrants into one. Subtract the half-size, measure positive overflow outside the corners, and preserve the largest negative component inside.",
      },
      {
        title: "Radius modifies the field",
        body: "Evaluate a slightly smaller box and subtract a radius from its distance. The zero boundary expands evenly around the corners, turning the sharp box into a rounded rectangle.",
      },
    ],
    takeaway:
      "Write primitives as functions that return signed distance, not color. That keeps size, position, edge treatment, and later boolean operations independent.",
  },
  "boolean-shape-operations": {
    intro:
      "Signed distances can be combined like solid geometry. Use min and max to unite, intersect, subtract, and compare shapes without branches.",
    conceptTitle: "Sculpt with min and max",
    conceptLede: "Boolean-looking operations emerge directly from distance fields.",
    tryHint: "Apply four operations to the same two fields",
    presets: [
      {
        label: "Union",
        mode: "boolean-union",
        value: "min(a, b)",
        filename: "shape_union.glsl",
        highlightedLines: [3],
        code: ["float a = circleSdf(p + offset, 0.34);", "float b = boxSdf(p - offset, size);", "float d = min(a, b);", "color = lime * fill(d);"],
      },
      {
        label: "Intersection",
        mode: "boolean-intersection",
        value: "max(a, b)",
        filename: "shape_intersection.glsl",
        highlightedLines: [3],
        code: ["float a = circleSdf(p + offset, 0.34);", "float b = boxSdf(p - offset, size);", "float d = max(a, b);", "color = lime * fill(d);"],
      },
      {
        label: "Subtract",
        mode: "boolean-subtraction",
        value: "max(a, -b)",
        filename: "shape_subtraction.glsl",
        highlightedLines: [3],
        code: ["float a = circleSdf(p + offset, 0.34);", "float b = boxSdf(p - offset, size);", "float d = max(a, -b);", "color = lime * fill(d);"],
      },
      {
        label: "Exclusive",
        mode: "boolean-xor",
        value: "inside one only",
        filename: "shape_xor.glsl",
        highlightedLines: [3],
        code: ["float insideOne = min(a, b);", "float insideBoth = max(a, b);", "float d = max(insideOne, -insideBoth);", "color = violet * fill(d);"],
      },
    ],
    sections: [
      {
        title: "Union keeps the nearer field",
        body: "At every fragment, min(a, b) selects whichever shape has the smaller signed distance. If either field is negative, the union is inside, so both silhouettes become one field.",
      },
      {
        title: "Intersection keeps shared interior",
        body: "max(a, b) is negative only when both inputs are negative. It therefore preserves the overlap and discards areas belonging to just one shape.",
      },
      {
        title: "Negation flips inside and outside",
        body: "Negating b turns its interior positive. max(a, -b) retains shape a except where b cuts into it. More elaborate expressions produce exclusive regions and reusable cutouts.",
      },
    ],
    takeaway:
      "For signed fields: min unites, max intersects, and negating a field swaps inside with outside. Combine distances first and apply smoothstep only once at the final boundary.",
  },
  "shape-repetition-composition": {
    intro:
      "Repeat coordinate space before evaluating a primitive, then layer multiple masks and transformations into patterns that remain compact and controllable.",
    conceptTitle: "One shape, many instances",
    conceptLede: "Coordinate folding replaces duplicated drawing code.",
    tryHint: "Build complexity from a single repeated cell",
    presets: [
      {
        label: "Grid",
        mode: "repeat-grid",
        value: "fract(p × 4)",
        filename: "repeat_grid.glsl",
        highlightedLines: [1],
        code: ["vec2 cell = fract((p * 0.5 + 0.5) * 4.0) - 0.5;", "cell.x *= resolution.x / resolution.y;", "float d = length(cell) - 0.16;", "color = lime * fill(d);"],
      },
      {
        label: "Rotate cells",
        mode: "repeat-rotate",
        value: "rotation × cell",
        filename: "rotated_cells.glsl",
        highlightedLines: [3],
        code: ["vec2 cell = repeat(p, 4.0);", "float angle = (cellId.x + cellId.y) * 0.35;", "cell = rotate(angle) * cell;", "color = lime * fill(boxSdf(cell, vec2(0.13)));"],
      },
      {
        label: "Layer masks",
        mode: "repeat-layer",
        value: "circles + boxes",
        filename: "layered_pattern.glsl",
        highlightedLines: [3],
        code: ["float circles = fill(circleSdf(cell, 0.16));", "float boxes = fill(boxSdf(rotate(angle) * cell, vec2(0.13)));", "color = cyan * circles * 0.7 + violet * boxes * 0.5;"],
      },
      {
        label: "Animate",
        mode: "repeat-animate",
        value: "angle + u_time",
        filename: "animated_pattern.glsl",
        highlightedLines: [2],
        code: ["vec2 cell = repeat(p, 4.0);", "cell = rotate(cellAngle + u_time) * cell;", "float shape = fill(boxSdf(cell, vec2(0.13)));", "color = lime * shape;"],
      },
    ],
    sections: [
      {
        title: "Fold space into cells",
        body: "Scale normalized coordinates, apply fract, and subtract 0.5. Every fragment is now expressed relative to the center of a repeating cell, so one primitive appears many times.",
      },
      {
        title: "Preserve the cell identity",
        body: "floor before fract gives each cell an integer ID. Use that ID to alternate color, rotation, scale, or timing while still evaluating one shared shape function.",
      },
      {
        title: "Layer masks intentionally",
        body: "Keep repeated circles and boxes as separate masks until color composition. Independent layers are easier to tune and can later become inputs to boolean distance operations.",
      },
    ],
    takeaway:
      "Repeat coordinates, not drawing calls. Keep local cell coordinates and integer cell IDs so geometry stays reusable while variation remains deterministic.",
  },
  "shape-synthesis-challenge": {
    intro:
      "Combine edges, primitives, boolean operations, repetition, and motion into recognizable procedural marks built entirely from distance fields.",
    conceptTitle: "Synthesize a visual system",
    conceptLede: "Complex icons are deliberate compositions of simple fields.",
    tryHint: "Deconstruct four finished procedural marks",
    presets: [
      {
        label: "Badge",
        mode: "synthesis-badge",
        value: "ring + clipped cross",
        filename: "challenge_badge.glsl",
        highlightedLines: [1, 3, 4],
        code: ["float ring = outline(circleSdf(p, 0.52), 0.02);", "float cross = max(verticalBar(p), horizontalBar(p));", "cross *= fill(circleSdf(p, 0.42));", "color = cyan * ring + lime * cross;"],
      },
      {
        label: "Face",
        mode: "synthesis-face",
        value: "rounded box + cutouts",
        filename: "challenge_face.glsl",
        highlightedLines: [1, 2, 3],
        code: ["float head = fill(roundBoxSdf(p, vec2(0.46, 0.36), 0.1));", "float eyes = max(circle(leftEye), circle(rightEye));", "float mouth = outline(boxSdf(p + mouthOffset, mouthSize));", "color = violet * head + lime * max(eyes, mouth);"],
      },
      {
        label: "Flower",
        mode: "synthesis-flower",
        value: "rotated circle union",
        filename: "challenge_flower.glsl",
        highlightedLines: [2, 3],
        code: ["float petals = 0.0;", "for (int i = 0; i < 6; i++) {", "  petals = max(petals, circle(p - petalOffset(i)));", "}", "color = violet * petals + lime * circle(p);"],
      },
      {
        label: "Final mark",
        mode: "synthesis-final",
        value: "animated composition",
        filename: "shape_synthesis_final.glsl",
        highlightedLines: [1, 3, 5],
        code: ["float disc = circleSdf(p, 0.5 * pulse);", "float cut = roundBoxSdf(p, vec2(0.3), 0.08);", "float symbol = max(disc, -cut);", "float frame = outline(circleSdf(p, 0.58), 0.02);", "color = cyan * fill(symbol) + violet * fill(cut) + lime * frame;"],
      },
    ],
    sections: [
      {
        title: "Start from a visual brief",
        body: "Choose a small vocabulary: one outer frame, one dominant filled form, and one contrasting cutout or detail. Assign each element a distance field before thinking about color.",
      },
      {
        title: "Audit every operation",
        body: "Identify where the composition uses a threshold, primitive, union, intersection, subtraction, repetition, or transform. If one expression is hard to explain, isolate it as a named intermediate field.",
      },
      {
        title: "Animate a parameter, not the identity",
        body: "Motion should clarify structure. Pulse a radius, rotate repeated cells, or shift an edge width while keeping the underlying mark recognizable and frame-rate independent.",
      },
    ],
    takeaway:
      "A finished procedural mark is a hierarchy: coordinates feed primitives, primitives combine into one field, the field becomes masks, and masks receive color and motion. Debug the hierarchy one layer at a time.",
  },
};
