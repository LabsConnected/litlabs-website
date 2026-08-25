/**
 * Station Control — Git Station Actions
 *
 * Typed actions for git operations.
 */

import { z } from "zod";
import { registerStationAction } from "../registry";
import type { StationAction } from "../types";
import { toolGitStatus, toolCreateBranch, toolCommitChanges } from "@/lib/project-tools/registry";

// ─── Git Status Action ─────────────────────────────────────────────

const gitStatusArgsSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
});

const gitStatusResultSchema = z.object({
  clean: z.boolean(),
  files: z.array(z.string()),
});

export const gitStatusAction: StationAction<
  typeof gitStatusArgsSchema,
  z.infer<typeof gitStatusResultSchema>
> = {
  id: "git.status",
  station: "git",
  description: "Check git status",
  mutating: false,
  argsSchema: gitStatusArgsSchema,
  resultType: gitStatusResultSchema,
  execute: async (args, ctx) => {
    const result = await toolGitStatus(ctx.userId, {
      project_id: args.projectId,
    });
    if (result.success) {
      return result.data as { clean: boolean; files: string[] };
    }
    throw new Error(result.message || "Git status failed");
  },
};

/**
 * Git Diff Action ─────────────────────────────────────────────────────
 */

const gitDiffArgsSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  branch: z.string().optional(),
});

const gitDiffResultSchema = z.object({
  changedFiles: z.array(z.string()),
  diff: z.string(),
});

export const gitDiffAction: StationAction<
  typeof gitDiffArgsSchema,
  z.infer<typeof gitDiffResultSchema>
> = {
  id: "git.diff",
  station: "git",
  description: "Show git diff for workspace",
  mutating: false,
  argsSchema: gitDiffArgsSchema,
  resultType: gitDiffResultSchema,
  execute: async (args, ctx) => {
    // We need to use the project repository functions to get workspace info
    // For now, this is a placeholder that will work once we have proper integration
    throw new Error("git.diff: Requires project repository integration");
  },
};

// ─── Git Commit Action ──────────────────────────────────────────────

const gitCommitArgsSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  message: z.string().min(1, "message is required"),
});

const gitCommitResultSchema = z.object({
  sha: z.string().nullable(),
  message: z.string(),
});

export const gitCommitAction: StationAction<
  typeof gitCommitArgsSchema,
  z.infer<typeof gitCommitResultSchema>
> = {
  id: "git.commit",
  station: "git",
  description: "Commit changes with a message",
  mutating: true,
  argsSchema: gitCommitArgsSchema,
  resultType: gitCommitResultSchema,
  execute: async (args, ctx) => {
    const result = await toolCommitChanges(ctx.userId, {
      project_id: args.projectId,
      message: args.message,
    });
    if (result.success) {
      return result.data as { sha: string | null; message: string };
    }
    throw new Error(result.message || "Git commit failed");
  },
};

// Register the actions
registerStationAction(gitStatusAction);
registerStationAction(gitDiffAction);
registerStationAction(gitCommitAction);