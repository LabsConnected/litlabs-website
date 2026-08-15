/**
 * Single source of truth for the LiTT CLI version.
 *
 * Every command reads from here — no scattered "0.1.0" literals.
 * The version is bumped in exactly one place.
 */

export const CLI_VERSION = "0.1.0";

/**
 * The npm package name for upgrade checks.
 */
export const CLI_PACKAGE_NAME = "@litlabs/litt-cli";

/**
 * Get a human-readable version string.
 */
export function versionString(): string {
  return `v${CLI_VERSION}`;
}
