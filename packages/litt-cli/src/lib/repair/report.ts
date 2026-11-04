import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RepairJob, RepairReport } from "./contracts.js";

/** Stable fingerprint of a parsed job so a resume can prove it is running the same job. */
export function digestRepairJob(job: RepairJob): string {
  return createHash("sha256").update(JSON.stringify(job)).digest("hex");
}

export function createRepairReport(job: RepairJob, runId: string): RepairReport {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    runId,
    stage: "preflight",
    jobDigest: digestRepairJob(job),
    originalFailure: job.incident,
    rootCause: null,
    filesChanged: [],
    regressionTest: job.regression.path,
    reproduction: null,
    regressionRed: null,
    focusedTests: [],
    fullChecks: [],
    independentVerification: [],
    unrelatedChanges: [],
    remainingRisks: [],
    startedAt: now,
    updatedAt: now,
  };
}

export function repairReportPath(cwd: string, runId: string): string {
  return join(cwd, ".litt", "repairs", runId, "report.json");
}

export async function readRepairReport(path: string): Promise<RepairReport | null> {
  const { readFile } = await import("node:fs/promises");
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as RepairReport;
    if (parsed.schemaVersion !== 1 || typeof parsed.runId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeRepairReport(path: string, report: RepairReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = path + ".tmp-" + process.pid;
  const serialized = JSON.stringify({ ...report, updatedAt: new Date().toISOString() }, null, 2);
  await writeFile(temporaryPath, serialized + "\n", { encoding: "utf8", flag: "w" });
  await rename(temporaryPath, path);
}

export function formatRepairReport(report: RepairReport): string {
  const checkStatus = (checks: RepairReport["fullChecks"]): string => {
    if (checks.length === 0) return "NOT RUN";
    return checks.every((check) => check.status === "success") ? "PASS" : "FAIL";
  };
  return [
    "LiTT repair " + report.runId,
    "Status: " + report.stage.toUpperCase(),
    "Original failure: " + report.originalFailure,
    "Root cause: " + (report.rootCause ?? "not established"),
    "Files changed: " + (report.filesChanged.join(", ") || "none"),
    "Regression test: " + report.regressionTest,
    "Focused tests: " + checkStatus(report.focusedTests),
    "Full checks: " + checkStatus(report.fullChecks),
    "Independent verification: " + checkStatus(report.independentVerification),
    "Unrelated changes: " + (report.unrelatedChanges.join(", ") || "none"),
    "Remaining risks: " + (report.remainingRisks.join("; ") || "none"),
  ].join("\n");
}
