/**
 * Device registry — the Android control allowlist and target resolver.
 *
 * LiTT must never send input to a device the operator has not explicitly
 * authorized. This module is the single place that decides:
 *
 *   - which serials are allowlisted (config file + env)
 *   - which packages may be launched by name
 *   - which serial a given operation targets
 *
 * Config source (merged):
 *   - <LITT_STATE_HOME|~/.litt>/android.json
 *       {
 *         "serials": ["LBMRAIFEVSNRMFRO"],
 *         "packages": ["com.termux", "com.android.settings"],
 *         "defaultSerial": "LBMRAIFEVSNRMFRO",
 *         "dex": { "host": "127.0.0.1", "port": 8022, "user": "u0_a235" }
 *       }
 *   - LITT_ANDROID_SERIALS  — comma-separated serials merged into the list
 *   - LITT_ANDROID_PACKAGES — comma-separated packages merged into the list
 *
 * Default-deny: a serial not in the merged allowlist is rejected before
 * any adb process is spawned. A missing config file yields an EMPTY
 * allowlist — discovery still works, device actions do not.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getLittHome } from "../config.js";
import type { AdbDeviceInfo } from "./adb-client.js";

// ─── Types ────────────────────────────────────────────────────────

/** SSH parameters for the phone-side Termux/Dex link. */
export interface DexLinkConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** Termux user, e.g. "u0_a235". */
  user: string;
  /** Private key path (the litt_phone keypair). */
  keyPath: string;
  /** Pinned host-key file for StrictHostKeyChecking. */
  knownHostsPath: string;
}

export interface AndroidPolicy {
  /** Serials permitted to receive device-changing operations. */
  allowedSerials: string[];
  /** Packages permitted for android.open_app. */
  allowedPackages: string[];
  /** Preferred serial when multiple allowlisted devices are connected. */
  defaultSerial?: string;
  /** Dex/Termux SSH link configuration. */
  dex: DexLinkConfig;
}

export type ResolveSerialFailureKind =
  | "not_allowlisted"
  | "invalid_serial"
  | "no_device"
  | "ambiguous"
  | "device_not_found"
  | "device_not_ready";

export interface ResolveSerialResult {
  ok: boolean;
  serial?: string;
  failure?: { kind: ResolveSerialFailureKind; message: string };
}

/** Device serial: adb serials are alnum/ip:port/emulator-NNNN shaped. */
export const SERIAL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,63}$/;

/**
 * Serial values that are templates/placeholders, never device
 * identities: env-var references ($ANDROID_SERIAL, ${ANDROID_SERIAL},
 * %ANDROID_SERIAL%), angle-bracket templates (<serial>), and
 * schema-vocabulary tokens (ANDROID_SERIAL, DEVICE_SERIAL, …).
 * Real serials like "LBMRAIFEVSNRMFRO" or "emulator-5554" match none
 * of these. A placeholder must NEVER be resolved as a device — it
 * fails closed with a clear error instead.
 */
const SERIAL_PLACEHOLDER_EXACT = new Set([
  "serial", "serialno", "serial_number", "device_serial", "android_serial",
  "adb_serial", "phone_serial", "emulator_serial", "device_id",
  "your_serial", "my_serial", "target_serial", "the_serial",
]);

export function isSerialPlaceholder(serial: string): boolean {
  const t = serial.trim();
  if (t === "") return false;
  if (SERIAL_PLACEHOLDER_EXACT.has(t.toLowerCase())) return true;
  // <serial>, <device serial> — angle-bracket templates.
  if (/^<[^>]+>$/.test(t)) return true;
  // $VAR, ${VAR} — POSIX env-var references.
  if (/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(t)) return true;
  // %VAR% — Windows env-var references.
  if (/^%[A-Za-z_][A-Za-z0-9_]*%$/.test(t)) return true;
  // <FAMILY>_SERIAL / <FAMILY>-SERIAL schema-vocabulary compounds
  // (e.g. ANDROID_SERIAL shapes a model invents on the fly).
  if (/^(?:android|adb|device|phone|emulator|usb)[-_]serial(?:s)?$/i.test(t)) return true;
  return false;
}

/** Android package id: reverse-domain with at least one dot. */
export const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

// ─── Policy loading ───────────────────────────────────────────────

function parseList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

function parseCsvEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((v) => v.trim()).filter((v) => v !== "");
}

export interface PolicyLoadDeps {
  /** Env lookup (defaults to process.env). */
  env?: (key: string) => string | undefined;
  /** Override the state-home dir (defaults to getLittHome()). */
  littHome?: string;
  /** File reader (defaults to fs.readFileSync) — tests inject fixtures. */
  readFile?: (path: string) => string;
  /** Existence check (defaults to fs.existsSync). */
  exists?: (path: string) => boolean;
}

function defaultDexConfig(home: string): DexLinkConfig {
  const sshDir = join(homedir(), ".ssh");
  return {
    enabled: true,
    host: "127.0.0.1",
    port: 8022,
    user: "u0_a235",
    keyPath: join(sshDir, "litt_phone"),
    knownHostsPath: join(sshDir, "known_hosts_litt_phone"),
  };
}

/**
 * Load the merged Android policy. Never throws — a missing or corrupt
 * config file yields an EMPTY allowlist (fail closed), not a crash.
 */
export function loadAndroidPolicy(deps: PolicyLoadDeps = {}): AndroidPolicy {
  const env = deps.env ?? ((k: string) => process.env[k]);
  const exists = deps.exists ?? existsSync;
  const readFile = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const littHome = deps.littHome ?? getLittHome();

  let file: Record<string, unknown> = {};
  const configPath = join(littHome, "android.json");
  try {
    if (exists(configPath)) {
      const parsed: unknown = JSON.parse(readFile(configPath));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        file = parsed as Record<string, unknown>;
      }
    }
  } catch {
    // Corrupt config → empty allowlist (fail closed). The error is
    // reflected in the fact that no device action will be permitted.
    file = {};
  }

  const dexRaw = (file.dex && typeof file.dex === "object" ? file.dex : {}) as Record<string, unknown>;
  const dexDefaults = defaultDexConfig(littHome);
  const serials = new Set<string>([
    ...parseList(file.serials).filter((s) => SERIAL_RE.test(s)),
    ...parseCsvEnv(env("LITT_ANDROID_SERIALS")).filter((s) => SERIAL_RE.test(s)),
  ]);
  const packages = new Set<string>([
    ...parseList(file.packages).filter((p) => PACKAGE_RE.test(p)),
    ...parseCsvEnv(env("LITT_ANDROID_PACKAGES")).filter((p) => PACKAGE_RE.test(p)),
  ]);

  const defaultSerial = typeof file.defaultSerial === "string" && SERIAL_RE.test(file.defaultSerial)
    ? file.defaultSerial
    : undefined;

  return {
    allowedSerials: [...serials],
    allowedPackages: [...packages],
    defaultSerial,
    dex: {
      enabled: typeof dexRaw.enabled === "boolean" ? dexRaw.enabled : dexDefaults.enabled,
      host: typeof dexRaw.host === "string" && dexRaw.host.trim() !== "" ? dexRaw.host.trim() : dexDefaults.host,
      port: typeof dexRaw.port === "number" && dexRaw.port > 0 && dexRaw.port < 65536 ? dexRaw.port : dexDefaults.port,
      user: typeof dexRaw.user === "string" && dexRaw.user.trim() !== "" ? dexRaw.user.trim() : dexDefaults.user,
      keyPath: typeof dexRaw.keyPath === "string" ? dexRaw.keyPath : dexDefaults.keyPath,
      knownHostsPath: typeof dexRaw.knownHostsPath === "string" ? dexRaw.knownHostsPath : dexDefaults.knownHostsPath,
    },
  };
}

// ─── Serial resolution ────────────────────────────────────────────

function fail(kind: ResolveSerialFailureKind, message: string): ResolveSerialResult {
  return { ok: false, failure: { kind, message } };
}

/**
 * Resolve which serial an operation should target.
 *
 * Rules:
 *   - An explicit serial must be well-formed AND in the allowlist.
 *   - With no explicit serial: prefer policy.defaultSerial (if
 *     allowlisted and currently connected/usable), then the single
 *     allowlisted+usable connected device, else an honest failure.
 *   - Non-allowlisted devices are invisible to device actions even when
 *     physically connected — they show up in `devices` output but can
 *     never be targeted.
 */
export function resolveSerial(
  policy: AndroidPolicy,
  requested: string | undefined,
  connected: AdbDeviceInfo[],
): ResolveSerialResult {
  const usable = connected.filter((d) => d.usable);

  if (requested !== undefined && requested !== "") {
    // A placeholder is never a device identity — fail closed with a
    // clear error BEFORE the allowlist check so the message names the
    // real problem (template text, not an unauthorized device). The
    // caller must NOT silently substitute another device.
    if (isSerialPlaceholder(requested)) {
      return fail(
        "invalid_serial",
        `Serial "${requested}" is a placeholder, not a device serial. ` +
          `Omit "serial" to auto-select the authorized device, or pass a real serial from android.devices.`,
      );
    }
    if (!SERIAL_RE.test(requested)) {
      return fail("invalid_serial", `Serial "${requested}" is not a valid device serial`);
    }
    if (!policy.allowedSerials.includes(requested)) {
      return fail(
        "not_allowlisted",
        `Device "${requested}" is not in the Android allowlist. ` +
          `Add it to android.json serials or LITT_ANDROID_SERIALS to authorize it.`,
      );
    }
    const dev = connected.find((d) => d.serial === requested);
    if (!dev) {
      return fail("device_not_found", `Allowlisted device "${requested}" is not attached`);
    }
    if (!dev.usable) {
      return fail(
        "device_not_ready",
        `Device "${requested}" is attached but state="${dev.state}" (not ready)`,
      );
    }
    return { ok: true, serial: requested };
  }

  // No explicit serial — prefer the configured default.
  if (policy.defaultSerial) {
    const def = usable.find((d) => d.serial === policy.defaultSerial);
    if (def) return { ok: true, serial: def.serial };
  }

  const candidates = usable.filter((d) => policy.allowedSerials.includes(d.serial));
  if (candidates.length === 1) return { ok: true, serial: candidates[0].serial };
  if (candidates.length === 0) {
    if (usable.length === 0) {
      if (connected.length === 0) {
        return fail("no_device", "No devices are attached — `adb devices` returned an empty list");
      }
      // Devices ARE attached but none is state="device" — report the real
      // states so the operator can tell unauthorized/offline apart from
      // a genuinely empty bus. (Observed: "No usable devices" hid an
      // unauthorized phone behind a misleading message.)
      const states = connected.map((d) => `${d.serial}=${d.state}`).join(", ");
      const hint = connected.some((d) => d.state === "unauthorized")
        ? " — accept the USB debugging prompt on the phone"
        : connected.every((d) => d.state === "offline")
          ? " — device offline; reconnect it or restart the adb server"
          : "";
      return fail("device_not_ready", `Attached device(s) not ready: ${states}${hint}`);
    }
    return fail(
      "no_device",
      `${usable.length} device(s) attached but none are allowlisted. ` +
        `Allowlisted serials: ${policy.allowedSerials.join(", ") || "(none configured)"}`,
    );
  }
  return fail(
    "ambiguous",
    `${candidates.length} allowlisted devices are connected — specify a serial: ` +
      candidates.map((c) => c.serial).join(", "),
  );
}

/** True iff the serial may receive device-changing operations. */
export function isSerialAllowed(policy: AndroidPolicy, serial: string): boolean {
  return policy.allowedSerials.includes(serial);
}

/** True iff the package may be launched via android.open_app. */
export function isPackageAllowed(policy: AndroidPolicy, pkg: string): boolean {
  return policy.allowedPackages.includes(pkg);
}
