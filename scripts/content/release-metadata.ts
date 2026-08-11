/**
 * Metadata every release carries, in one place because the bundled build and the remote publisher
 * must agree on it and previously each hardcoded its own copy.
 */

/**
 * The oldest app build that may install the current content. This **is** enforced, on device:
 * `CourseSyncEngine.assessCompatibility` compares it against the running app's version and answers
 * `requires-app-update` when the app is older, refusing the download rather than installing content
 * it may not be able to render. A build that cannot state its own version is treated the same way.
 *
 * So raising this has teeth, and raising it wrongly strands devices. Every release published so far
 * declares `1.0.0`, matching `app.json`'s `expo.version`; setting it above that would make the app
 * refuse the very content it ships with.
 *
 * Bump it when a build already in the wild cannot render what the next release contains — the schema
 * additions so far (per-stage `helpers`, tutorials) are exactly that kind of change, and the moment
 * a version ships without them, this and `expo.version` need raising together.
 *
 * What is *not* built is the learner-facing side: nothing surfaces `requires-app-update` in the UI,
 * so a gated device quietly keeps its previous release. That part is still backlog, per
 * `docs/superpowers/specs/2026-08-06-shader-sandbox-editor-design.md`.
 */
export const MINIMUM_APP_VERSION = "1.0.0";

/**
 * Bumped whenever committed content changes. A device that already installed an id rejects a
 * different checksum under that same id permanently, so the id and the content move together.
 */
export const BUNDLED_RELEASE_ID = "bundled-2026-08-11-19";
