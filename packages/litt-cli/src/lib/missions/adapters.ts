import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { MissionStep } from "./contracts.js";

// Stage 1 execution adapters — thin shims over existing infrastructure.
// Each adapter exposes:
//   probe(): idempotency check — returns true when the step's end-state
//            already exists, so a resumed mission never re-dispatches
//            or re-executes completed work.
//   run():   perform the action once.
// Both return evidence strings (redacted, never containing secrets).

const execFileP = promisify(execFile);

export interface AdapterResult {
  ok: boolean;
  evidence: string[];
}

export interface StepAdapter {
  probe(step: MissionStep): Promise<AdapterResult>;
  run(step: MissionStep, deadline: number): Promise<AdapterResult>;
}

function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}

async function gh(args: string[], timeoutMs = 60_000): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout, stderr } = await execFileP("gh", args, { timeout: timeoutMs, maxBuffer: 1 << 20 });
    return { ok: true, out: `${stdout}${stderr}` };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` || (err.message ?? "gh failed") };
  }
}

async function fetchJson(url: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "litt-mission/1" } });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { /* non-json */ }
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

function jsonPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

async function pollUntil(fn: () => Promise<AdapterResult>, deadline: number, intervalMs = 10_000): Promise<AdapterResult> {
  let last: AdapterResult = { ok: false, evidence: ["no attempt"] };
  while (Date.now() < deadline) {
    last = await fn();
    if (last.ok) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

// ─── gh-pr-checks ────────────────────────────────────────────────────
// params: { pr: number|string }
async function prChecksTerminal(step: MissionStep): Promise<AdapterResult> {
  const pr = String(step.params.pr);
  const { ok, out } = await gh(["pr", "checks", pr, "--json", "name,state"]);
  if (!ok) return { ok: false, evidence: [`gh pr checks failed: ${out.slice(0, 200)}`] };
  let checks: { name: string; state: string }[] = [];
  try { checks = JSON.parse(out); } catch { return { ok: false, evidence: ["unparseable checks json"] }; }
  if (checks.length === 0) return { ok: false, evidence: ["no checks reported"] };
  const pending = checks.filter((c) => !/success|fail|error|cancel|neutral|skipped/i.test(c.state));
  const failed = checks.filter((c) => /fail|error|cancel/i.test(c.state));
  if (failed.length > 0) return { ok: false, evidence: [`failed checks: ${failed.map((c) => c.name).join(", ")}`] };
  if (pending.length > 0) return { ok: false, evidence: [`pending: ${pending.map((c) => c.name).join(", ")}`] };
  return { ok: true, evidence: [`all ${checks.length} checks green`] };
}

// ─── gh-workflow-dispatch ────────────────────────────────────────────
// params: { workflow: "file.yml", ref?: string, inputs?: {...} }
// Idempotency: probe polls latest run; if a run for this workflow started
// within the last 10 minutes on the same ref is queued/in_progress, the
// step counts as already dispatched (no duplicate deploy).
async function workflowLatestRun(step: MissionStep): Promise<{ id: number; status: string; conclusion: string | null; createdAt: string } | null> {
  const { ok, out } = await gh(["run", "list", "--workflow", str(step.params.workflow), "--limit", "1", "--json", "databaseId,status,conclusion,createdAt"]);
  if (!ok) return null;
  try { return (JSON.parse(out) as unknown[])[0] as never ?? null; } catch { return null; }
}

// ─── http-check ──────────────────────────────────────────────────────
// params: { url, expectStatus?: number, jsonField?: "a.b.c", expectEquals?: string }
async function httpCheck(step: MissionStep): Promise<AdapterResult> {
  const url = str(step.params.url);
  const expectStatus = typeof step.params.expectStatus === "number" ? step.params.expectStatus : 200;
  try {
    const { status, body } = await fetchJson(url, Math.min(30_000, step.timeoutMs));
    if (status !== expectStatus) return { ok: false, evidence: [`${url} → HTTP ${status} (want ${expectStatus})`] };
    const field = str(step.params.jsonField);
    if (field) {
      const want = str(step.params.expectEquals);
      const got = jsonPath(body, field);
      if (String(got) !== want) return { ok: false, evidence: [`${url} field ${field}="${got}" (want "${want}")`] };
      return { ok: true, evidence: [`${url} ${field}=${got}`] };
    }
    return { ok: true, evidence: [`${url} → ${status}`] };
  } catch (e) {
    return { ok: false, evidence: [`${url} → ${(e as Error).name}: ${(e as Error).message}`.slice(0, 200)] };
  }
}

// ─── run-check ───────────────────────────────────────────────────────
// params: { command: "exe", args?: [...], cwd?: string }
async function runCheck(step: MissionStep, deadline: number): Promise<AdapterResult> {
  const cmd = str(step.params.command);
  const args = Array.isArray(step.params.args) ? (step.params.args as string[]).map(String) : [];
  const cwd = str(step.params.cwd) || undefined;
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      timeout: Math.min(300_000, deadline - Date.now()),
      maxBuffer: 1 << 20,
      cwd,
    });
    return { ok: true, evidence: [`${cmd} exited 0`, `${stdout}${stderr}`.slice(-400)] };
  } catch (e: unknown) {
    const err = e as { code?: number; stderr?: string; message?: string };
    return { ok: false, evidence: [`${cmd} failed (code ${err.code ?? "?"}): ${(err.stderr ?? err.message ?? "").slice(0, 300)}`] };
  }
}

export const adapters: Record<string, StepAdapter> = {
  "gh-pr-checks": {
    probe: (s) => prChecksTerminal(s),
    run: (s, deadline) => pollUntil(() => prChecksTerminal(s), deadline, 15_000),
  },
  "gh-workflow-dispatch": {
    probe: async (s) => {
      const run = await workflowLatestRun(s);
      if (run && /queued|in_progress/i.test(run.status)) {
        return { ok: true, evidence: [`workflow already dispatched (run ${run.id})`] };
      }
      return { ok: false, evidence: ["no active run"] };
    },
    run: async (s, deadline) => {
      const inputs = (s.params.inputs ?? {}) as Record<string, unknown>;
      const args = ["workflow", "run", str(s.params.workflow), "--ref", str(s.params.ref, "main")];
      for (const [k, v] of Object.entries(inputs)) args.push("-f", `${k}=${String(v)}`);
      const res = await gh(args);
      if (!res.ok) return { ok: false, evidence: [`dispatch failed: ${res.out.slice(0, 300)}`] };
      // Then watch latest run to terminal.
      return pollUntil(async () => {
        const run = await workflowLatestRun(s);
        if (!run) return { ok: false, evidence: ["no run visible yet"] };
        if (/completed/i.test(run.status)) {
          return run.conclusion === "success"
            ? { ok: true, evidence: [`run ${run.id} success`] }
            : { ok: false, evidence: [`run ${run.id} conclusion=${run.conclusion}`] };
        }
        return { ok: false, evidence: [`run ${run.id} ${run.status}`] };
      }, deadline, 20_000);
    },
  },
  "gh-run-watch": {
    probe: () => Promise.resolve({ ok: false, evidence: ["always re-watch"] }),
    run: (s, deadline) => pollUntil(async () => {
      const run = await workflowLatestRun(s);
      if (!run) return { ok: false, evidence: ["no run"] };
      if (/completed/i.test(run.status)) {
        return run.conclusion === "success"
          ? { ok: true, evidence: [`run ${run.id} success`] }
          : { ok: false, evidence: [`run ${run.id} ${run.conclusion}`] };
      }
      return { ok: false, evidence: [`run ${run.id} ${run.status}`] };
    }, deadline, 20_000),
  },
  "http-check": {
    probe: (s) => httpCheck(s),
    run: (s, deadline) => pollUntil(() => httpCheck(s), deadline, 10_000),
  },
  "staging-verify-sha": {
    // params: { url: "https://.../api/health", sha: "full-40-hex" }
    probe: (s) => httpCheck({ ...s, params: { url: s.params.url, expectStatus: 200, jsonField: "checks.build.detail", expectEquals: s.params.sha } }),
    run: (s, deadline) => pollUntil(() => httpCheck({ ...s, params: { url: s.params.url, expectStatus: 200, jsonField: "checks.build.detail", expectEquals: s.params.sha } }), deadline, 15_000),
  },
  "run-check": {
    probe: () => Promise.resolve({ ok: false, evidence: ["no probe — will run"] }),
    run: (s, deadline) => runCheck(s, deadline),
  },
  "owner-gate": {
    probe: () => Promise.resolve({ ok: false, evidence: ["requires owner action"] }),
    run: (s) => Promise.resolve({ ok: false, evidence: [`OWNER ACTION REQUIRED: ${s.description}`] }),
  },
  "report": {
    probe: () => Promise.resolve({ ok: false, evidence: ["report always re-emits"] }),
    run: (s) => Promise.resolve({ ok: true, evidence: [`report emitted: ${s.description}`] }),
  },
};
