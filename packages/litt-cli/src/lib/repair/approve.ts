/**
 * Repair approval gate — a repair is NEVER applied without an explicit
 * operator decision.
 *
 *  --yes            → pre-authorized non-interactive apply (scripted runs,
 *                     tests, the repair's own resume flow)
 *  interactive TTY  → y/N prompt with the proposed patch surface shown
 *  neither          → "unavailable": the run parks at partially-verified and
 *                     `litt repair resume --run <id> --yes` continues it.
 *
 * A declined answer is a real outcome (stage=cancelled), not an error.
 */
import * as readline from "node:readline/promises";
import { redact } from "../secret-redaction.js";
import type { ContextPatch } from "./patch.js";

export type ApprovalOutcome = "approved" | "declined" | "unavailable";

export interface ApprovalRequest {
  assumeYes: boolean;
  isTTY: boolean;
  rootCause: string;
  patches: ContextPatch[];
}

const PREVIEW_CHARS = 400;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Approval must show the bytes that will be written, not just how many. */
function preview(text: string): string {
  const safe = redact(text).replace(CONTROL_CHARACTERS, "?");
  const clipped = safe.length > PREVIEW_CHARS
    ? safe.slice(0, PREVIEW_CHARS) + "… (+" + (safe.length - PREVIEW_CHARS) + " chars)"
    : safe;
  return clipped.split(/\r?\n/).map((line) => "      " + line).join("\n");
}

export function formatPatchSummary(patches: ContextPatch[]): string {
  return patches
    .map((patch) => {
      if (patch.operation === "create") {
        return `  + create ${patch.path} (${patch.content.length} bytes)\n${preview(patch.content)}`;
      }
      return [
        `  ~ replace in ${patch.path} (search ${patch.search.length} bytes)`,
        "    - remove:",
        preview(patch.search),
        "    + insert:",
        preview(patch.replacement),
      ].join("\n");
    })
    .join("\n");
}

export async function requestRepairApproval(request: ApprovalRequest): Promise<ApprovalOutcome> {
  if (request.assumeYes) return "approved";
  if (!request.isTTY) return "unavailable";

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("\nProposed repair:");
    console.log("Root cause: " + request.rootCause);
    console.log(formatPatchSummary(request.patches));
    const answer = await rl.question("Apply these patches? [y/N]: ");
    return answer.trim().toLowerCase() === "y" ? "approved" : "declined";
  } finally {
    rl.close();
  }
}
