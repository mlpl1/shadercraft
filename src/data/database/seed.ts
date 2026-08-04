import { ReleaseInstaller } from "../course/release-installer";
import type { DatabaseDriver } from "./driver";

/**
 * Installs the release bundled with this build and makes it active, if it is not already.
 *
 * A thin wrapper over {@link ReleaseInstaller} so the bundled seed and downloaded remote releases
 * share one installation path — same validation, same single transaction, same "activate last"
 * ordering. On-device checksum verification is skipped here alone: the bundled asset's checksum is
 * verified at build time (`npm run content:check` fails the build if the tracked checksum does not
 * match the authored content) and the asset ships inside the signed application bundle, so hashing
 * it again on every cold start would only add launch latency.
 */
export async function installBundledRelease(
  driver: DatabaseDriver,
  bundledRelease: unknown,
): Promise<void> {
  await new ReleaseInstaller(driver).stageAndActivate(bundledRelease, { verifyChecksum: false });
}
