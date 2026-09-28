/**
 * LiTT Verification Foundation — build executor.
 *
 * Declares the canonical command identities for build verification
 * (type-check, lint, tests, build) and runs them through the terminal
 * executor so every run produces the same evidence shape. Evidence
 * collection for terminal/build verification comes first; other executors
 * (preview, provider) attach later through the same port.
 */
import type { CommandSpec } from "../contracts/command";
import { executeCommand, commandResultToEvidenceDraft } from "./terminal-executor";
import type { EvidenceDraft } from "./terminal-executor";

export type BuildCommandIdentity = "type-check" | "lint" | "tests" | "build";

export interface BuildCommandOptions {
  cwd?: string;
  timeoutMs?: number;
  /** Extra args appended to the canonical command. */
  extraArgs?: string[];
}

/** Canonical command specs. pnpm@10.33.4 is the toolchain (package.json). */
export function buildCommandSpec(
  identity: BuildCommandIdentity,
  options: BuildCommandOptions = {},
): CommandSpec {
  const base = {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 300_000,
    executorId: "build-executor",
  };
  switch (identity) {
    case "type-check":
      return { ...base, identity, command: "pnpm", args: ["type-check", ...(options.extraArgs ?? [])] };
    case "lint":
      return { ...base, identity, command: "pnpm", args: ["lint", ...(options.extraArgs ?? [])] };
    case "tests":
      return { ...base, identity, command: "pnpm", args: ["test", ...(options.extraArgs ?? [])] };
    case "build":
      return { ...base, identity, command: "pnpm", args: ["build", ...(options.extraArgs ?? [])] };
  }
}

/**
 * Run a build command and return its evidence draft.
 * The draft still needs persistence through a VerificationStore.
 */
export function runBuildCommand(
  identity: BuildCommandIdentity,
  options: BuildCommandOptions = {},
): EvidenceDraft {
  const spec = buildCommandSpec(identity, options);
  const result = executeCommand(spec);
  return commandResultToEvidenceDraft(result);
}
