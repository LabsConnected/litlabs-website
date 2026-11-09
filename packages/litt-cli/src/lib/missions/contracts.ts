import { z } from "zod";

// Mission Controller Stage 1 contracts.
//
// A mission is a durable, resumable sequence of work orders ("steps")
// executed by adapter shims over existing infrastructure: gh CLI, HTTP
// probes, argv commands, litt repair jobs. Every step declares an
// idempotency probe so a resumed mission NEVER re-executes work whose
// end-state already exists (no duplicate dispatches, deploys, writes).

export const missionStepKind = z.enum([
  "gh-pr-checks",        // poll gh pr checks until all terminal
  "gh-workflow-dispatch",// workflow_dispatch with inputs
  "gh-run-watch",        // poll latest run of a workflow until terminal
  "http-check",          // GET url, expect status (+ optional json field match)
  "run-check",           // spawn argv command, expect exit 0
  "staging-verify-sha",  // /api/health .checks.build.detail == sha
  "owner-gate",          // park for explicit owner action
  "report",              // emit consolidated evidence report
]);

const stepParams = z.record(z.string(), z.unknown()).default({});

export const missionStepSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[\w.-]+$/, "id must be a file-safe token"),
  kind: missionStepKind,
  description: z.string().trim().min(1).max(500),
  dependsOn: z.array(z.string()).default([]),
  maxAttempts: z.number().int().min(1).max(5).default(2),
  timeoutMs: z.number().int().min(1_000).max(3_600_000).default(300_000),
  params: stepParams,
}).strict();

export const missionSchema = z.object({
  id: z.string().trim().min(4).max(80).regex(/^[\w.-]+$/),
  title: z.string().trim().min(1).max(200),
  priority: z.enum(["p0", "p1", "p2"]).default("p1"),
  createdAt: z.string().default(() => new Date().toISOString()),
  budgetMs: z.number().int().min(60_000).max(86_400_000).default(7_200_000),
  steps: z.array(missionStepSchema).min(1).max(50),
}).strict();

export type Mission = z.infer<typeof missionSchema>;
export type MissionStep = z.infer<typeof missionStepSchema>;
export type MissionStepKind = z.infer<typeof missionStepKind>;

export const stepStatusEnum = z.enum(["pending", "in-flight", "done", "blocked", "parked", "skipped"]);

export const stepStateSchema = z.object({
  status: stepStatusEnum.default("pending"),
  attempts: z.number().int().default(0),
  evidence: z.array(z.string()).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export const missionStateSchema = z.object({
  missionId: z.string(),
  status: z.enum(["pending", "running", "blocked", "parked", "complete", "failed"]).default("pending"),
  steps: z.record(z.string(), stepStateSchema).default({}),
  log: z.array(z.string()).default([]),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
}).strict();

export type MissionState = z.infer<typeof missionStateSchema>;
export type StepState = z.infer<typeof stepStateSchema>;
