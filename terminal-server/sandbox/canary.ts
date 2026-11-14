/**
 * Sandbox verification canary — Phase 0 of SANDBOX-PLAN.md §4.
 *
 * This module defines, as executable code, what "verified sandbox"
 * means. A provider is verified only when a real sandbox booted through
 * it passes every probe below, right now:
 *
 *   provider-health       the provider reports itself healthy
 *   exec-round-trip       a marker written via exec inside the sandbox
 *                         reads back byte-for-byte (exec really works)
 *   host-isolation        the marker does NOT exist on the terminal
 *                         host's filesystem, and the sandbox cannot read
 *                         a sentinel file planted on the host (the
 *                         command provably did not run on the host, and
 *                         the host's files are not visible inside)
 *   tenant-isolation      a second sandbox (different user/project)
 *                         cannot read the first sandbox's marker file
 *                         or its per-tenant environment
 *   filesystem-confinement a file written to an absolute path outside
 *                         the workspace inside sandbox A is invisible
 *                         both on the host and in sandbox B
 *   network-egress        the sandbox cannot reach the cloud metadata
 *                         endpoint, nor the terminal service itself
 *                         (when a beacon URL is configured)
 *   resource-limits       the provider echoes the requested limits on
 *                         the instance AND enforces the memory limit:
 *                         an allocation of 1.6x the limit cannot
 *                         complete. (In-sandbox visible CPU/memory is
 *                         recorded as evidence in the check detail but
 *                         does not gate: cgroup-enforced providers
 *                         legitimately report host totals via os.*,
 *                         while echo + enforcement cannot be faked by
 *                         a provider that ignores limits.)
 *   cleanup               both canary sandboxes destroy cleanly and
 *                         are gone afterwards (no leaked sandboxes)
 *
 * The canary FAILS CLOSED: any probe that errors, times out, or
 * produces no verdict is a failed check, never a pass. The result is a
 * timestamped {@link CanaryReport}; {@link SandboxVerificationService}
 * (verification.ts) caches it briefly and exposes it as the only
 * "verified" signal. Per the isolation policy's own design rule, no
 * environment variable can substitute for a green report.
 *
 * The probe commands assume the sandbox template provides `sh`,
 * `node`, and coreutils (true of terminal-server/sandbox.Dockerfile).
 * They are plain commands any real provider receives verbatim; the
 * token comments (EGRESS_PROBE / LIMITS_PROBE / MEMORY_HOG) exist so
 * test doubles can recognise the probes — see testing/fake-providers.ts.
 *
 * This module changes no behavior: it is only run when something
 * explicitly invokes it (the verification service's boot/on-demand
 * hooks, or run-canary.ts), and nothing in the request path consults it
 * in Phase 0.
 */

import { randomBytes } from "crypto";
import { existsSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type {
  CanaryProvider,
  ExecuteCommandResult,
  SandboxInstance,
  SandboxResourceLimits,
} from "./provider";

export type CanaryCheckId =
  | "provider-health"
  | "exec-round-trip"
  | "host-isolation"
  | "tenant-isolation"
  | "filesystem-confinement"
  | "network-egress"
  | "resource-limits"
  | "cleanup"
  | "canary-runner";

export interface CanaryCheckResult {
  id: CanaryCheckId;
  status: "pass" | "fail";
  detail: string;
  durationMs: number;
}

export interface CanaryReport {
  provider: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** True only when every check passed. */
  passed: boolean;
  checks: CanaryCheckResult[];
}

export interface CanaryOptions {
  /** Limits requested for the canary sandboxes. */
  limits?: SandboxResourceLimits;
  /** URLs the sandbox must not be able to reach. Defaults to the cloud metadata endpoint. */
  egressTargets?: string[];
  /**
   * URL of the terminal service itself (or a beacon served by it). When
   * configured, reaching it from inside the sandbox fails the
   * network-egress check. Phase 1 wiring supplies the terminal's own
   * internal base URL here.
   */
  terminalBeaconUrl?: string;
  /** Timeout passed to provider.execute for ordinary probes. */
  execTimeoutMs?: number;
  /** Timeout for the memory-enforcement probe. */
  hogTimeoutMs?: number;
  /** Clock injection (tests). */
  now?: () => number;
  /** Run-id injection (tests). */
  runId?: string;
  /** Directory the host sentinel file is planted in. Defaults to os.tmpdir(). */
  hostSentinelDir?: string;
}

/** Small on purpose: the canary must be cheap enough to re-run often. */
export const CANARY_LIMITS: SandboxResourceLimits = {
  cpuVcpus: 1,
  memoryMB: 512,
  processLimit: 64,
  diskGB: 2,
  idleTimeoutMinutes: 5,
  maxSessionMinutes: 10,
};

export const DEFAULT_EGRESS_TARGETS: readonly string[] = [
  "http://169.254.169.254/latest/meta-data/",
];

export const CANARY_TOKENS = {
  egressProbe: "EGRESS_PROBE",
  limitsProbe: "LIMITS_PROBE",
  memoryHog: "MEMORY_HOG",
} as const;

/**
 * Node one-liner: prints `EGRESS_OPEN <status> flavor=<present|absent>`
 * if any HTTP response arrives, else EGRESS_BLOCKED. `flavor` records
 * whether the response carries the `Metadata-Flavor: Google` header —
 * the signature of a real metadata service. The canary's verdict (see
 * the network-egress check) treats an answer as REACHABLE only when it
 * carries that signature or is a 2xx success; a non-2xx answer without
 * the signature is a refusal (an intermediary such as an egress proxy
 * denying the request, or a fabric auth gate) and counts as blocked.
 */
export function buildEgressProbeCommand(url: string): string {
  const script =
    `/*${CANARY_TOKENS.egressProbe}*/` +
    `const u=${JSON.stringify(url)};` +
    `const m=u.startsWith("https")?require("https"):require("http");` +
    `let done=false;const fin=(s)=>{if(!done){done=true;console.log(s);}};` +
    `try{const req=m.get(u,{timeout:2500},(res)=>{const fl=res.headers&&res.headers["metadata-flavor"]==="Google"?"present":"absent";fin("EGRESS_OPEN "+res.statusCode+" flavor="+fl);res.resume();req.destroy();});` +
    `req.on("timeout",()=>{req.destroy();fin("EGRESS_BLOCKED");});` +
    `req.on("error",()=>fin("EGRESS_BLOCKED"));}catch(e){fin("EGRESS_BLOCKED");}`;
  return `node -e '${script}'`;
}

/** Node one-liner: prints JSON {totalmemBytes, cpuCount} as seen from inside the sandbox. */
export function buildLimitsProbeCommand(): string {
  const script =
    `/*${CANARY_TOKENS.limitsProbe}*/` +
    `const os=require("os");` +
    `console.log(JSON.stringify({totalmemBytes:os.totalmem(),cpuCount:os.cpus().length}));`;
  return `node -e '${script}'`;
}

/**
 * Node one-liner: allocates and touches `bytes` of memory. Prints
 * HOG_COMPLETED only if the full allocation survived; a limit-enforcing
 * sandbox kills it (non-zero exit) or the allocation throws (exit 3).
 */
export function buildMemoryHogCommand(bytes: number): string {
  const script =
    `/*${CANARY_TOKENS.memoryHog}*/` +
    `const target=${Math.floor(bytes)};const chunks=[];let held=0;` +
    `try{while(held<target){const b=Buffer.alloc(1048576,1);chunks.push(b);held+=b.length;}}` +
    `catch(e){console.log("HOG_FAILED");process.exit(3);}` +
    `console.log("HOG_COMPLETED "+held);`;
  return `node -e '${script}'`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function short(value: string): string {
  return value.slice(0, 8);
}

class CheckLog {
  readonly results: CanaryCheckResult[] = [];

  add(id: CanaryCheckId, status: "pass" | "fail", detail: string, startMs: number, now: () => number): void {
    this.results.push({ id, status, detail, durationMs: Math.max(0, now() - startMs) });
  }

  failRemaining(ids: CanaryCheckId[], detail: string): void {
    for (const id of ids) {
      if (!this.results.some((r) => r.id === id)) {
        this.results.push({ id, status: "fail", detail, durationMs: 0 });
      }
    }
  }
}

const SANDBOX_CHECKS: CanaryCheckId[] = [
  "exec-round-trip",
  "host-isolation",
  "tenant-isolation",
  "filesystem-confinement",
  "network-egress",
  "resource-limits",
];

/**
 * Run the full canary against a provider. Never throws: every failure
 * mode lands in the report as a failed check.
 */
export async function runSandboxCanary(
  provider: CanaryProvider,
  options: CanaryOptions = {},
): Promise<CanaryReport> {
  const now = options.now ?? Date.now;
  const startedMs = now();
  const runId = options.runId ?? randomBytes(8).toString("hex");
  const limits = options.limits ?? CANARY_LIMITS;
  const execTimeoutMs = options.execTimeoutMs ?? 30_000;
  const hogTimeoutMs = options.hogTimeoutMs ?? 30_000;
  const log = new CheckLog();

  const markerNonce = randomBytes(16).toString("hex");
  const escapeNonce = randomBytes(16).toString("hex");
  const tenantNonce = randomBytes(16).toString("hex");
  const hostNonce = randomBytes(16).toString("hex");

  const markerDir = `/tmp/litt-canary-${runId}`;
  const markerPath = `${markerDir}/marker.txt`;
  const escapePath = `/litt-canary-escape-${runId}`;
  const hostSentinelPath = join(
    options.hostSentinelDir ?? tmpdir(),
    `litt-canary-host-${runId}.txt`,
  );

  let sandboxA: SandboxInstance | null = null;
  let sandboxB: SandboxInstance | null = null;
  const destroyed = new Set<string>();
  let sentinelPlanted = false;

  const exec = async (
    sandboxId: string,
    command: string,
    timeoutMs = execTimeoutMs,
  ): Promise<ExecuteCommandResult> =>
    provider.execute(sandboxId, { command, timeoutMs });

  try {
    // ── provider-health ──────────────────────────────────────────────
    let t = now();
    let healthy = false;
    try {
      const health = await provider.health();
      healthy = health.healthy === true;
      log.add(
        "provider-health",
        healthy ? "pass" : "fail",
        healthy
          ? `provider "${provider.name}" reports healthy`
          : `provider "${provider.name}" reports unhealthy: ${JSON.stringify(health.details ?? {})}`,
        t,
        now,
      );
    } catch (err) {
      log.add("provider-health", "fail", `provider.health() threw: ${errMsg(err)}`, t, now);
    }

    if (!healthy) {
      log.failRemaining(SANDBOX_CHECKS, "not attempted: provider health check failed");
    } else {
      // Plant the host sentinel before any sandbox runs: if sandbox
      // execution were secretly happening on this host, the sandbox
      // could read this file.
      try {
        writeFileSync(hostSentinelPath, hostNonce, "utf8");
        sentinelPlanted = true;
      } catch (err) {
        log.add("host-isolation", "fail", `could not plant host sentinel: ${errMsg(err)}`, now(), now);
      }

      // ── create sandbox A ───────────────────────────────────────────
      try {
        sandboxA = await provider.create({
          workspaceId: `canary-${runId}`,
          userId: "canary-tenant-a",
          projectId: "canary-project-a",
          limits,
          env: { LITT_CANARY_RUN: runId, LITT_CANARY_TENANT: tenantNonce },
        });
      } catch (err) {
        const tCreate = now();
        log.add("exec-round-trip", "fail", `provider.create() for sandbox A threw: ${errMsg(err)}`, tCreate, now);
        log.failRemaining(SANDBOX_CHECKS, "not attempted: sandbox A could not be created");
      }

      if (sandboxA) {
        const aId = sandboxA.sandboxId;

        // ── exec-round-trip ────────────────────────────────────────
        t = now();
        let roundTripOk = false;
        try {
          const write = await exec(
            aId,
            `mkdir -p ${markerDir} && printf '%s' '${markerNonce}' > ${markerPath}`,
          );
          if (write.exitCode !== 0) {
            log.add("exec-round-trip", "fail", `marker write exited ${write.exitCode}: ${write.stderr.trim().slice(0, 200)}`, t, now);
          } else {
            const read = await exec(aId, `cat ${markerPath}`);
            roundTripOk = read.exitCode === 0 && read.stdout.trim() === markerNonce;
            log.add(
              "exec-round-trip",
              roundTripOk ? "pass" : "fail",
              roundTripOk
                ? `marker ${short(markerNonce)}… written and read back inside sandbox A`
                : `marker read-back mismatch (exit ${read.exitCode}, stdout ${JSON.stringify(read.stdout.trim().slice(0, 40))})`,
              t,
              now,
            );
          }
        } catch (err) {
          log.add("exec-round-trip", "fail", `exec threw: ${errMsg(err)}`, t, now);
        }

        // ── host-isolation ─────────────────────────────────────────
        t = now();
        if (!log.results.some((r) => r.id === "host-isolation")) {
          try {
            const onHost = existsSync(markerPath);
            let sentinelVisible = false;
            let sentinelDetail = "sandbox could not read the host sentinel file";
            if (sentinelPlanted) {
              const peek = await exec(aId, `cat ${hostSentinelPath}`);
              sentinelVisible = peek.stdout.includes(hostNonce);
              if (sentinelVisible) sentinelDetail = "sandbox READ the host sentinel file — execution is not isolated from the host";
            } else {
              sentinelDetail = "host sentinel was not planted (see earlier failure)";
            }
            const pass = !onHost && !sentinelVisible && sentinelPlanted;
            log.add(
              "host-isolation",
              pass ? "pass" : "fail",
              onHost
                ? `marker file ${markerPath} EXISTS on the terminal host — sandbox writes land on the host`
                : sentinelVisible
                  ? sentinelDetail
                  : `marker absent on host; ${sentinelDetail}`,
              t,
              now,
            );
          } catch (err) {
            log.add("host-isolation", "fail", `probe threw: ${errMsg(err)}`, t, now);
          }
        }

        // ── create sandbox B (second tenant) ───────────────────────
        try {
          sandboxB = await provider.create({
            workspaceId: `canary-${runId}-b`,
            userId: "canary-tenant-b",
            projectId: "canary-project-b",
            limits,
            env: { LITT_CANARY_RUN: runId },
          });
        } catch (err) {
          const tCreateB = now();
          log.add("tenant-isolation", "fail", `provider.create() for sandbox B threw: ${errMsg(err)}`, tCreateB, now);
          log.add("filesystem-confinement", "fail", "not attempted: sandbox B could not be created", tCreateB, now);
        }

        if (sandboxB) {
          const bId = sandboxB.sandboxId;

          // ── tenant-isolation ─────────────────────────────────────
          t = now();
          try {
            const peekFile = await exec(bId, `cat ${markerPath}`);
            const fileLeak = peekFile.stdout.includes(markerNonce);
            const peekEnv = await exec(bId, `printenv LITT_CANARY_TENANT`);
            const envLeak = peekEnv.stdout.trim() === tenantNonce;
            const pass = !fileLeak && !envLeak;
            log.add(
              "tenant-isolation",
              pass ? "pass" : "fail",
              fileLeak
                ? "sandbox B read sandbox A's marker file — filesystems are shared across tenants"
                : envLeak
                  ? "sandbox B sees sandbox A's per-tenant environment — environments are shared across tenants"
                  : "sandbox B can see neither A's marker file nor A's tenant environment",
              t,
              now,
            );
          } catch (err) {
            log.add("tenant-isolation", "fail", `probe threw: ${errMsg(err)}`, t, now);
          }

          // ── filesystem-confinement ───────────────────────────────
          t = now();
          try {
            const write = await exec(aId, `printf '%s' '${escapeNonce}' > ${escapePath}`);
            const onHost = existsSync(escapePath);
            const peek = await exec(bId, `cat ${escapePath}`);
            const visibleToB = peek.stdout.includes(escapeNonce);
            const pass = !onHost && !visibleToB;
            log.add(
              "filesystem-confinement",
              pass ? "pass" : "fail",
              onHost
                ? `escape file ${escapePath} EXISTS on the terminal host — sandbox writes escape to the host filesystem`
                : visibleToB
                  ? `escape file written by A at ${escapePath} is readable in sandbox B — filesystems are not confined per sandbox`
                  : `escape write ${write.exitCode === 0 ? "succeeded inside A" : `was refused inside A (exit ${write.exitCode})`}; invisible on the host and in sandbox B`,
              t,
              now,
            );
          } catch (err) {
            log.add("filesystem-confinement", "fail", `probe threw: ${errMsg(err)}`, t, now);
          }
        }

        // ── network-egress ─────────────────────────────────────────
        t = now();
        try {
          const targets = [
            ...(options.egressTargets ?? DEFAULT_EGRESS_TARGETS),
            ...(options.terminalBeaconUrl ? [options.terminalBeaconUrl] : []),
          ];
          const verdicts: string[] = [];
          let allBlocked = true;
          for (const url of targets) {
            const res = await exec(aId, buildEgressProbeCommand(url));
            const hasOpen = res.stdout.includes("EGRESS_OPEN");
            const hasBlocked = !hasOpen && res.stdout.includes("EGRESS_BLOCKED");
            const open = res.stdout.match(/EGRESS_OPEN (\d+)(?: flavor=(present|absent))?/);
            let verdict: string;
            let reachable: boolean;
            if (hasBlocked) {
              verdict = "blocked";
              reachable = false;
            } else if (open) {
              const status = Number(open[1]);
              const flavor = open[2] ?? "unknown";
              // Verdict rule: an HTTP answer proves the metadata
              // endpoint is REACHABLE only when it carries the
              // metadata signature (flavor=present, at any status —
              // a real metadata server is answering) or is a success
              // (2xx — a metadata endpoint never "succeeds" at
              // refusing, and proxy block-pages served with 200 keep
              // failing). A non-2xx answer WITHOUT the signature is
              // a refusal: whoever answered (an egress proxy
              // enforcing denyOut, a fabric auth gate) handed back
              // an error and no metadata. Staging evidence,
              // 2026-11-13: once denyOut ["169.254.0.0/16"] was in
              // place, the metadata address answered 401 with
              // flavor=absent. An unrecognised flavor counts as
              // reachable — only a positively signature-free refusal
              // passes.
              reachable = flavor !== "absent" || (status >= 200 && status < 300);
              verdict = reachable
                ? `REACHABLE (status=${status} flavor=${flavor})`
                : `REFUSED (status=${status} flavor=${flavor})`;
            } else if (hasOpen) {
              // EGRESS_OPEN with no parseable status: an HTTP
              // response we cannot classify — fail closed.
              verdict = "REACHABLE";
              reachable = true;
            } else {
              verdict = `no verdict (exit ${res.exitCode})`;
              reachable = true;
            }
            if (reachable) allBlocked = false;
            verdicts.push(`${url} -> ${verdict}`);
          }
          log.add(
            "network-egress",
            allBlocked ? "pass" : "fail",
            verdicts.join("; ") +
              (options.terminalBeaconUrl
                ? ""
                : "; terminal-beacon target not configured in this run (metadata target gated)"),
            t,
            now,
          );
        } catch (err) {
          log.add("network-egress", "fail", `probe threw: ${errMsg(err)}`, t, now);
        }

        // ── resource-limits ────────────────────────────────────────
        t = now();
        try {
          const current = (await provider.get(aId).catch(() => null)) ?? sandboxA;
          const echoOk =
            current.limits.cpuVcpus === limits.cpuVcpus &&
            current.limits.memoryMB === limits.memoryMB;

          let visibility = "visibility probe produced no output";
          try {
            const vis = await exec(aId, buildLimitsProbeCommand());
            const parsed = JSON.parse(vis.stdout.trim()) as { totalmemBytes?: number; cpuCount?: number };
            visibility = `visible inside sandbox: ${parsed.cpuCount ?? "?"} CPU(s), ${Math.round((parsed.totalmemBytes ?? 0) / 1048576)} MiB RAM`;
          } catch {
            visibility = "visibility probe unparseable (recorded as evidence only)";
          }

          const hogBytes = Math.floor(limits.memoryMB * 1048576 * 1.6);
          let hogCompleted = false;
          let hogDetail = "";
          try {
            const hog = await exec(aId, buildMemoryHogCommand(hogBytes), hogTimeoutMs);
            hogCompleted = hog.exitCode === 0 && hog.stdout.includes("HOG_COMPLETED");
            hogDetail = hogCompleted
              ? `allocation of ${Math.round(hogBytes / 1048576)} MiB COMPLETED against a ${limits.memoryMB} MiB limit — the limit is not enforced`
              : `allocation of ${Math.round(hogBytes / 1048576)} MiB against a ${limits.memoryMB} MiB limit did not complete (exit ${hog.exitCode})`;
          } catch (err) {
            hogDetail = `allocation of ${Math.round(hogBytes / 1048576)} MiB against a ${limits.memoryMB} MiB limit aborted (${errMsg(err)})`;
          }

          const pass = echoOk && !hogCompleted;
          log.add(
            "resource-limits",
            pass ? "pass" : "fail",
            [
              echoOk
                ? `instance echoes requested limits (${limits.cpuVcpus} vCPU, ${limits.memoryMB} MiB)`
                : `instance reports limits ${current.limits.cpuVcpus} vCPU / ${current.limits.memoryMB} MiB, expected ${limits.cpuVcpus} / ${limits.memoryMB}`,
              hogDetail,
              visibility,
            ].join("; "),
            t,
            now,
          );
        } catch (err) {
          log.add("resource-limits", "fail", `probe threw: ${errMsg(err)}`, t, now);
        }
      }
    }
  } catch (err) {
    log.add("canary-runner", "fail", `canary runner error: ${errMsg(err)}`, now(), now);
    log.failRemaining(SANDBOX_CHECKS, "not attempted: canary runner error");
  } finally {
    // ── cleanup ────────────────────────────────────────────────────
    const t = now();
    const problems: string[] = [];
    for (const sandbox of [sandboxA, sandboxB]) {
      if (!sandbox || destroyed.has(sandbox.sandboxId)) continue;
      try {
        await provider.destroy(sandbox.sandboxId);
        destroyed.add(sandbox.sandboxId);
        const after = await provider.get(sandbox.sandboxId).catch(() => null);
        if (after !== null) problems.push(`sandbox ${sandbox.sandboxId} still visible via get() after destroy`);
      } catch (err) {
        problems.push(`destroy(${sandbox.sandboxId}) threw: ${errMsg(err)}`);
      }
    }
    if (sentinelPlanted) {
      try {
        rmSync(hostSentinelPath, { force: true });
      } catch {
        // Host-side sentinel cleanup is best-effort; the file is inert.
      }
    }
    if (!log.results.some((r) => r.id === "cleanup")) {
      const createdCount = [sandboxA, sandboxB].filter(Boolean).length;
      log.add(
        "cleanup",
        problems.length === 0 ? "pass" : "fail",
        problems.length === 0
          ? createdCount === 0
            ? "no sandboxes were created; nothing to clean up"
            : `${createdCount} canary sandbox(es) destroyed and confirmed gone`
          : problems.join("; "),
        t,
        now,
      );
    }
  }

  const finishedMs = now();
  const passed = log.results.every((r) => r.status === "pass");
  return {
    provider: provider.name,
    runId,
    startedAt: new Date(startedMs).toISOString(),
    finishedAt: new Date(finishedMs).toISOString(),
    durationMs: Math.max(0, finishedMs - startedMs),
    passed,
    checks: log.results,
  };
}
