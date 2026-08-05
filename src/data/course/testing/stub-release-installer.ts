import type { CourseReleaseInstallerLike } from "../../sync/course-sync-engine";

/** The bundled release id every suite that only needs `DataContextValue` to be well-formed uses. */
export const STUB_BUNDLED_RELEASE_ID = "bundled-test";

/**
 * A `CourseReleaseInstallerLike` that installs and deletes nothing.
 *
 * `DataProvider` exposes a real `ReleaseInstaller` so downloaded releases have exactly one path into
 * SQLite (see `src/context/data-context.tsx`). Suites that inject a fake `DataContextValue` to render
 * a screen have no database and never activate a release, so they need the field to exist and nothing
 * more — same role as `src/data/database/testing/node-sqlite-driver.ts`, kept out of the suites so
 * six copies of it cannot drift apart. Anything that actually asserts on installation uses the real
 * installer against `NodeSqliteDriver`.
 */
export const STUB_RELEASE_INSTALLER: CourseReleaseInstallerLike = {
  async stageAndActivate() {
    return { status: "unchanged", releaseId: STUB_BUNDLED_RELEASE_ID };
  },
  async deleteSupersededReleases() {
    return [];
  },
};
