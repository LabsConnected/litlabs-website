/**
 * Script Detection
 *
 * Detects available lint/typecheck/test/build commands from package.json.
 * The model never invents commands — detection is explicit.
 *
 * Phase 8 — Studio Control Plane V1
 */

import type { DetectedScripts } from "./check-evidence";

/**
 * Detect scripts from a package.json object.
 * Normalizes to the project's package manager.
 */
export function detectScripts(
  packageJson: { scripts?: Record<string, string> },
  packageManager: string = "npm",
): DetectedScripts {
  const scripts = packageJson.scripts ?? {};
  const pm = packageManager;

  // Helper: build the command with the right package manager
  const cmd = (scriptName: string) => {
    if (pm === "pnpm") return `pnpm ${scriptName}`;
    if (pm === "yarn") return `yarn ${scriptName}`;
    return `npm run ${scriptName}`;
  };

  // Detect lint — check common script names
  const lintScript =
    scripts.lint ??
    scripts["lint:check"] ??
    scripts["lint:ci"];
  const lint = lintScript ? cmd("lint") : undefined;

  // Detect typecheck — check common script names
  const typecheckScript =
    scripts["type-check"] ??
    scripts.typecheck ??
    scripts["type-check:ci"] ??
    scripts.tsc;
  const typecheck = typecheckScript
    ? scripts.tsc
      ? cmd("tsc")
      : cmd(scripts["type-check"] ? "type-check" : "typecheck")
    : undefined;

  // Detect test
  const testScript = scripts.test ?? scripts["test:ci"] ?? scripts.vitest;
  const test = testScript ? (scripts.vitest ? "pnpm vitest run" : cmd("test")) : undefined;

  // Detect build
  const buildScript = scripts.build ?? scripts["build:prod"] ?? scripts["build:ci"];
  const build = buildScript ? cmd("build") : undefined;

  return {
    lint,
    typecheck,
    test,
    build,
    packageManager: pm,
  };
}

/**
 * Detect package manager from lockfile presence.
 */
export function detectPackageManager(lockfiles: string[]): string {
  if (lockfiles.includes("pnpm-lock.yaml")) return "pnpm";
  if (lockfiles.includes("yarn.lock")) return "yarn";
  if (lockfiles.includes("package-lock.json")) return "npm";
  return "npm"; // default
}
