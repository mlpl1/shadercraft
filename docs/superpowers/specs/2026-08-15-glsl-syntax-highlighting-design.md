# GLSL Syntax Highlighting Design

## Goal

Add readable GLSL syntax coloring to the editor shown in the Stitch mockup without replacing the native React Native `TextInput` that currently handles editing, selection, keyboard input, and autosave.

## Design

Create a small pure tokenizer that scans GLSL source left-to-right and returns typed spans for comments, preprocessor directives, strings, numbers, keywords/types, and plain text. The tokenizer must preserve every source character, tolerate incomplete code, and never attempt compilation or formatting.

Render the tokenized source in a non-interactive monospace `Text` layer behind the existing transparent-text `TextInput`. The input remains the sole editing surface; its caret and selection stay native. The highlight layer mirrors the same padding, line height, and horizontal/vertical scrolling container so text remains aligned. When the input is disabled, the highlighted layer remains readable.

Use the existing dark theme: comments/subtle text, preprocessor/electric blue, types/acid green, keywords/coral, numbers/warm accent, and strings/amber. Unknown identifiers and punctuation retain the normal editor text color.

## Testing

- Unit-test tokenization for representative GLSL constructs, comments, directives, strings, numbers, and incomplete input.
- Assert source preservation and token categories.
- Component-test that the highlight layer renders and updates after editing while the native input remains present and editable.
- Run the focused component suite, TypeScript, and the full Jest suite.

## Out of scope

No formatter, autocomplete, semantic analysis, compile diagnostics, or platform-specific native editor replacement.
