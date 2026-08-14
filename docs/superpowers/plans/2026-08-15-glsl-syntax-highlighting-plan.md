# GLSL Syntax Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development when implementing each task.

**Goal:** Add resilient GLSL syntax coloring behind the existing native editor input.

**Architecture:** A pure tokenizer produces source-preserving typed spans. `GlslInput` renders those spans in a non-interactive `Text` layer beneath the transparent native `TextInput`, sharing the existing scroll container and monospace metrics.

**Tech Stack:** Expo SDK 57, React Native, TypeScript, Jest, React Native Testing Library.

## Global Constraints

- Preserve the native `TextInput` as the only editable surface.
- Tokenization must preserve every source character and tolerate incomplete GLSL.
- Do not add dependencies or alter compile/autosave behavior.

### Task 1: Add the tokenizer contract and tests

**Files:**
- Create: `src/components/glsl-highlight.ts`
- Test: `src/components/__tests__/glsl-highlight.test.ts`

- [ ] Write tests for comments, preprocessor lines, strings, numbers, GLSL types/keywords, unknown identifiers, punctuation, and incomplete input; assert concatenated token text equals the source.
- [ ] Run `npx jest src/components/__tests__/glsl-highlight.test.ts --runInBand` and confirm the new tests fail because the tokenizer is absent.
- [ ] Implement `tokenizeGlsl(source): GlslToken[]` with a left-to-right scanner and explicit token kinds.
- [ ] Re-run the focused suite and confirm it passes.
- [ ] Commit with `feat(editor): add GLSL syntax tokenizer`.

### Task 2: Render synchronized highlighted source

**Files:**
- Modify: `src/components/glsl-input.tsx`
- Test: `src/components/__tests__/glsl-input.test.tsx`

- [ ] Add a failing component test asserting the highlight layer exists, displays token text, and updates after `changeText` while `glsl-input` remains present.
- [ ] Run the focused component suite and confirm the test fails for the missing layer.
- [ ] Add a `highlightedSource` layer behind the input, using token-kind colors and matching font/padding metrics; make the input text transparent while keeping caret/selection visible.
- [ ] Keep the layer non-interactive and preserve the existing gutter, symbols, error list, and callbacks.
- [ ] Run focused component tests and TypeScript.
- [ ] Commit with `feat(editor): render GLSL syntax highlighting`.

### Task 3: Full verification

- [ ] Run `npx jest --runInBand` and confirm all suites pass.
- [ ] Run `npx tsc --noEmit`.
- [ ] Inspect `git diff --check` and confirm only the intended tokenizer/input/tests/docs changed.
- [ ] Commit any required test-only adjustments separately; otherwise report the two feature commits.
