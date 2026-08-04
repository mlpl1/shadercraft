import { ReleaseInstaller } from "../course/release-installer";
import type { DatabaseDriver } from "./driver";

/**
 * Installs the release bundled with this build, activating it only when nothing usable is active.
 *
 * A thin wrapper over {@link ReleaseInstaller} so the bundled seed and downloaded remote releases
 * share one installation path — same validation, same single transaction, same "activate last"
 * ordering.
 *
 * This runs on every cold start (`src/context/data-context.tsx`), so the `only-when-none-active`
 * policy matters: once a downloaded release is active, relaunching must not hand the pointer back to
 * the bundled curriculum. A bundled release that is not yet installed is still inserted and
 * activated — that is genuine first launch, and an app update shipping newer bundled content.
 *
 * On-device checksum verification is skipped here alone: the bundled asset's checksum is
 * verified at build time (`npm run content:check` fails the build if the tracked checksum does not
 * match the authored content) and the asset ships inside the signed application bundle, so hashing
 * it again on every cold start would only add launch latency.
 */
export async function installBundledRelease(
  driver: DatabaseDriver,
  bundledRelease: unknown,
): Promise<void> {
  await new ReleaseInstaller(driver).stageAndActivate(bundledRelease, {
    activation: "only-when-none-active",
    verifyChecksum: false,
  });
}
