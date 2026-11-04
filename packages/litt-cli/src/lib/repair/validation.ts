import { readFile } from "node:fs/promises";
import { repairJobSchema, type RepairJob } from "./contracts.js";

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function validateRepairJob(input: unknown): ValidationResult<RepairJob> {
  const parsed = repairJobSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };

  const error = parsed.error.issues
    .map((issue) => (issue.path.join(".") || "job") + ": " + issue.message)
    .join("; ");
  return { ok: false, error };
}

export async function loadRepairJob(path: string): Promise<ValidationResult<RepairJob>> {
  try {
    const raw = await readFile(path, "utf8");
    if (Buffer.byteLength(raw) > 1_048_576) {
      return { ok: false, error: "Repair job exceeds the 1 MiB input limit" };
    }
    return validateRepairJob(JSON.parse(raw) as unknown);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: "Cannot load repair job: " + message };
  }
}
