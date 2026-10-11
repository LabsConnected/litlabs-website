/**
 * Station Control Bridge — git station adapters (chunk B, server-only).
 *
 * Thin adapters over the real LiTT tools. No business logic lives here:
 * every execute delegates to the tool registry (real I/O) or returns an
 * honest failure — never a placeholder success.
 *
 * Delegate map:
 * - git.status → git.status ({projectId}; projectId injected from ctx)
 * - git.diff   → git.diff   ({path?})
 * - git.branch → terminal.execute ({command: "git checkout -b <name>", projectId})
 *                Branch names are validated (no spaces / shell metacharacters)
 *                before delegation. NOTE: the underlying terminal.execute tool
 *                is currently disabled AND quarantined (NEVER_ALLOW_APPROVAL)
 *                in the tool registry, so this delegation fails honestly with
 *                the registry's refusal until the tool is re-enabled — a
 *                product/policy decision, not an adapter gap.
 * - git.commit → git.commit ({message})
 *
 * DELIBERATELY OMITTED (policy, per chunk-B brief):
 * - git.push    — no push tool exists in the registry (only a permission
 *                 string in permission-engine.ts); pushing to a remote is a
 *                 policy decision, not just code.
 * - git.createPR — no PR-creation tool exists in the registry.
 * Both are documented here instead of stubbed, per the contract's
 * truth-layer rule (§19.1): omit, never fake.
 */
import "server-only";

import { z } from "zod";

import { registerStationAction } from "../registry";
import { delegateToTool } from "../delegate";
import { setDelegateToolId } from "../advertise";
import type {
  StationAction,
  StationExecutionContext,
  StationResult,
} from "../types";
import { fail, stationResultSchema } from "./creator-helpers";

/**
 * Register a station action. Generic over the args schema so execute bodies
 * get a typed `args` instead of unknown. The executor safeParses raw args
 * against argsSchema before invoking execute, so the cast to the erased
 * StationAction is sound.
 */
function defineAction<A extends z.ZodType>(
  action: StationAction<A, StationResult>,
): void {
  registerStationAction(action as StationAction);
}

const statusExecute = delegateToTool("git.status");
const diffExecute = delegateToTool("git.diff", (args) => ({
  ...(typeof args.path === "string" && args.path ? { path: args.path } : {}),
}));
const branchExecute = delegateToTool("terminal.execute");
const commitExecute = delegateToTool("git.commit");

defineAction({
  id: "git.status",
  station: "git",
  description:
    "Get git status for the project workspace: branch, staged/unstaged changes, recent commits. Read-only.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (_args, ctx): Promise<StationResult> => {
    const projectId = ctx.projectId;
    if (!projectId) {
      return fail("git.status requires an active project: station context has no projectId.", "not_configured");
    }
    return statusExecute({ projectId }, ctx);
  },
});
setDelegateToolId("git.status", "git.status");

defineAction({
  id: "git.diff",
  station: "git",
  description:
    "Show the git diff for the project workspace, optionally scoped to one path. Read-only.",
  argsSchema: z.object({
    path: z.string().optional().describe("Optional workspace-relative path to scope the diff"),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    return diffExecute(args.path ? { path: args.path } : {}, ctx);
  },
});
setDelegateToolId("git.diff", "git.diff");

/**
 * Conservative branch-name validation: allow only characters that are safe
 * both for git ref format and for shell interpolation (the command is built
 * by string interpolation, so every shell metacharacter is rejected here).
 */
const SAFE_BRANCH_NAME = /^[A-Za-z0-9._/-]+$/;

function branchNameError(name: string): string | null {
  if (!SAFE_BRANCH_NAME.test(name)) {
    return `Invalid branch name ${JSON.stringify(name)}: only letters, digits, ".", "_", "-" and "/" are allowed (no spaces or shell metacharacters).`;
  }
  if (
    name.includes("..") ||
    name.includes("//") ||
    name.startsWith("/") ||
    name.startsWith("-") || // flag injection: `git checkout -b <name>` has no `--` separator
    name.startsWith(".") ||
    name.endsWith("/") ||
    name.endsWith(".lock") ||
    name.includes("@{") ||
    name.split("/").some((part) => part.startsWith("."))
  ) {
    return `Invalid branch name ${JSON.stringify(name)}: not a valid git ref format.`;
  }
  return null;
}

defineAction({
  id: "git.branch",
  station: "git",
  description:
    "Create and check out a new git branch in the project workspace (delegates to terminal.execute " +
    '"git checkout -b <name>"). The name is strictly validated. NOTE: terminal.execute is currently ' +
    "disabled/quarantined in the tool registry, so this fails honestly until it is re-enabled.",
  argsSchema: z.object({
    name: z.string().min(1).describe("New branch name (letters, digits, ., _, -, / only)"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const nameError = branchNameError(args.name);
    if (nameError) {
      return fail(nameError, "invalid_args");
    }
    const projectId = ctx.projectId;
    if (!projectId) {
      return fail("git.branch requires an active project: station context has no projectId.", "not_configured");
    }
    // The name passed validation above (no shell metacharacters), so
    // interpolation is safe.
    return branchExecute({ command: `git checkout -b ${args.name}`, projectId }, ctx);
  },
});
setDelegateToolId("git.branch", "terminal.execute");

defineAction({
  id: "git.commit",
  station: "git",
  description:
    "Stage files and create a git commit in the project workspace. Delegates to the real git.commit tool.",
  argsSchema: z.object({
    message: z.string().min(1).describe("Commit message"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    return commitExecute({ message: args.message }, ctx);
  },
});
setDelegateToolId("git.commit", "git.commit");

// git.push and git.createPR are deliberately NOT registered (see header).

export const GIT_STATION_ACTIONS = [
  "git.status",
  "git.diff",
  "git.branch",
  "git.commit",
] as const;
