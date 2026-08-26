# The preview frame

Every render claim in the curriculum is a claim about a specific rectangle. This document is what
that rectangle actually is, and what may and may not be said about it.

It exists because Act 1 was authored against a frame the app has never drawn. Three independent
audits later converged on the same phantom constant — **aspect 0.5625, a 9:16 portrait screen** —
from different evidence in different modules. That was not a scatter of careless sentences; it was
one wrong number, applied consistently, inherited by every horizontal claim in thirty-two lessons.

## The lesson preview

`PREVIEW_HEIGHT = 200`dp (`src/components/lesson-stage-block.tsx`), width `min(screenWidth, 520) − 40`
(`src/components/lesson-workspace.tsx`, the content column).

| device | preview | aspect A |
| --- | --- | --- |
| 320dp (small phone) | 280 × 200 | **1.40** |
| 360dp (common Android floor) | 320 × 200 | 1.60 |
| 411dp (test emulator — **odd width**) | 371 × 200 | 1.855 |
| ≥560dp (column capped) | 480 × 200 | **2.40** |

Measured on device: a screenshot at 411dp puts the preview at 973px wide against a predicted 974.

**It is a landscape band on every device.** It is never tall, never portrait, never square.

## The tutorial preview

Different, and it is easy to forget. `tutorial.tsx` sets `PREVIEW_HEIGHT = 150` and lays **two**
previews side by side (Target and Yours), so each is `(min(screenWidth, 520) − 40) / 2` wide.

| device | preview | aspect A |
| --- | --- | --- |
| 320dp | 140 × 150 | **0.933 — portrait** |
| **340dp** | 150 × 150 | **1.000 — square** |
| 411dp | 185.5 × 150 | 1.237 |
| ≥560dp | 240 × 150 | **1.600** |

**The tutorial aspect crosses 1.0 inside the phone range.** A tutorial preview is taller than wide
on a small phone and wider than tall on a large one, so no claim about which way a shape is
stretched is authorable there.

The 520 cap on this screen was added during the Act 1 audit. Without it the tutorial aspect reached
3.28 on a wide window; it was the only content screen in the app missing the cap that
`lesson-workspace`, `course`, `index`, `account` and the completion sheet all apply.

## The two coordinate systems

- `uv = fragCoord / iResolution.xy` runs 0..1 on **both** axes at every width. `uv` claims are
  frame-independent — **but what they look like is not.** A shape that is round in `uv` renders
  stretched horizontally, by 1.40× to 2.40× on a lesson preview.
- `p.x *= iResolution.x / iResolution.y` makes `p.y` run −1..1 and **`p.x` run ±1.40 to ±2.40**.
  After this line one unit is the same number of pixels on both axes and shapes are round.

Check which one a stage uses before judging any claim in it. Module 1 lessons 1–2 have no
correction; lesson 3 is *about* introducing it.

## What is authorable

| Safe | Not authorable |
| --- | --- |
| Corrected `p` units — radii, offsets, distances | Any single specific horizontal distance |
| Vertical claims: `p.y` is ±1 on every device | Corner colours and corner distances |
| `uv`-space values, and fractions of the width | A side-edge value given as one number |
| An anchor at `p.x = ±1.0` — on screen at every lesson width | "N per cent of the way to the side edges" |
| A value quoted as a **device-named pair** | "roughly twice as wide as it is tall" (it is 1.4× at 320dp) |

Nothing clips horizontally below **1.40** in corrected `p`; everything does above **2.40**. Between
those, no clipping claim is authorable. A side-edge midpoint is **not** the frame's extremum — the
corner is further out on both axes. A bound quoted at the narrow end must round **away** from the
value.

Repair a frame-dependent claim in this order: **re-anchor** it on something that does not move (a
vertical fact, a `uv` fraction, `p.x = ±1.0`); failing that quote a **device-named pair**; failing
that **drop the number** and keep the qualitative point. Do not repair by piling on disclosure — Act
2's fix loop inflated its prose threefold that way.

## How to measure

1. **Sample real pixels.** Rows are `p.y = (2j+1−H)/H`, so `p.y = 0` is never a row on an
   even-height preview. Columns are offset by `0.005 − W/200 (mod 0.01)`: `p.x = 0` is a column only
   when the width is **odd**, which is true of the 371px emulator and false of 280, 320 and 480.
   **Never quote a rim or silhouette pixel** — near a tangency the sampled column moves the value by
   more than the rounding.
2. **Derive the coordinate the way the shader does.** `((i+0.5)/W·2−1)·(W/H)` and the algebraic
   shortcut `(2i+1−W)/200` are equal in reals and **not** in float32 — they disagree on 160 of 280
   columns. The error vanishes on `p.x = 0`, so an anchor scanned up the centre column cannot detect
   it.
3. **Two arithmetic models.** The sandbox prepends `precision highp float;`, so the driver is float32
   while an authoring harness is double. Sphere tracing self-corrects, but a **central difference**
   divides a float32 ulp at 1.0 by `2ε` and turns it into a ~3e-5 lattice on the painted value.
   Check anything past three decimals under `Math.fround`-per-operation as well. Three decimals has
   been safe everywhere so far.
4. **Fine linear scan, not bisection** — a distance field is not monotone in the radius, so a
   wide-bracket bisection can latch a crossing that is not the silhouette.
5. **A silhouette is where the march stops, not where it converges.** Act 2's bodies test
   `t < 20.0`, which accepts an exhausted march as a hit. Use the shader's own predicate.
6. **`iResolution` is physical pixels, not dp** — the buffer is 2–3× the dp figures above. Any
   per-pixel claim has to say which it means.
7. **A frame-wide extremum needs a width dimension.** Its *location* moves between grids even when
   its *value* rounds the same.

## The failure that has cost the most

Across Act 2's authoring, thirteen fix rounds failed the same way: **a value measured on a sample,
then stated over a set nobody enumerated.** Before writing any sentence containing "every", "no",
"never", "always", "only", "within", "nothing" or a bare plural — enumerate the set it quantifies
over and measure all of it, at every width, in both arithmetic models. If you cannot sweep the whole
set, scope the sentence to the sample you took.

Two habits that produced most of those failures:

- **Do not restate a printed table in words.** A summary sentence can only agree with the numbers
  above it or contradict them.
- **Do not put two universals about overlapping sets in adjacent clauses.** They will disagree.

## The category the numeric checks miss

Every review this project has run hunted **numerals**. Two kinds of claim slip past:

- **Appearance sentences** — the one line per stage naming what the learner will *see*. Act 2 said
  "what you get is a lavender band", which is the centre pixel; the corners are saturated teal and
  hot pink at the widest aspect. Act 1's closing vignette was described as dimming the corners when
  it bites hardest at the sides. Check these against the **whole frame**, not the centre.
- **Shape words** — "a circle", "a square", "a ring". On an uncorrected coordinate a circle is an
  ellipse on screen, so the word choice before and after the aspect correction is load-bearing.

## Counting sentences are where this breaks

Of the thirty-two defects the Act 1 audit found, six were missed by a keyword census that searched
for corner, edge, width and portrait language. All six were plain horizontal **counts** — "roughly
two thousand specks", "four and a half across", "roughly nineteen bands" — with no frame word in
them at all. Meanwhile seven of eight "corner" hits in the noise module turned out to be *lattice*
corners and were correct.

If a sentence counts something across the frame, it is frame-dependent whether or not it says so.

## Battery saver does not change the frame

The Settings tab now lets a learner choose Full speed or Battery saver for live previews.
That toggle changes presentation cadence, not geometry: Full speed presents every animation frame,
while Battery saver skips callbacks until roughly every 33.3 ms. When Battery saver does present,
the shader still receives the real elapsed timestamp rather than a slowed synthetic clock.

That means every claim in this document stays exactly the same in either mode. The rectangle,
aspect ratio, coordinate systems, and any measurement derived from them do not change; only the
number of intermediate animation frames shown to the learner changes.
