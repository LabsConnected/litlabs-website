/**
 * `project.ship` — the agent-callable safe shipping capability.
 *
 * This is a thin ToolEntry wrapper around shipWorkflow() (git-workflow.ts).
 * It does NOT duplicate any git safety logic — every protection (no
 * `git add -A`, no force push, no direct writes to protected branches,
 * explicit intended-file staging only, PR reuse, truthful failure
 * reporting) lives in git-workflow.ts and applies here unchanged.
 *
 * Security model — there is exactly ONE way this tool can execute:
 *
 *   model emits tool_call "project.ship"
 *         ↓
 *   agent-loop.ts routes ALL tool calls through options.gateway.execute()
 *         ↓
 *   ExecutionGateway.execute() — metadata.mutating === true
 *         ↓
 *   PLAN mode        → deny (no approval requested, handler never runs)
 *   ACT mode         → require_approval (human must approve)
 *   AUTO w/o grant   → require_approval
 *   AUTO w/ grant    → allow
 *         ↓
 *   only on "allow"/approved does entry.handler() (shipHandler) run
 *
 * This tool never calls the gateway itself and never runs git directly
 * outside of shipWorkflow() — there is no second/alternate execution
 * path. The handler only runs after the gateway has already decided to
 * dispatch it.
 */

import type { ToolDefinition, ToolMetadata, ToolHandler, ToolEntry } from "@litt/agent-core";
import { shipWorkflow } from "./git-workflow.js";

export const SHIP_TOOL_DEFINITION: ToolDefinition = {
  id: "project.ship",
  name: "ship",
  description:
    "Safely commit and ship changes: create/switch to a feature branch, " +
    "stage ONLY the explicitly listed files (never `git add -A`), commit, " +
    "push, and open a draft PR. Refuses to commit directly to main/master/" +
    "release/prod branches. Never force-pushes. Requires human approval " +
    "before executing. Call project.status and project.diff first so the " +
    "human approver can see exactly what is about to ship.",
  inputSchema: {
    type: "object",
    properties: {
      files: {
        type: "array",
        items: { type: "string" },
        description: "Relative file paths to stage. Only these files are staged — every other dirty/untracked file is left untouched.",
      },
      message: {
        type: "string",
        description: "Commit message. Also used as the draft PR title/summary.",
      },
      branch: {
        type: "string",
        description: "Optional branch name. If omitted, a safe feature branch name is generated from the message.",
      },
      push: {
        type: "boolean",
        description: "Push the branch after committing. Default true.",
        default: true,
      },
      createPR: {
        type: "boolean",
        description: "Open a draft PR after pushing (reuses an existing open PR for the branch if one exists). Default true.",
        default: true,
      },
    },
    required: ["files", "message"],
  },
  readOnly: false,
};

export const SHIP_TOOL_METADATA: ToolMetadata = {
  projectScoped: true,
  mutating: true,
  readOnly: false,
};

export const shipHandler: ToolHandler = async (ctx, args) => {
  const files = Array.isArray(args.files)
    ? args.files.filter((f): f is string => typeof f === "string")
    : [];
  const message = typeof args.message === "string" ? args.message : "";
  const branch = typeof args.branch === "string" && args.branch.trim().length > 0 ? args.branch : undefined;
  const push = args.push !== false;
  const createPR = args.createPR !== false;

  if (files.length === 0) {
    return {
      status: "failed",
      success: false,
      message: "No files specified to ship. Pass explicit file paths — project.ship never guesses or stages everything.",
      data: {},
    };
  }
  if (!message.trim()) {
    return {
      status: "failed",
      success: false,
      message: "Missing commit message",
      data: {},
    };
  }

  const result = await shipWorkflow({
    cwd: ctx.cwd,
    files,
    message,
    branch,
    push,
    createPR,
  });

  return {
    status: result.ok ? "success" : "failed",
    success: result.ok,
    message: result.message,
    data: {
      branch: result.branch ?? null,
      commitSha: result.commitSha ?? null,
      prUrl: result.prUrl ?? null,
      prNumber: result.prNumber ?? null,
      stagedFiles: result.stagedFiles ?? [],
      pushRequested: push,
      prRequested: createPR,
    },
  };
};

export const SHIP_TOOL_ENTRY: ToolEntry = {
  definition: SHIP_TOOL_DEFINITION,
  handler: shipHandler,
  metadata: SHIP_TOOL_METADATA,
};
