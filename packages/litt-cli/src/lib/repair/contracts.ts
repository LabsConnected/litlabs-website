import { z } from "zod";
import { repairCommandDenyReason } from "./command-deny.js";

const relativePathSchema = z.string()
  .trim()
  .min(1)
  .max(260)
  .refine((value) => !value.includes("\0"), "Path contains a null byte")
  .refine((value) => !/^(?:[a-z]:[\\/]|[\\/]{1,2})/i.test(value), "Path must be relative")
  .refine(
    (value) => !value.replace(/\\/g, "/").split("/").includes(".."),
    "Path traversal is not allowed",
  )
  .refine((value) => !value.includes(":"), "Alternate data streams are not allowed");

export const repairCommandSchema = z.object({
  command: z.string().trim().min(1).max(128)
    .regex(/^[\w.@+:-]+(?:\.exe|\.cmd|\.bat)?$/i, "Command must be a bare executable"),
  args: z.array(z.string().max(1_024)).max(64).default([]),
  timeoutMs: z.number().int().min(100).max(600_000).default(120_000),
  maxOutputBytes: z.number().int().min(1_024).max(1_048_576).default(131_072),
}).strict().superRefine((command, context) => {
  const reason = repairCommandDenyReason(command);
  if (reason) context.addIssue({ code: "custom", path: ["command"], message: reason });
});

export const expectedFailureSchema = z.object({
  stream: z.enum(["stdout", "stderr", "any"]).default("any"),
  includes: z.string().min(1).max(2_048),
}).strict();

export const repairCheckSchema = z.object({
  name: z.string().trim().min(1).max(80),
  command: repairCommandSchema,
  kind: z.enum(["focused", "test", "typecheck", "lint", "build"]),
  required: z.boolean().default(true),
}).strict();

export const repairModelPolicySchema = z.object({
  pinnedModel: z.string().trim().min(1).max(160).nullable().default(null),
  allowedModels: z.array(z.string().trim().min(1).max(160)).max(8).default([]),
  allowEscalation: z.boolean().default(false),
  offline: z.boolean().default(false),
}).strict().superRefine((policy, context) => {
  if (policy.pinnedModel && policy.allowedModels.length > 0
    && !policy.allowedModels.includes(policy.pinnedModel)) {
    context.addIssue({
      code: "custom",
      path: ["pinnedModel"],
      message: "Pinned model must be included in allowedModels",
    });
  }
  if (policy.offline && policy.pinnedModel && !policy.pinnedModel.startsWith("ollama:")) {
    context.addIssue({
      code: "custom",
      path: ["pinnedModel"],
      message: "Offline repair can only pin an ollama: model",
    });
  }
});

export const repairJobSchema = z.object({
  version: z.literal(1),
  incident: z.string().trim().min(8).max(8_000),
  reproduction: z.object({
    command: repairCommandSchema,
    expectedFailure: expectedFailureSchema,
  }).strict(),
  regression: z.object({
    path: relativePathSchema,
    command: repairCommandSchema,
  }).strict(),
  editablePaths: z.array(relativePathSchema).min(1).max(64),
  checks: z.array(repairCheckSchema).min(1).max(16)
    .refine((checks) => checks.some((check) => check.kind === "focused"), {
      message: "At least one focused regression check is required",
    }),
  modelPolicy: repairModelPolicySchema.default({
    pinnedModel: null,
    allowedModels: [],
    allowEscalation: false,
    offline: false,
  }),
}).strict();

export type RepairCommand = z.infer<typeof repairCommandSchema>;
export type RepairCheck = z.infer<typeof repairCheckSchema>;
export type RepairJob = z.infer<typeof repairJobSchema>;

export type RepairStage =
  | "preflight"
  | "reproducing"
  | "diagnosing"
  | "regression-red"
  | "patching"
  | "focused-validation"
  | "full-validation"
  | "independent-verification"
  | "complete"
  | "blocked"
  | "failed"
  | "cancelled"
  | "partially-verified";

export interface CommandEvidence {
  name: string;
  command: string;
  args: string[];
  cwd: string;
  status: "success" | "failed" | "timeout" | "cancelled" | "spawn-error";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  startedAt: string;
  durationMs: number;
}

export interface RepairReport {
  schemaVersion: 1;
  runId: string;
  stage: RepairStage;
  originalFailure: string;
  rootCause: string | null;
  filesChanged: string[];
  regressionTest: string;
  reproduction: CommandEvidence | null;
  regressionRed: CommandEvidence | null;
  focusedTests: CommandEvidence[];
  fullChecks: CommandEvidence[];
  independentVerification: CommandEvidence[];
  unrelatedChanges: string[];
  remainingRisks: string[];
  /** Diagnosis provenance — which provider/model produced the proposal. */
  diagnosis?: { rootCause: string; model: string; providerId: string } | null;
  /**
   * The exact proposed patch set, persisted so an interrupted run can be
   * resumed (`litt repair resume --run <id>`) without re-diagnosing.
   */
  proposedPatches?: unknown[] | null;
  /** Why the run ended before "complete" — provider-blocked vs repair-failed. */
  blockReason?:
    | "billing" | "no-provider" | "offline" | "reproduction" | "proposal" | "approval"
    | "validation" | "interrupted" | "regression-coverage" | "unrelated-changes" | "job-mismatch"
    | null;
  /** SHA-256 of the job the run started with — resume must present the same job. */
  jobDigest?: string;
  startedAt: string;
  updatedAt: string;
}
