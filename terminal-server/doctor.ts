/**
 * Doctor — health check probes for the LiTT runtime.
 *
 * /doctor        — fast health check (runtime alive, env configured)
 * /doctor --deep — full probes, each with its OWN timeout.
 *
 * One hanging probe must never hang /doctor --deep.
 * Each probe is independently bounded via Promise.race + AbortSignal.timeout.
 *
 * Probe statuses: PASS | WARN | FAIL | TIMEOUT | SKIP
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { CommandContext, CommandResponse } from "./command-registry.js";
import { getRuntimeState } from "./runtime.js";
import { redactSecrets, redactEnvValues } from "./command-registry.js";

// ─── Types ────────────────────────────────────────────────────────

export type ProbeStatus = "PASS" | "WARN" | "FAIL" | "TIMEOUT" | "SKIP";

export interface ProbeResult {
  name: string;
  status: ProbeStatus;
  durationMs: number;
  reason: string;
  /** Optional detail (redacted) */
  detail?: string;
}

export interface DoctorResult {
  deep: boolean;
  probes: ProbeResult[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
    timeout: number;
    skip: number;
    total: number;
  };
  overall: ProbeStatus;
  durationMs: number;
}

// ─── Timeout utility ──────────────────────────────────────────────

/**
 * Run a probe with an individual timeout.
 * If the probe exceeds its timeout, returns a TIMEOUT result — never hangs.
 */
async function runProbe(
  name: string,
  timeoutMs: number,
  fn: () => Promise<Omit<ProbeResult, "name" | "durationMs">>,
): Promise<ProbeResult> {
  const t0 = Date.now();
  try {
    // Race the probe against a timeout promise
    const result = await Promise.race([
      fn(),
      new Promise<Omit<ProbeResult, "name" | "durationMs">>((resolve) => {
        setTimeout(() => {
          resolve({
            status: "TIMEOUT",
            reason: `Probe exceeded ${timeoutMs}ms timeout`,
          });
        }, timeoutMs);
      }),
    ]);
    return {
      name,
      durationMs: Date.now() - t0,
      ...result,
    };
  } catch (err) {
    return {
      name,
      status: "FAIL",
      durationMs: Date.now() - t0,
      reason: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
  }
}

// ─── Individual probes ────────────────────────────────────────────

/** Probe 1: Runtime responsiveness — can we get a runtime state snapshot? */
async function probeRuntime(): Promise<Omit<ProbeResult, "name" | "durationMs">> {
  const state = getRuntimeState();
  if (!state) {
    return { status: "FAIL", reason: "RuntimeStore returned no state" };
  }
  return {
    status: "PASS",
    reason: `Runtime alive, online=${state.online}, phase=${state.phase}`,
  };
}

/** Probe 2: Filesystem/workspace — is the cwd accessible? */
async function probeFilesystem(ctx: CommandContext): Promise<Omit<ProbeResult, "name" | "durationMs">> {
  try {
    const stats = fs.statSync(ctx.cwd);
    if (!stats.isDirectory()) {
      return { status: "FAIL", reason: `cwd is not a directory: ${ctx.cwd}` };
    }
    // Check read access
    fs.accessSync(ctx.cwd, fs.constants.R_OK);
    // Check if package.json exists (project marker)
    const hasPkg = fs.existsSync(path.join(ctx.cwd, "package.json"));
    return {
      status: "PASS",
      reason: `Workspace accessible${hasPkg ? " (package.json found)" : " (no package.json)"}`,
    };
  } catch (err) {
    return {
      status: "FAIL",
      reason: `Cannot access cwd: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Probe 3: Git — is this a git repo? Is git available? */
async function probeGit(ctx: CommandContext): Promise<Omit<ProbeResult, "name" | "durationMs">> {
  return new Promise((resolve) => {
    execFile("git", ["rev-parse", "--is-inside-work-tree"], { cwd: ctx.cwd, timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve({ status: "WARN", reason: "Not a git repository or git not available" });
        return;
      }
      const isRepo = stdout.trim() === "true";
      if (!isRepo) {
        resolve({ status: "WARN", reason: "Not inside a git work tree" });
        return;
      }
      // Get branch
      execFile("git", ["branch", "--show-current"], { cwd: ctx.cwd, timeout: 5000 }, (err2, branchOut) => {
        const branch = err2 ? "unknown" : branchOut.trim();
        resolve({ status: "PASS", reason: `Git repo, branch=${branch}` });
      });
    });
  });
}

/** Probe 4: Shell execution — can we run a trivial command? */
async function probeShell(): Promise<Omit<ProbeResult, "name" | "durationMs">> {
  return new Promise((resolve) => {
    const cmd = process.platform === "win32" ? "cmd" : "echo";
    const args = process.platform === "win32" ? ["/c", "echo", "ok"] : ["ok"];
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve({ status: "FAIL", reason: `Shell execution failed: ${err.message}` });
        return;
      }
      const output = stdout.trim();
      if (output === "ok") {
        resolve({ status: "PASS", reason: "Shell execution works" });
      } else {
        resolve({ status: "WARN", reason: `Shell returned unexpected output: "${output}"` });
      }
    });
  });
}

/** Probe 5: Event loop responsiveness — can we resolve a microtask quickly? */
async function probeEventLoop(): Promise<Omit<ProbeResult, "name" | "durationMs">> {
  const t0 = Date.now();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const elapsed = Date.now() - t0;
  // If setImmediate took more than 100ms, the event loop is congested
  if (elapsed > 100) {
    return { status: "WARN", reason: `Event loop delayed ${elapsed}ms` };
  }
  return { status: "PASS", reason: `Event loop responsive (${elapsed}ms)` };
}

/** Probe 6: Provider configuration — are LLM API keys set? */
async function probeProviderConfig(): Promise<Omit<ProbeResult, "name" | "durationMs">> {
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasOllama = !!process.env.OLLAMA_BASE_URL || true; // Ollama defaults to localhost
  const providers: string[] = [];
  if (hasOpenRouter) providers.push("OpenRouter");
  if (hasOllama) providers.push("Ollama(default)");

  if (providers.length === 0) {
    return { status: "FAIL", reason: "No LLM provider configured" };
  }
  if (!hasOpenRouter) {
    return { status: "WARN", reason: `Providers: ${providers.join(", ")} (OpenRouter key not set — fallback only)` };
  }
  return { status: "PASS", reason: `Providers: ${providers.join(", ")}` };
}

/** Probe 7: Environment/configuration — are required env vars set? */
async function probeEnvironment(): Promise<Omit<ProbeResult, "name" | "durationMs">> {
  const required = [
    "TERMINAL_AUTH_SECRET",
    "TERMINAL_INTERNAL_SERVICE_KEY",
  ];
  const missing: string[] = [];
  const short: string[] = [];
  for (const v of required) {
    const val = process.env[v];
    if (!val) {
      missing.push(v);
    } else if (val.length < 32) {
      short.push(v);
    }
  }
  if (missing.length > 0) {
    return { status: "FAIL", reason: `Missing env vars: ${missing.join(", ")}` };
  }
  if (short.length > 0) {
    return { status: "WARN", reason: `Env vars too short (<32): ${short.join(", ")}` };
  }
  return { status: "PASS", reason: "Required env vars configured" };
}

/** Probe 8: Network/provider reachability — can we reach the LLM provider? */
async function probeNetwork(): Promise<Omit<ProbeResult, "name" | "durationMs">> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    return { status: "SKIP", reason: "OPENROUTER_API_KEY not set — skipping network probe" };
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return { status: "PASS", reason: "OpenRouter reachable" };
    }
    return { status: "WARN", reason: `OpenRouter responded ${res.status}` };
  } catch (err) {
    return {
      status: "WARN",
      reason: `OpenRouter unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Probe 9: Disk space — is there adequate free space in the workspace? */
async function probeDiskSpace(ctx: CommandContext): Promise<Omit<ProbeResult, "name" | "durationMs">> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      execFile("fsutil", ["volume", "diskfree", ctx.cwd], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve({ status: "SKIP", reason: "fsutil not available" });
          return;
        }
        resolve({ status: "PASS", reason: "Disk space query succeeded", detail: redactSecrets(stdout.trim()) });
      });
    } else {
      execFile("df", ["-h", ctx.cwd], { timeout: 5000 }, (err, stdout) => {
        if (err) {
          resolve({ status: "SKIP", reason: "df not available" });
          return;
        }
        resolve({ status: "PASS", reason: "Disk space query succeeded", detail: redactSecrets(stdout.trim()) });
      });
    }
  });
}

// ─── Fast doctor (/doctor) ────────────────────────────────────────

/**
 * Fast health check — runs only the essential probes:
 * runtime, shell, provider config, environment.
 */
export async function runDoctor(ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();

  const probes = await Promise.all([
    runProbe("runtime", 3000, probeRuntime),
    runProbe("shell", 5000, probeShell),
    runProbe("provider_config", 2000, probeProviderConfig),
    runProbe("environment", 2000, probeEnvironment),
  ]);

  const result = buildDoctorResult(false, probes, t0);
  return {
    kind: "doctor",
    ok: result.overall !== "FAIL",
    data: result,
    durationMs: Date.now() - t0,
    message: formatDoctorSummary(result),
  };
}

// ─── Deep doctor (/doctor --deep) ─────────────────────────────────

/**
 * Full health check — runs ALL probes, each with its own timeout.
 * One hanging probe cannot hang the overall check.
 */
export async function runDoctorDeep(ctx: CommandContext): Promise<CommandResponse> {
  const t0 = Date.now();

  // Run all probes in parallel — each independently bounded
  const probes = await Promise.all([
    runProbe("runtime", 3000, probeRuntime),
    runProbe("filesystem", 3000, () => probeFilesystem(ctx)),
    runProbe("git", 5000, () => probeGit(ctx)),
    runProbe("shell", 5000, probeShell),
    runProbe("event_loop", 2000, probeEventLoop),
    runProbe("provider_config", 2000, probeProviderConfig),
    runProbe("environment", 2000, probeEnvironment),
    runProbe("network", 8000, probeNetwork),
    runProbe("disk_space", 5000, () => probeDiskSpace(ctx)),
  ]);

  const result = buildDoctorResult(true, probes, t0);
  return {
    kind: "doctor",
    ok: result.overall !== "FAIL",
    data: result,
    durationMs: Date.now() - t0,
    message: formatDoctorSummary(result),
  };
}

// ─── Result builders ──────────────────────────────────────────────

function buildDoctorResult(deep: boolean, probes: ProbeResult[], t0: number): DoctorResult {
  const summary = {
    pass: probes.filter((p) => p.status === "PASS").length,
    warn: probes.filter((p) => p.status === "WARN").length,
    fail: probes.filter((p) => p.status === "FAIL").length,
    timeout: probes.filter((p) => p.status === "TIMEOUT").length,
    skip: probes.filter((p) => p.status === "SKIP").length,
    total: probes.length,
  };

  let overall: ProbeStatus = "PASS";
  if (summary.fail > 0) overall = "FAIL";
  else if (summary.timeout > 0) overall = "FAIL";
  else if (summary.warn > 0) overall = "WARN";

  return {
    deep,
    probes,
    summary,
    overall,
    durationMs: Date.now() - t0,
  };
}

function formatDoctorSummary(result: DoctorResult): string {
  const s = result.summary;
  const label = result.deep ? "Doctor (deep)" : "Doctor";
  let text = `${label}: ${result.overall} — ${s.pass} pass, ${s.warn} warn, ${s.fail} fail, ${s.timeout} timeout, ${s.skip} skip (${result.durationMs}ms)`;
  for (const p of result.probes) {
    text += `\n  ${p.status.padEnd(7)} ${p.name} (${p.durationMs}ms) — ${p.reason}`;
  }
  return redactSecrets(text);
}

// ─── Deep probe definitions (for introspection/testing) ───────────

export interface ProbeDef {
  name: string;
  timeoutMs: number;
  description: string;
}

export const DEEP_PROBES: ProbeDef[] = [
  { name: "runtime", timeoutMs: 3000, description: "RuntimeStore state snapshot" },
  { name: "filesystem", timeoutMs: 3000, description: "Workspace cwd accessibility" },
  { name: "git", timeoutMs: 5000, description: "Git repo detection + branch" },
  { name: "shell", timeoutMs: 5000, description: "Trivial shell command execution" },
  { name: "event_loop", timeoutMs: 2000, description: "Event loop responsiveness" },
  { name: "provider_config", timeoutMs: 2000, description: "LLM provider key configuration" },
  { name: "environment", timeoutMs: 2000, description: "Required env vars set" },
  { name: "network", timeoutMs: 8000, description: "LLM provider reachability" },
  { name: "disk_space", timeoutMs: 5000, description: "Workspace disk space" },
];

export const FAST_PROBES: ProbeDef[] = [
  { name: "runtime", timeoutMs: 3000, description: "RuntimeStore state snapshot" },
  { name: "shell", timeoutMs: 5000, description: "Trivial shell command execution" },
  { name: "provider_config", timeoutMs: 2000, description: "LLM provider key configuration" },
  { name: "environment", timeoutMs: 2000, description: "Required env vars set" },
];
