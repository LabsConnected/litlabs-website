/**
 * ADB client — the lowest layer of LiTT's Android control surface.
 *
 * Owns exactly three things:
 *   1. Locating the adb executable (env override -> PATH via whichSync)
 *   2. Executing `adb [-s serial] <args>` through the canonical
 *      ShellExecutor — structured argv, never a shell string, always a
 *      bounded timeout
 *   3. Normalizing adb's unstructured stderr/exit-code failures into
 *      typed AdbFailureKind values so callers report honest device-state
 *      errors instead of guessing
 *
 * It does NOT validate operation arguments (ops.ts), enforce the device
 * allowlist (device-registry.ts), or decide policy/approval (the
 * ExecutionGateway does that).
 */

import { existsSync } from "node:fs";
import type { ShellExecutor, ShellResult } from "@litt/agent-core";
import { whichSync } from "../which.js";

/** Typed failure categories a caller can act on. */
export type AdbFailureKind =
  | "adb_missing"
  | "no_devices"
  | "device_not_found"
  | "device_offline"
  | "device_unauthorized"
  | "timeout"
  | "cancelled"
  | "exec_failed";

export interface AdbFailure {
  kind: AdbFailureKind;
  message: string;
}

export interface AdbRunResult {
  ok: boolean;
  status: "success" | "failed" | "cancelled" | "timeout";
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  /** Null on success. */
  failure: AdbFailure | null;
}

export interface AdbRunOptions {
  /** Device serial for `-s`. Omitted for host-level commands like `devices`. */
  serial?: string;
  /** Structured adb arguments — e.g. ["shell", "input", "tap", "100", "200"]. */
  args: string[];
  /** Bounded timeout in ms. */
  timeoutMs?: number;
}

/** Injectable dependencies — tests substitute a mock shell + fake resolver. */
export interface AdbDeps {
  shell: ShellExecutor;
  /** Explicit adb path (skips resolution). Tests pass a fake path. */
  adbPath?: string | null;
  /** Env lookup (defaults to process.env) — LITT_ADB_PATH override. */
  env?: (key: string) => string | undefined;
  /** Existence check for env-provided paths. */
  exists?: (path: string) => boolean;
  /** PATH lookup (defaults to whichSync). */
  which?: (command: string) => string | null;
}

/** Default per-call timeout. Individual ops pass tighter bounds. */
export const ADB_DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Resolve the adb executable.
 * Order: LITT_ADB_PATH env (must exist) → deps.adbPath → PATH via whichSync.
 * Never throws — returns an adb_missing failure instead.
 */
export function resolveAdb(
  deps: Pick<AdbDeps, "adbPath" | "env" | "exists" | "which">,
): { ok: true; path: string } | { ok: false; failure: AdbFailure } {
  const env = deps.env ?? ((k: string) => process.env[k]);
  const exists = deps.exists ?? existsSync;
  const which = deps.which ?? whichSync;

  const envPath = env("LITT_ADB_PATH");
  if (envPath && envPath.trim() !== "") {
    const trimmed = envPath.trim();
    if (exists(trimmed)) return { ok: true, path: trimmed };
    return {
      ok: false,
      failure: {
        kind: "adb_missing",
        message: `LITT_ADB_PATH is set to "${trimmed}" but no executable exists there`,
      },
    };
  }

  if (deps.adbPath) return { ok: true, path: deps.adbPath };

  const found = which("adb");
  if (found) return { ok: true, path: found };

  return {
    ok: false,
    failure: {
      kind: "adb_missing",
      message:
        "adb executable not found. Install Android platform-tools or set LITT_ADB_PATH to adb.exe",
    },
  };
}

/** Best human-readable error line from a failed adb run. */
function pickErrorLine(res: ShellResult): string | null {
  const lines = `${res.stderr}\n${res.stdout}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("* daemon"));
  const errLine = lines.find((l) => /error|exception|failed|not found|offline|unauthorized/i.test(l));
  return errLine ?? lines[0] ?? null;
}

/**
 * Classify a failed adb invocation from its stderr/stdout text.
 * adb reports device-state errors as "error: <reason>" on stderr.
 */
export function classifyAdbFailure(res: ShellResult): AdbFailure {
  const text = `${res.stderr}\n${res.stdout}`.toLowerCase();

  if (res.status === "timeout") {
    return { kind: "timeout", message: "adb command timed out" };
  }
  if (res.status === "cancelled") {
    return { kind: "cancelled", message: "adb command cancelled" };
  }
  if (/device ['"]?[\w.:_-]+['"]? not found/.test(text) || /no such device/.test(text)) {
    return { kind: "device_not_found", message: pickErrorLine(res) ?? "device not found" };
  }
  if (/device offline/.test(text)) {
    return { kind: "device_offline", message: pickErrorLine(res) ?? "device is offline" };
  }
  if (/unauthorized/.test(text) || /no permissions/.test(text)) {
    return {
      kind: "device_unauthorized",
      message: pickErrorLine(res) ?? "device requires USB-debugging authorization on the phone",
    };
  }
  if (/no devices|emulators found/.test(text) || /no devices attached/.test(text)) {
    return { kind: "no_devices", message: pickErrorLine(res) ?? "no devices attached" };
  }
  return {
    kind: "exec_failed",
    message: pickErrorLine(res) ?? `adb exited with code ${res.exitCode ?? "unknown"}`,
  };
}

/**
 * Run `adb [-s serial] <args>` through the canonical ShellExecutor.
 * Structured argv only — no shell string is ever constructed here.
 * Allowlist enforcement is the caller's job (device-registry).
 */
export async function runAdb(
  deps: AdbDeps,
  options: AdbRunOptions,
): Promise<AdbRunResult> {
  const resolved = resolveAdb(deps);
  if (!resolved.ok) {
    return {
      ok: false,
      status: "failed",
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: 0,
      failure: resolved.failure,
    };
  }

  const argv = options.serial
    ? ["-s", options.serial, ...options.args]
    : [...options.args];

  const t0 = Date.now();
  let res: ShellResult;
  try {
    res = await deps.shell.execute({
      command: resolved.path,
      args: argv,
      timeoutMs: options.timeoutMs ?? ADB_DEFAULT_TIMEOUT_MS,
    });
  } catch (err) {
    return {
      ok: false,
      status: "failed",
      stdout: "",
      stderr: "",
      exitCode: null,
      durationMs: Date.now() - t0,
      failure: {
        kind: "exec_failed",
        message: `adb spawn failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  const ok = res.ok && res.status === "success" && res.exitCode === 0;
  return {
    ok,
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    exitCode: res.exitCode,
    durationMs: res.durationMs,
    failure: ok ? null : classifyAdbFailure(res),
  };
}

// ─── devices -l parsing ───────────────────────────────────────────

export interface AdbDeviceInfo {
  serial: string;
  /** Raw state token: device | offline | unauthorized | no permissions | ... */
  state: string;
  /** True only when state === "device" (fully usable). */
  usable: boolean;
  product?: string;
  model?: string;
  device?: string;
  transportId?: string;
}

/**
 * Parse `adb devices -l` output into structured device info.
 * Only real device lines are returned — header and blank lines skipped.
 */
export function parseAdbDevices(output: string): AdbDeviceInfo[] {
  const devices: AdbDeviceInfo[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("List of devices")) continue;

    const tokens = trimmed.split(/\s+/);
    const serial = tokens[0];
    const state = tokens[1] ?? "unknown";
    if (!serial || serial === "*") continue;

    const info: AdbDeviceInfo = { serial, state, usable: state === "device" };
    for (const tok of tokens.slice(2)) {
      const idx = tok.indexOf(":");
      if (idx === -1) continue;
      const key = tok.slice(0, idx);
      const value = tok.slice(idx + 1);
      if (key === "product") info.product = value;
      else if (key === "model") info.model = value;
      else if (key === "device") info.device = value;
      else if (key === "transport_id") info.transportId = value;
    }
    devices.push(info);
  }
  return devices;
}
