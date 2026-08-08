/**
 * Metadata every release carries, in one place because the bundled build and the remote publisher
 * must agree on it and previously each hardcoded its own copy.
 */

/**
 * The oldest app build that can render the current content, and — this is the important part right
 * now — **nothing enforces it yet.**
 *
 * The value is written into every release, stored on device, and validated for shape, but no code
 * anywhere compares it against the running app's version. Surfacing a `requires-app-update` state
 * was deliberately left as backlog by
 * `docs/superpowers/specs/2026-08-06-shader-sandbox-editor-design.md`, and until that exists this
 * field documents an intention rather than gating anything.
 *
 * It therefore stays at the app's own version rather than being bumped to mark the schema additions
 * that have landed (per-stage `helpers`, tutorials). Raising it would be worse than leaving it: it
 * would claim a gate that does not exist, and the moment enforcement is added, a value above
 * `app.json`'s `expo.version` would lock the app out of the very content it ships with.
 *
 * Bump this when two things are true together: enforcement exists, and a released build in the wild
 * cannot render content the next release contains. Not before, and not to keep a changelog.
 */
export const MINIMUM_APP_VERSION = "1.0.0";

/**
 * Bumped whenever committed content changes. A device that already installed an id rejects a
 * different checksum under that same id permanently, so the id and the content move together.
 */
export const BUNDLED_RELEASE_ID = "bundled-2026-08-08-5";
