/**
 * Station Control Bridge — checks station adapters (chunk B, server-only).
 *
 * Thin adapters over the real LiTT check tools. All four are non-mutating
 * per the contract (they execute the project's own scripts and report
 * exit codes + output). No business logic lives here: every execute
 * delegates to the tool registry (real I/O) or returns an honest failure.
 *
 * Delegate map:
 * - checks.typecheck → typecheck.run ({})
 * - checks.lint      → lint.run      ({})
 * - checks.test      → test.run      ({})
 * - checks.build     → build.run     ({})
 *
 * SHAPE DIFFERENCE (reported): the contract lists checks.test args as
 * {pattern?}, but the real test.run backend takes no inputs — it always
 * runs the project's full test script (handleTestRun ignores inputs). A
 * pattern is accepted for contract fidelity but FAILS HONESTLY when
 * provided, rather than silently running the whole suite while the caller
 * believes it filtered.
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

const typecheckExecute = delegateToTool("typecheck.run");
const lintExecute = delegateToTool("lint.run");
const testExecute = delegateToTool("test.run");
const buildExecute = delegateToTool("build.run");

defineAction({
  id: "checks.typecheck",
  station: "checks",
  description:
    "Run the project's typecheck (tsc --noEmit or the project's typecheck script). Returns exit code and output. Read-only.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (_args, ctx): Promise<StationResult> => {
    return typecheckExecute({}, ctx);
  },
});
setDelegateToolId("checks.typecheck", "typecheck.run");

defineAction({
  id: "checks.lint",
  station: "checks",
  description:
    "Run the project's linter. Returns exit code and output. Read-only.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (_args, ctx): Promise<StationResult> => {
    return lintExecute({}, ctx);
  },
});
setDelegateToolId("checks.lint", "lint.run");

defineAction({
  id: "checks.test",
  station: "checks",
  description:
    "Run the project's test suite. Returns exit code and output. Read-only. " +
    "NOTE: the backend always runs the full test script — a pattern filter is not supported " +
    "and fails honestly when provided.",
  argsSchema: z.object({
    pattern: z.string().optional().describe("Test file/name pattern filter (NOT supported by the backend)"),
  }),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (args, ctx): Promise<StationResult> => {
    if (args.pattern) {
      return fail(
        "checks.test does not support a pattern filter: the test.run backend always runs the project's " +
          "full test script. Call without a pattern.",
        "invalid_args",
      );
    }
    return testExecute({}, ctx);
  },
});
setDelegateToolId("checks.test", "test.run");

defineAction({
  id: "checks.build",
  station: "checks",
  description:
    "Run the project's build script. Returns exit code and output. Read-only.",
  argsSchema: z.object({}),
  resultType: stationResultSchema,
  mutating: false,
  execute: async (_args, ctx): Promise<StationResult> => {
    return buildExecute({}, ctx);
  },
});
setDelegateToolId("checks.build", "build.run");

export const CHECKS_STATION_ACTIONS = [
  "checks.typecheck",
  "checks.lint",
  "checks.test",
  "checks.build",
] as const;
