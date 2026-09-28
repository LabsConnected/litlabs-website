/** Zod contract: command execution spec (terminal/build executors). */
import { z } from "zod";

export const commandSpecSchema = z.object({
  /** Stable identity, e.g. "type-check", "lint", "tests", "build", "node --version". */
  identity: z.string().min(1).max(200),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
  executorId: z.string().min(1).default("terminal-executor"),
});

export const commandResultSchema = z.object({
  identity: z.string().min(1),
  command: z.string().min(1),
  /** Redacted command line (secrets scrubbed) for evidence. */
  sanitizedCommand: z.string().min(1),
  exitCode: z.number().int().nullable(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationMs: z.number().int().nonnegative(),
  /** Redacted stdout (possibly truncated with a marker). */
  stdout: z.string(),
  /** Redacted stderr (possibly truncated with a marker). */
  stderr: z.string(),
  truncated: z.boolean().default(false),
  executorId: z.string().min(1),
  timedOut: z.boolean().default(false),
});

export type CommandSpec = z.infer<typeof commandSpecSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
