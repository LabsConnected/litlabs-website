/**
 * Station Control — Checks Station Actions
 *
 * Typed actions for running project checks (typecheck, lint, test, build).
 */

import { z } from "zod";
import { registerStationAction } from "../registry";
import type { StationAction } from "../types";
import { toolRunProjectChecks } from "@/lib/project-tools/registry";
import type { CheckId } from "@/lib/vapi-tools";

// ─── Run Checks Action ─────────────────────────────────────────────

const CheckIdSchema = z.enum(["typecheck", "lint", "test", "build"]);

const runsChecksArgsSchema = z.object({
  projectId: z.string().min(1, "projectId is required"),
  checks: z.array(CheckIdSchema).optional(),
});

const runsChecksResultSchema = z.object({
  checks: z.array(z.object({
    id: z.string(),
    label: z.string(),
    status: z.enum(["passed", "failed", "not_configured"]),
    output: z.string().optional(),
    error: z.string().nullable().optional(),
  })),
  summary: z.object({
    total: z.number(),
    passed: z.number(),
    failed: z.number(),
  }),
  timestamp: z.string(),
});

export const runsChecksAction: StationAction<
  typeof runsChecksArgsSchema,
  z.infer<typeof runsChecksResultSchema>
> = {
  id: "checks.run",
  station: "checks",
  description: "Run project checks (typecheck, lint, test, build)",
  mutating: false,
  argsSchema: runsChecksArgsSchema,
  resultType: runsChecksResultSchema,
  execute: async (args, ctx) => {
    const result = await toolRunProjectChecks(ctx.userId, {
      project_id: args.projectId,
      checks: args.checks as CheckId[] | undefined,
    });
    if (result.ok) {
      return result.data as {
        checks: Array<{
          id: CheckId;
          label: string;
          status: "passed" | "failed" | "not_configured";
          output?: string;
          error?: string | null;
        }>;
        summary: { total: number; passed: number; failed: number };
        timestamp: string;
      };
    }
    throw new Error(result.error || "Checks failed");
  },
};

// Register the action
registerStationAction(runsChecksAction);