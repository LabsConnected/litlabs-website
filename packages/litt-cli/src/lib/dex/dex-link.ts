/**
 * Dex link — probing the phone-side Termux/Dex channel.
 *
 * The Dex link (established by setup-link.sh on the phone) is:
 *   Termux sshd → phone localhost:8022 → `adb forward` → PC 127.0.0.1:8022
 *   → ssh with the dedicated `litt_phone` keypair, pubkey-only,
 *   StrictHostKeyChecking against a pinned known_hosts file.
 *
 * This module NEVER opens an interactive shell and NEVER forwards
 * arbitrary commands — probeDex runs a fixed `echo` handshake plus a
 * read-only process listing. There is no dex.request implementation:
 * the installed Dex v2.0 command interface could not be verified
 * during integration, so no command channel is exposed until it is.
 *
 * Truthfulness: every field reflects what was actually observed.
 * "dex running" is reported as unknown unless the SSH handshake
 * succeeded AND a process check ran — never inferred from Termux
 * being installed.
 */

import { existsSync } from "node:fs";
import type { ShellExecutor } from "@litt/agent-core";
import { runAdb, parseAdbDevices, type AdbDeps } from "../android/adb-client.js";
import type { DexLinkConfig } from "../android/device-registry.js";

// ─── Types ────────────────────────────────────────────────────────

export interface DexProbeDeps {
  shell: ShellExecutor;
  adbPath?: string | null;
  env?: (key: string) => string | undefined;
  which?: (command: string) => string | null;
  exists?: (path: string) => boolean;
  /** ssh binary path override (defaults to "ssh" on PATH). */
  sshPath?: string;
  /** Serial to run `adb forward` against (optional — skipped when absent). */
  adbSerial?: string;
}

export interface DexProbeResult {
  /** ssh answered the `echo` handshake → link up AND key authorized. */
  linkUp: boolean;
  /** Termux sshd listening was established via adb forward attempt. */
  forwardAttempted: boolean;
  /** Termux app process visible via adb ps (best-effort hint). */
  termuxProcessVisible: boolean | null;
  /** Dex process detected on-device. "unknown" when the link is down. */
  dexRunning: boolean | "unknown";
  /** Remote processes matching dex/litt/node/ollama (when reachable). */
  remoteProcesses: string[];
  /** The concrete blocker, when the link is down. */
  blocker: string | null;
}

const PROBE_TIMEOUT_MS = 12_000;
const SSH_CONNECT_TIMEOUT_S = "5";

function sshArgs(cfg: DexLinkConfig, remoteCommand: string): string[] {
  return [
    "-i", cfg.keyPath,
    "-p", String(cfg.port),
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${cfg.knownHostsPath}`,
    "-o", `ConnectTimeout=${SSH_CONNECT_TIMEOUT_S}`,
    "-o", "PreferredAuthentications=publickey",
    "-o", "IdentitiesOnly=yes",
    "-o", "NumberOfPasswordPrompts=0",
    `${cfg.user}@${cfg.host}`,
    remoteCommand,
  ];
}

/**
 * Probe the Dex link honestly. Never throws — every failure mode maps
 * to a concrete blocker string the caller can surface.
 */
export async function probeDex(
  deps: DexProbeDeps,
  cfg: DexLinkConfig,
): Promise<DexProbeResult> {
  const exists = deps.exists ?? existsSync;
  const result: DexProbeResult = {
    linkUp: false,
    forwardAttempted: false,
    termuxProcessVisible: null,
    dexRunning: "unknown",
    remoteProcesses: [],
    blocker: null,
  };

  if (!cfg.enabled) {
    result.blocker = "Dex link disabled in android.json";
    return result;
  }

  // ─── 1. adb forward + process hints (best-effort, requires adb) ──
  const adbDeps: AdbDeps = {
    shell: deps.shell,
    adbPath: deps.adbPath ?? null,
    env: deps.env,
    which: deps.which,
  };
  if (deps.adbSerial) {
    result.forwardAttempted = true;
    // A stale forward survives disconnects; forwarding again is idempotent.
    await runAdb(adbDeps, {
      serial: deps.adbSerial,
      args: ["forward", "tcp:8022", "tcp:8022"],
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const ps = await runAdb(adbDeps, {
      serial: deps.adbSerial,
      args: ["shell", "ps -A | grep -iE 'com.termux|sshd'"],
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (ps.ok) {
      result.termuxProcessVisible = /com\.termux|sshd/.test(ps.stdout);
    }
  }

  // ─── 2. Preconditions on the Windows side ────────────────────────
  if (!exists(cfg.keyPath)) {
    result.blocker = `Dex private key not found at ${cfg.keyPath}`;
    return result;
  }
  if (!exists(cfg.knownHostsPath)) {
    result.blocker = `Pinned known_hosts file not found at ${cfg.knownHostsPath}`;
    return result;
  }

  // ─── 3. SSH echo handshake (fixed command — not user input) ──────
  let handshake;
  try {
    handshake = await deps.shell.execute({
      command: deps.sshPath ?? "ssh",
      args: sshArgs(cfg, "echo litt-dex-probe-ok"),
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  } catch (err) {
    result.blocker = `ssh failed to launch: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  }

  const handOk = handshake.ok && handshake.status === "success" && /litt-dex-probe-ok/.test(handshake.stdout);
  if (!handOk) {
    const detail = (handshake.stderr || handshake.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    result.blocker = detail
      ? `Dex link unreachable — ${detail}`
      : `Dex link unreachable (ssh exit ${handshake.exitCode ?? "?"}) — is Termux sshd running and adb forward set?`;
    return result;
  }
  result.linkUp = true;

  // ─── 4. Read-only remote process listing ─────────────────────────
  const psRes = await deps.shell.execute({
    command: deps.sshPath ?? "ssh",
    args: sshArgs(cfg, "ps -eo comm,args 2>/dev/null | grep -iE 'dex|litt|node|ollama|sshd' | grep -v grep"),
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  if (psRes.ok) {
    result.remoteProcesses = psRes.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "").slice(0, 20);
    result.dexRunning = result.remoteProcesses.some((l) => /\bdex\b/i.test(l));
  } else {
    result.dexRunning = "unknown";
  }
  return result;
}

// ─── ToolResult formatting ────────────────────────────────────────

export function formatDexStatus(r: DexProbeResult): string {
  if (!r.linkUp) {
    return `Dex link DOWN — ${r.blocker ?? "unreachable"}.` +
      (r.termuxProcessVisible === true ? " Termux app is running on the device." : "") +
      (r.termuxProcessVisible === false ? " No Termux/sshd process visible via adb." : "");
  }
  const dex = r.dexRunning === "unknown" ? "unknown (process listing failed)" : r.dexRunning ? "running" : "not running";
  const procs = r.remoteProcesses.length > 0 ? ` Processes: ${r.remoteProcesses.join("; ")}` : "";
  return `Dex link UP (ssh authenticated @127.0.0.1:8022). Dex process: ${dex}.${procs}`;
}
