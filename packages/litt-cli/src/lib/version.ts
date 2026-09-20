/**
 * Single source of truth for the LiTT CLI version.
 *
 * Every command reads from here — no scattered version literals.
 * The version is bumped in exactly one place.
 */

export const CLI_VERSION = "0.1.1";

/**
 * The npm package name for upgrade checks.
 */
export const CLI_PACKAGE_NAME = "@litlabs1/litt-cli";

/**
 * Get a human-readable version string.
 */
export function versionString(): string {
  return `v${CLI_VERSION}`;
}
