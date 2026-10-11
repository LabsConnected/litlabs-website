/**
 * Station Control Bridge — files station adapters (chunk B, server-only).
 *
 * Thin adapters over the real LiTT tools. No business logic lives here:
 * every execute delegates to the tool registry (real I/O) or returns an
 * honest failure — never a placeholder success.
 *
 * Delegate map:
 * - files.create (type=file) → files.write ({projectId, path, content:""})
 * - files.create (type=dir)  → files.mkdir ({path}) — a real directory tool
 *                               exists, so no terminal fallback is needed
 * - files.move               → files.rename ({path: from, newPath: to})
 * - files.delete             → files.delete ({path}) — approval-gated
 * - files.read               → files.read   ({projectId, path})
 *
 * SHAPE DIFFERENCE (reported): files.rename takes {path, newPath}, not
 * {from, to} — the adapter maps from→path, to→newPath.
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

const writeExecute = delegateToTool("files.write");
const mkdirExecute = delegateToTool("files.mkdir");
const renameExecute = delegateToTool("files.rename");
const deleteExecute = delegateToTool("files.delete");
const readExecute = delegateToTool("files.read");

defineAction({
  id: "files.create",
  station: "files",
  description:
    "Create a file (empty) or a directory in the project workspace. " +
    "Files delegate to files.write; directories delegate to the real files.mkdir tool. " +
    "Path must be workspace-relative.",
  argsSchema: z.object({
    path: z.string().min(1).describe("Workspace-relative path to create"),
    type: z.enum(["file", "dir"]).describe('Create a "file" (empty) or a "dir"'),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    if (args.type === "dir") {
      return mkdirExecute({ path: args.path }, ctx);
    }
    const projectId = ctx.projectId;
    if (!projectId) {
      return fail("files.create requires an active project: station context has no projectId.", "not_configured");
    }
    return writeExecute({ projectId, path: args.path, content: "" }, ctx);
  },
});
// Primary delegate for approval-policy mirroring (both underlying tools are
// MUTATION_APPROVAL, so either mapping yields the same policy). The dir
// branch delegates to files.mkdir — see the execute body above.
setDelegateToolId("files.create", "files.write");

defineAction({
  id: "files.move",
  station: "files",
  description:
    "Move/rename a file within the project workspace. Delegates to the real files.rename tool.",
  argsSchema: z.object({
    from: z.string().min(1).describe("Workspace-relative source path"),
    to: z.string().min(1).describe("Workspace-relative destination path"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    return renameExecute({ path: args.from, newPath: args.to }, ctx);
  },
});
setDelegateToolId("files.move", "files.rename");

defineAction({
  id: "files.delete",
  station: "files",
  description:
    "Delete a file from the project workspace. Delegates to the real files.delete tool. " +
    "Approval-gated per the contract (requiresApproval).",
  argsSchema: z.object({
    path: z.string().min(1).describe("Workspace-relative path to delete"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  requiresApproval: true,
  execute: async (args, ctx): Promise<StationResult> => {
    return deleteExecute({ path: args.path }, ctx);
  },
});
setDelegateToolId("files.delete", "files.delete");

defineAction({
  id: "files.read",
  station: "files",
  description:
    "Read a file from the project workspace. Path must be workspace-relative (never absolute, never parent). Read-only.",
  argsSchema: z.object({
    path: z.string().min(1).describe("Workspace-relative file path"),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    const projectId = ctx.projectId;
    if (!projectId) {
      return fail("files.read requires an active project: station context has no projectId.", "not_configured");
    }
    return readExecute({ projectId, path: args.path }, ctx);
  },
});
setDelegateToolId("files.read", "files.read");

export const FILES_STATION_ACTIONS = [
  "files.create",
  "files.move",
  "files.delete",
  "files.read",
] as const;
