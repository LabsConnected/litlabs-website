/**
 * Station Control Bridge — code station adapters (chunk B, server-only).
 *
 * Thin adapters over the real LiTT tools. No business logic lives here:
 * every execute delegates to the tool registry (real I/O) or returns an
 * honest failure — never a placeholder success.
 *
 * Delegate map:
 * - code.search   → search_code   ({query, glob?} — direct)
 * - code.readFile → files.read    ({projectId, path}; projectId injected from ctx)
 * - code.writeFile→ files.write   ({projectId, path, content}; projectId injected from ctx)
 * - code.refactor → apply_patch   ({path, patches[]})
 *
 * SHAPE DIFFERENCE (reported): the contract lists code.refactor args as
 * {path, instruction}, but the real apply_patch backend requires concrete
 * search/replace patches ({path, patches: [{search, replace}]}). An adapter
 * cannot synthesize search/replace pairs from a free-form instruction
 * without model inference, so this action exposes the patch shape directly.
 * The agent (LLM) generates the patches — exactly as it does when calling
 * apply_patch in the agent loop today (see patch-validation.ts).
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

const searchExecute = delegateToTool("search_code", (args) => ({
  query: args.query,
  ...(typeof args.glob === "string" && args.glob ? { glob: args.glob } : {}),
}));

defineAction({
  id: "code.search",
  station: "code",
  description:
    "Search the project codebase with ripgrep. Returns matching file paths, line numbers, and content. Read-only.",
  argsSchema: z.object({
    query: z.string().min(1).describe("Search query (ripgrep pattern)"),
    glob: z.string().optional().describe("Optional file glob filter, e.g. 'src/**/*.ts'"),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    return searchExecute({ query: args.query, ...(args.glob ? { glob: args.glob } : {}) }, ctx);
  },
});
setDelegateToolId("code.search", "search_code");

const readFileExecute = delegateToTool("files.read");

defineAction({
  id: "code.readFile",
  station: "code",
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
      return fail("code.readFile requires an active project: station context has no projectId.", "not_configured");
    }
    return readFileExecute({ projectId, path: args.path }, ctx);
  },
});
setDelegateToolId("code.readFile", "files.read");

const writeFileExecute = delegateToTool("files.write");

defineAction({
  id: "code.writeFile",
  station: "code",
  description:
    "Write (create or overwrite) a file in the project workspace. Path must be workspace-relative. Unresolved template placeholders are rejected by the backend.",
  argsSchema: z.object({
    path: z.string().min(1).describe("Workspace-relative file path"),
    content: z.string().describe("Complete literal file content"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    const projectId = ctx.projectId;
    if (!projectId) {
      return fail("code.writeFile requires an active project: station context has no projectId.", "not_configured");
    }
    return writeFileExecute({ projectId, path: args.path, content: args.content }, ctx);
  },
});
setDelegateToolId("code.writeFile", "files.write");

const refactorExecute = delegateToTool("apply_patch");

const patchSchema = z.object({
  search: z.string().min(1).describe("Exact text to find (copy from a fresh files.read)"),
  replace: z.string().describe("Replacement text"),
});

defineAction({
  id: "code.refactor",
  station: "code",
  description:
    "Apply targeted search-and-replace patches to an existing file (delegates to the real apply_patch). " +
    "NOTE: the contract's {path, instruction} form is not realizable — the backend needs concrete patches, " +
    "so the caller supplies patches[] (search text copied exactly from a fresh read). Re-read the file before patching.",
  argsSchema: z.object({
    path: z.string().min(1).describe("Workspace-relative file path"),
    patches: z.array(patchSchema).min(1).describe("Search/replace patches to apply"),
  }),
  resultType: stationResultSchema,
  mutating: true,
  execute: async (args, ctx): Promise<StationResult> => {
    return refactorExecute({ path: args.path, patches: args.patches }, ctx);
  },
});
setDelegateToolId("code.refactor", "apply_patch");

export const CODE_STATION_ACTIONS = [
  "code.search",
  "code.readFile",
  "code.writeFile",
  "code.refactor",
] as const;
