export const STARTER_SKETCH_TITLE = "First shader";

/**
 * The body a first-run sketch opens with — and the first complete, runnable shader anywhere in the
 * product. Every line is one the curriculum already teaches: normalize, center, aspect-correct,
 * measure a distance, threshold it with `smoothstep`, animate through `iTime`.
 *
 * It exists so the editor never opens on an empty buffer. A blank sandbox shows nothing, which reads
 * as broken rather than as an invitation.
 */
export const STARTER_SKETCH_SOURCE = `vec2 uv = fragCoord / iResolution.xy;
vec2 p = uv * 2.0 - 1.0;
p.x *= iResolution.x / iResolution.y;

float radius = 0.4 + sin(iTime) * 0.08;
float d = length(p) - radius;
float shape = 1.0 - smoothstep(0.0, 0.01, d);

vec3 background = vec3(0.04, 0.04, 0.06);
vec3 fill = vec3(0.78, 0.96, 0.39);
fragColor = vec4(mix(background, fill, shape), 1.0);`;
