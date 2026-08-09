// Checks the two rules nothing else enforces: cumulative vocabulary (no lesson may use a function
// that Act 1 has not already introduced, or that an earlier lesson within the same Act 2 module has
// not already introduced — no forward references, per module OR within a module, per lesson) and the
// word floors, reported per-field rather than as a build failure.
// Deleted in Task 6 — this is authoring scaffolding, not shipped tooling.
import { readFileSync, readdirSync } from "node:fs";

const INTRODUCED_BY_MODULE = {
  1: ["length", "sin", "cos"],
  2: ["step", "smoothstep", "mix", "clamp", "pow", "exp"],
  3: ["abs", "min", "max", "fwidth"],
  4: ["dot"],
  5: ["mat2", "atan", "fract", "floor", "mod"],
  6: [],
  7: [],
  8: ["normalize"],
  9: [],
  10: ["reflect"],
  11: [],
};

const INTRODUCED_BY_LESSON = {
  // Module 8
  "camera-and-ray-setup": ["normalize"],
  "a-3d-sphere": [],
  "the-march-loop": ["march"],
  "the-hit-test": [],
  "depth": [],
  // Module 9
  "box-and-torus-sdfs": ["sdBox", "sdTorus"],
  "smooth-minimum": ["smin"],
  "repetition-and-transforms-in-3d": [],
  // Module 10
  "normals-by-gradient": ["normalAt"],
  "diffuse": [],
  "specular": ["reflect"],
  "soft-shadows": [],
  "fog": [],
  // Module 11
  "step-count-and-precision": ["marchCountingSteps", "heat"],
  "the-cost-of-branching": [],
  "knowing-when-to-stop": [],
};

const ALWAYS = ["vec2", "vec3", "vec4", "mat2", "mat3", "float", "int", "bool", "return", "if", "for"];

const wordCount = (value) => value.trim().split(/\s+/).filter(Boolean).length;

const files = readdirSync("content").filter((name) => name.startsWith("module-")).sort();
const allowed = new Set(ALWAYS);
let problems = 0;
const report = (message) => {
  console.log(message);
  problems += 1;
};

for (const file of files) {
  const module = JSON.parse(readFileSync(`content/${file}`, "utf8"));
  for (const name of INTRODUCED_BY_MODULE[module.position] ?? []) allowed.add(name);
  if (module.status !== "published") continue;

  const lessons = [...module.lessons].sort((a, b) => a.position - b.position);
  for (const lesson of lessons) {
    if (wordCount(lesson.intro) < 60) report(`SHORT intro ${lesson.id} ${wordCount(lesson.intro)}`);
    if (wordCount(lesson.takeaway) < 30) report(`SHORT takeaway ${lesson.id} ${wordCount(lesson.takeaway)}`);

    for (const stage of lesson.stages) {
      if (wordCount(stage.body) < 60) report(`SHORT body ${stage.id} ${wordCount(stage.body)}`);

      const declared = new Set(
        [...(stage.helpers ?? "").matchAll(/^\s*(?:float|vec2|vec3|vec4|mat2)\s+(\w+)\s*\(/gm)].map((m) => m[1]),
      );
      for (const text of [stage.helpers ?? "", stage.source]) {
        for (const call of new Set([...text.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)].map((m) => m[1]))) {
          if (!allowed.has(call) && !declared.has(call)) {
            report(`VOCAB ${call} in ${stage.id} (module ${module.position})`);
          }
        }
      }
      for (const name of declared) {
        const usedInHelpers = (stage.helpers ?? "").split(`${name}(`).length - 1 > 1;
        if (!usedInHelpers && !stage.source.includes(`${name}(`)) {
          report(`DEAD HELPER ${name} in ${stage.id}`);
        }
      }
    }

    for (const name of INTRODUCED_BY_LESSON[lesson.id] ?? []) allowed.add(name);
  }
}

console.log(problems === 0 ? "act2 checks pass" : `act2 problems: ${problems}`);
process.exit(problems === 0 ? 0 : 1);
