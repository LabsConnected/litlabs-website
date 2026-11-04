/**
 * Repair diagnosis — a bounded model call that turns reproduction evidence
 * into a narrowly-scoped contextual patch proposal.
 *
 * Truthfulness rules:
 *  - The proposal is parsed AND schema-validated before any approval is
 *    requested. A model that answers prose, malformed JSON, or out-of-scope
 *    paths is a diagnosis failure (stage=blocked), never a silent apply.
 *  - File contents are secret-redacted before they leave the process.
 *  - The model never executes commands — it only emits a JSON proposal.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { redact } from "../secret-redaction.js";
import { contextPatchSchema, type ContextPatch } from "./patch.js";
import type { CommandEvidence, RepairJob } from "./contracts.js";
import { completeOnce, type RepairProviderHandle } from "./provider.js";

const MAX_FILE_BYTES = 16 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024;
const MAX_FILES = 24;

const proposalSchema = z.object({
  rootCause: z.string().trim().min(8).max(4_000),
  patches: z.array(contextPatchSchema).min(1).max(16),
}).strict();

export interface RepairDiagnosis {
  rootCause: string;
  patches: ContextPatch[];
  model: string;
  providerId: string;
}

export type DiagnosisOutcome =
  | { ok: true; diagnosis: RepairDiagnosis }
  | { ok: false; error: string };

async function collectEditableContent(
  root: string,
  editablePaths: readonly string[],
): Promise<{ path: string; content: string }[]> {
  const files: { path: string; content: string }[] = [];
  let total = 0;
  outer: for (const scope of editablePaths) {
    const base = join(root, scope);
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6 || files.length >= MAX_FILES || total >= MAX_TOTAL_BYTES) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (files.length >= MAX_FILES || total >= MAX_TOTAL_BYTES) return;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".git")) continue;
          await walk(full, depth + 1);
        } else if (entry.isFile()) {
          try {
            const info = await stat(full);
            if (info.size > MAX_FILE_BYTES) continue;
            const raw = await readFile(full, "utf8");
            if (raw.includes("\0")) continue;
            total += raw.length;
            files.push({ path: relative(root, full).replace(/\\/g, "/"), content: redact(raw) });
          } catch {
            // unreadable file — skip, never fail diagnosis on one file
          }
        }
      }
    };
    await walk(base, 0);
    if (files.length >= MAX_FILES || total >= MAX_TOTAL_BYTES) break outer;
  }
  return files;
}

const SYSTEM = [
  "You are the LiTT repair diagnoser. A CLI failure was reproduced with real",
  "command evidence. Propose the smallest correct repair as STRICT JSON only:",
  "",
  '{ "rootCause": "<one paragraph>",',
  '  "patches": [',
  '    { "operation": "replace", "path": "<workspace-relative>",',
  '      "search": "<exact unique text to replace>", "replacement": "<new text>" },',
  '    { "operation": "create", "path": "<workspace-relative>", "content": "<file>" }',
  "  ] }",
  "",
  "Rules:",
  "- Only edit paths inside the declared editable scopes.",
  "- 'search' must appear EXACTLY ONCE in the target file — include enough",
  "  surrounding context to be unique.",
  "- Do not propose changes outside the reproduced failure's blast radius.",
  "- No markdown fences, no commentary — one JSON object and nothing else.",
].join("\n");

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Diagnosis contained no JSON object");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function diagnoseFailure(
  root: string,
  job: RepairJob,
  reproduction: CommandEvidence,
  handle: RepairProviderHandle,
  abortSignal?: AbortSignal,
): Promise<DiagnosisOutcome> {
  const editable = await collectEditableContent(root, job.editablePaths);
  if (editable.length === 0) {
    return { ok: false, error: "Editable scopes contain no readable files to diagnose" };
  }

  const fileBlock = editable
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n");
  const user = [
    `Incident: ${job.incident}`,
    "",
    `Reproduction command: ${reproduction.command} ${reproduction.args.join(" ")}`,
    `Exit: ${reproduction.exitCode} (${reproduction.status}), ${reproduction.durationMs}ms`,
    `stdout (tail): ${reproduction.stdout.slice(-2_000)}`,
    `stderr (tail): ${reproduction.stderr.slice(-2_000)}`,
    "",
    "Editable scopes: " + job.editablePaths.join(", "),
    "Regression test to create or update: " + job.regression.path,
    "",
    "Workspace files inside editable scopes:",
    fileBlock,
  ].join("\n");

  let result;
  try {
    result = await completeOnce(
      handle,
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
      abortSignal,
    );
  } catch (error) {
    return {
      ok: false,
      error: "Repair model call failed: " + (error instanceof Error ? error.message : String(error)),
    };
  }

  let parsed;
  try {
    parsed = proposalSchema.safeParse(extractJson(result.content));
  } catch (error) {
    return {
      ok: false,
      error: "Diagnosis did not produce valid JSON: " + (error instanceof Error ? error.message : String(error)),
    };
  }
  if (!parsed.success) {
    return {
      ok: false,
      error: "Diagnosis proposal failed schema validation: " +
        parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message).join("; "),
    };
  }
  return {
    ok: true,
    diagnosis: {
      rootCause: parsed.data.rootCause,
      patches: parsed.data.patches,
      model: result.model,
      providerId: result.providerId,
    },
  };
}
