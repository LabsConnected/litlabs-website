/**
 * Android operations — the validated device-control primitive set.
 *
 * Every public op follows the same contract:
 *   1. Resolve + allowlist-check the target serial (device-registry)
 *   2. Validate ALL inputs before any adb process is spawned
 *   3. Execute through runAdb() — structured argv, bounded timeout
 *   4. Report honestly: `verified: true` only when device state (not
 *      just exit 0) confirms the effect. Input actions (tap, swipe,
 *      key, text) have no feedback channel — they report
 *      `verified: false` and say so in the message.
 *
 * There is deliberately NO raw `adb shell` passthrough op. Every op is
 * a fixed, allowlisted operation with typed arguments.
 */

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { ShellExecutor } from "@litt/agent-core";
import { runAdb, parseAdbDevices, type AdbDeps, type AdbFailure } from "./adb-client.js";
import {
  loadAndroidPolicy,
  resolveSerial,
  isPackageAllowed,
  PACKAGE_RE,
  type AndroidPolicy,
} from "./device-registry.js";
import { getLittHome } from "../config.js";

// ─── Types ────────────────────────────────────────────────────────

export interface OpOutcome {
  ok: boolean;
  status: "success" | "failed" | "cancelled" | "timeout";
  message: string;
  data: Record<string, unknown>;
  /**
   * True only when the result was verified against device state —
   * not merely inferred from exit 0.
   */
  verified: boolean;
}

export interface AndroidOpsDeps {
  shell: ShellExecutor;
  /** Explicit adb path (tests inject a fake). */
  adbPath?: string | null;
  /** Env lookup (defaults to process.env). */
  env?: (key: string) => string | undefined;
  /** adb PATH lookup (defaults to whichSync inside adb-client). */
  which?: (command: string) => string | null;
  /** Policy source — defaults to a 1s-cached android.json loader. */
  policyProvider?: () => AndroidPolicy;
  /** State-home override for captures dir (defaults to getLittHome()). */
  littHome?: string;
  /** Filesystem hooks (tests inject fakes). */
  exists?: (path: string) => boolean;
  statFile?: (path: string) => { size: number; isFile: boolean } | null;
  mkdirp?: (path: string) => void;
  readFileBytes?: (path: string) => Uint8Array | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

// ─── Per-op timeouts (bounded — never the 120s runCommand default) ──

export const ANDROID_TIMEOUTS = {
  discovery: 10_000,
  state: 15_000,
  tap: 10_000,
  swipe: 10_000,
  key: 10_000,
  text: 10_000,
  screenshot: 30_000,
  openApp: 20_000,
  push: 60_000,
  pull: 60_000,
  foreground: 10_000,
  wmSize: 10_000,
} as const;

/** Remote directory LiTT is allowed to touch on the device. */
export const REMOTE_LITT_DIR = "/sdcard/LiTT";

// ─── Helpers ──────────────────────────────────────────────────────

function outcome(
  ok: boolean,
  message: string,
  data: Record<string, unknown>,
  opts?: { verified?: boolean; status?: OpOutcome["status"] },
): OpOutcome {
  return {
    ok,
    status: opts?.status ?? (ok ? "success" : "failed"),
    message,
    data,
    verified: opts?.verified ?? false,
  };
}

function failureOutcome(message: string, kind: string, status: OpOutcome["status"] = "failed"): OpOutcome {
  return outcome(false, message, { failure: kind }, { status });
}

function adbFailureOutcome(message: string, failure: AdbFailure, status: OpOutcome["status"]): OpOutcome {
  return outcome(false, `${message}: ${failure.message}`, { failure: failure.kind }, { status });
}

function strictInt(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Create the validated Android operation set bound to a ShellExecutor.
 * All methods return OpOutcome — never throw on device/adb failure.
 */
export function createAndroidOps(deps: AndroidOpsDeps) {
  const env = deps.env ?? ((k: string) => process.env[k]);
  const littHome = deps.littHome ?? getLittHome();
  const exists = deps.exists ?? existsSync;
  const statFile = deps.statFile ?? ((p: string) => {
    try {
      const s = statSync(p);
      return { size: s.size, isFile: s.isFile() };
    } catch {
      return null;
    }
  });
  const mkdirp = deps.mkdirp ?? ((p: string) => mkdirSync(p, { recursive: true }));
  const readFileBytes = deps.readFileBytes ?? ((p: string) => {
    try {
      return new Uint8Array(readFileSync(p));
    } catch {
      return null;
    }
  });
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;

  // Policy is re-read through the provider on EVERY op — allowlist edits
  // take effect without a restart, and a deleted config instantly denies.
  const cachedPolicy = { at: 0, policy: null as AndroidPolicy | null };
  const policy = (): AndroidPolicy => {
    if (deps.policyProvider) return deps.policyProvider();
    const t = now();
    if (!cachedPolicy.policy || t - cachedPolicy.at > 1_000) {
      cachedPolicy.policy = loadAndroidPolicy({ env, littHome });
      cachedPolicy.at = t;
    }
    return cachedPolicy.policy;
  };

  const adbDeps = (shell: ShellExecutor): AdbDeps => ({
    shell,
    adbPath: deps.adbPath ?? null,
    env,
    exists,
    which: deps.which,
  });

  /** List + parse devices, then resolve the target serial. */
  async function resolveTarget(
    requestedSerial?: string,
  ): Promise<{ ok: true; serial: string } | { ok: false; outcome: OpOutcome }> {
    const listRes = await runAdb(adbDeps(deps.shell), {
      args: ["devices", "-l"],
      timeoutMs: ANDROID_TIMEOUTS.discovery,
    });
    if (!listRes.ok) {
      return {
        ok: false,
        outcome: adbFailureOutcome("Could not enumerate devices", listRes.failure!, listRes.status),
      };
    }
    const res = resolveSerial(policy(), requestedSerial, parseAdbDevices(listRes.stdout));
    if (!res.ok || !res.serial) {
      return {
        ok: false,
        outcome: failureOutcome(res.failure!.message, res.failure!.kind),
      };
    }
    return { ok: true, serial: res.serial };
  }

  // ─── Read-only ops ────────────────────────────────────────────

  async function listDevices(): Promise<OpOutcome> {
    const res = await runAdb(adbDeps(deps.shell), {
      args: ["devices", "-l"],
      timeoutMs: ANDROID_TIMEOUTS.discovery,
    });
    if (!res.ok) {
      return adbFailureOutcome("adb devices failed", res.failure!, res.status);
    }
    const pol = policy();
    const devices = parseAdbDevices(res.stdout).map((d) => ({
      ...d,
      allowlisted: pol.allowedSerials.includes(d.serial),
    }));
    return outcome(
      true,
      devices.length === 0
        ? "No devices attached"
        : `${devices.length} device(s) attached (${devices.filter((d) => d.allowlisted && d.usable).length} authorized+ready)`,
      { devices, allowlistedSerials: pol.allowedSerials },
      { verified: true },
    );
  }

  /** Parse the focused-window package from dumpsys output. */
  function parseFocusedPackage(dumpsys: string): string | null {
    const m = /(?:mCurrentFocus|mFocusedApp)=[^\n]*?([a-zA-Z][\w]*(?:\.[\w]+)+)\//.exec(dumpsys);
    return m ? m[1] : null;
  }

  async function foregroundApp(serial: string): Promise<string | null> {
    const res = await runAdb(adbDeps(deps.shell), {
      serial,
      args: ["shell", "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'"],
      timeoutMs: ANDROID_TIMEOUTS.foreground,
    });
    if (!res.ok) return null;
    return parseFocusedPackage(res.stdout);
  }

  async function deviceState(requestedSerial?: string): Promise<OpOutcome> {
    const target = await resolveTarget(requestedSerial);
    if (!target.ok) return target.outcome;
    const serial = target.serial;
    const adb = adbDeps(deps.shell);

    // Best-effort parallel reads — a failing probe yields null fields,
    // never a fabricated value.
    const [model, release, power, window, battery] = await Promise.all([
      runAdb(adb, { serial, args: ["shell", "getprop ro.product.model"], timeoutMs: ANDROID_TIMEOUTS.state }),
      runAdb(adb, { serial, args: ["shell", "getprop ro.build.version.release"], timeoutMs: ANDROID_TIMEOUTS.state }),
      runAdb(adb, { serial, args: ["shell", "dumpsys power | grep -E 'mWakefulness=|Display Power'"], timeoutMs: ANDROID_TIMEOUTS.state }),
      runAdb(adb, { serial, args: ["shell", "dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'"], timeoutMs: ANDROID_TIMEOUTS.state }),
      runAdb(adb, { serial, args: ["shell", "dumpsys battery | grep 'level'"], timeoutMs: ANDROID_TIMEOUTS.state }),
    ]);

    const wake = /mWakefulness=(\w+)/.exec(power.stdout)?.[1]
      ?? (/Display Power: state=(\w+)/.exec(power.stdout)?.[1]);
    const screen =
      wake === undefined ? "unknown"
      : /^awake|^on$/i.test(wake) ? "awake" : "asleep";

    const batteryLevel = /level:\s*(\d+)/.exec(battery.stdout)?.[1] ?? null;

    return outcome(
      true,
      `${model.stdout.trim() || "unknown model"} · Android ${release.stdout.trim() || "?"} · screen ${screen}`,
      {
        serial,
        model: model.stdout.trim() || null,
        androidVersion: release.stdout.trim() || null,
        screen,
        foregroundPackage: parseFocusedPackage(window.stdout),
        batteryPercent: batteryLevel === null ? null : Number(batteryLevel),
        probes: {
          model: model.ok,
          release: release.ok,
          power: power.ok,
          window: window.ok,
          battery: battery.ok,
        },
      },
      { verified: true },
    );
  }

  /** Screen dimensions — cached 10s per serial. */
  const sizeCache = new Map<string, { w: number; h: number; at: number }>();
  async function screenSize(serial: string): Promise<{ w: number; h: number } | null> {
    const cached = sizeCache.get(serial);
    if (cached && now() - cached.at < 10_000) return { w: cached.w, h: cached.h };
    const res = await runAdb(adbDeps(deps.shell), {
      serial,
      args: ["shell", "wm size"],
      timeoutMs: ANDROID_TIMEOUTS.wmSize,
    });
    const m = /Physical size:\s*(\d+)x(\d+)/.exec(res.stdout);
    if (!res.ok || !m) return null;
    const size = { w: Number(m[1]), h: Number(m[2]) };
    sizeCache.set(serial, { ...size, at: now() });
    return size;
  }

  // ─── Input ops (mutating — approval enforced by the gateway) ─────

  /**
   * Validate a coordinate against the device's live screen size.
   * Returns null if valid, or an OpOutcome describing the rejection.
   */
  async function checkPoint(
    serial: string,
    x: unknown,
    y: unknown,
    label: string,
  ): Promise<OpOutcome | null> {
    const xi = strictInt(x);
    const yi = strictInt(y);
    if (xi === null || yi === null || xi < 0 || yi < 0) {
      return failureOutcome(`${label} coordinates must be non-negative integers`, "invalid_arg");
    }
    const size = await screenSize(serial);
    if (size && (xi >= size.w || yi >= size.h)) {
      return failureOutcome(
        `${label} (${xi},${yi}) is outside the device screen (${size.w}x${size.h})`,
        "invalid_arg",
      );
    }
    // screenSize unobtainable → still enforce a sane upper bound so a
    // garbage coordinate never reaches the device.
    if (!size && (xi > 10000 || yi > 10000)) {
      return failureOutcome(`${label} (${xi},${yi}) exceeds the coordinate ceiling`, "invalid_arg");
    }
    return null;
  }

  /** No on-screen feedback channel — callers must state this honestly. */
  const UNVERIFIED_NOTE = "Command reached the device (exit 0). There is no on-screen confirmation channel — verify visually via scrcpy or android.screenshot.";

  async function tap(x: unknown, y: unknown, requestedSerial?: string): Promise<OpOutcome> {
    const target = await resolveTarget(requestedSerial);
    if (!target.ok) return target.outcome;
    const bad = await checkPoint(target.serial, x, y, "tap");
    if (bad) return bad;
    const res = await runAdb(adbDeps(deps.shell), {
      serial: target.serial,
      args: ["shell", "input", "tap", String(strictInt(x)), String(strictInt(y))],
      timeoutMs: ANDROID_TIMEOUTS.tap,
    });
    if (!res.ok) return adbFailureOutcome("tap failed", res.failure!, res.status);
    return outcome(true, `Tapped (${strictInt(x)},${strictInt(y)}) on ${target.serial}. ${UNVERIFIED_NOTE}`, {
      serial: target.serial, x: strictInt(x), y: strictInt(y),
    });
  }

  async function swipe(
    x1: unknown, y1: unknown, x2: unknown, y2: unknown,
    durationMs: unknown, requestedSerial?: string,
  ): Promise<OpOutcome> {
    const target = await resolveTarget(requestedSerial);
    if (!target.ok) return target.outcome;
    for (const [px, py, label] of [[x1, y1, "swipe start"], [x2, y2, "swipe end"]] as const) {
      const bad = await checkPoint(target.serial, px, py, label);
      if (bad) return bad;
    }
    const dur = strictInt(durationMs) ?? 300;
    if (dur < 50 || dur > 5_000) {
      return failureOutcome(`swipe durationMs ${dur} out of bounds (50–5000ms)`, "invalid_arg");
    }
    const res = await runAdb(adbDeps(deps.shell), {
      serial: target.serial,
      args: ["shell", "input", "swipe",
        String(strictInt(x1)), String(strictInt(y1)),
        String(strictInt(x2)), String(strictInt(y2)), String(dur)],
      timeoutMs: ANDROID_TIMEOUTS.swipe,
    });
    if (!res.ok) return adbFailureOutcome("swipe failed", res.failure!, res.status);
    return outcome(true, `Swiped (${strictInt(x1)},${strictInt(y1)})→(${strictInt(x2)},${strictInt(y2)}) over ${dur}ms. ${UNVERIFIED_NOTE}`, {
      serial: target.serial, x1: strictInt(x1), y1: strictInt(y1), x2: strictInt(x2), y2: strictInt(y2), durationMs: dur,
    });
  }

  /** Allowlisted key names → KEYCODE constants. */
  const ALLOWED_KEYS: Record<string, string> = {
    home: "KEYCODE_HOME",
    back: "KEYCODE_BACK",
    recents: "KEYCODE_APP_SWITCH",
    app_switch: "KEYCODE_APP_SWITCH",
    enter: "KEYCODE_ENTER",
    tab: "KEYCODE_TAB",
    del: "KEYCODE_DEL",
    backspace: "KEYCODE_DEL",
    space: "KEYCODE_SPACE",
    up: "KEYCODE_DPAD_UP",
    down: "KEYCODE_DPAD_DOWN",
    left: "KEYCODE_DPAD_LEFT",
    right: "KEYCODE_DPAD_RIGHT",
    center: "KEYCODE_DPAD_CENTER",
    volume_up: "KEYCODE_VOLUME_UP",
    volume_down: "KEYCODE_VOLUME_DOWN",
    power: "KEYCODE_POWER",
    menu: "KEYCODE_MENU",
    search: "KEYCODE_SEARCH",
  };

  async function key(name: unknown, requestedSerial?: string): Promise<OpOutcome> {
    const target = await resolveTarget(requestedSerial);
    if (!target.ok) return target.outcome;
    const keyName = typeof name === "string" ? name.toLowerCase() : "";
    const keycode = ALLOWED_KEYS[keyName];
    if (!keycode) {
      return failureOutcome(
        `Key "${String(name)}" is not in the allowed key set (${Object.keys(ALLOWED_KEYS).join(", ")})`,
        "invalid_arg",
      );
    }
    const res = await runAdb(adbDeps(deps.shell), {
      serial: target.serial,
      args: ["shell", "input", "keyevent", keycode],
      timeoutMs: ANDROID_TIMEOUTS.key,
    });
    if (!res.ok) return adbFailureOutcome(`key ${keyName} failed`, res.failure!, res.status);
    return outcome(true, `Sent ${keycode} ("${keyName}"). ${UNVERIFIED_NOTE}`, {
      serial: target.serial, key: keyName, keycode,
    });
  }

  /**
   * Strict charset for typed text. The text is placed inside single
   * quotes on the device-side `input text` line, so anything that could
   * break quoting or carry shell meaning is rejected outright:
   * no ' " ` \ $ & | ; < > ( ) { } [ ] ~ ^ % or control characters.
   * (% is excluded because `input` itself treats %s as the space escape —
   * exactness matters more than the character.)
   */
  const TEXT_CHARSET = /^[A-Za-z0-9 .,!?@#*_+\-=:/;]{1,200}$/;

  async function typeText(text: unknown, requestedSerial?: string): Promise<OpOutcome> {
    const target = await resolveTarget(requestedSerial);
    if (!target.ok) return target.outcome;
    if (typeof text !== "string" || text.length === 0) {
      return failureOutcome("text must be a non-empty string", "invalid_arg");
    }
    if (!TEXT_CHARSET.test(text)) {
      const bad = [...text].find((ch) => !new RegExp(TEXT_CHARSET.source).test(ch));
      return failureOutcome(
        `text contains an unsupported character "${bad ?? "?"}" — allowed: A–Z a–z 0–9 space .,! ? @ # * _ + - = : / ; (max 200 chars)`,
        "invalid_arg",
      );
    }
    // Device-side form: input text '<escaped>' — spaces become %s (the
    // input binary's space escape); the surrounding single quotes keep
    // the device shell from reinterpreting anything.
    const escaped = `'${text.replace(/ /g, "%s")}'`;
    const res = await runAdb(adbDeps(deps.shell), {
      serial: target.serial,
      args: ["shell", "input", "text", escaped],
      timeoutMs: ANDROID_TIMEOUTS.text,
    });
    if (!res.ok) return adbFailureOutcome("text input failed", res.failure!, res.status);
    return outcome(true, `Typed ${text.length} character(s). ${UNVERIFIED_NOTE}`, {
      serial: target.serial, length: text.length,
    });
  }

  // ─── App launching ──────────────────────────────────────────────

  async function openApp(pkg: unknown, requestedSerial?: string): Promise<OpOutcome> {
    const target = await resolveTarget(requestedSerial);
    if (!target.ok) return target.outcome;
    if (typeof pkg !== "string" || !PACKAGE_RE.test(pkg)) {
      return failureOutcome(`"${String(pkg)}" is not a valid package name`, "invalid_arg");
    }
    if (!isPackageAllowed(policy(), pkg)) {
      return failureOutcome(
        `Package "${pkg}" is not in the allowed package list. Add it to android.json packages or LITT_ANDROID_PACKAGES.`,
        "not_allowlisted",
      );
    }
    const adb = adbDeps(deps.shell);
    const res = await runAdb(adb, {
      serial: target.serial,
      args: ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"],
      timeoutMs: ANDROID_TIMEOUTS.openApp,
    });
    if (!res.ok) return adbFailureOutcome(`open_app ${pkg} failed`, res.failure!, res.status);

    // Verify: wait for the window manager to settle, then check the
    // focused window's package. This is the difference between
    // "command sent" and "app actually opened".
    await sleep(900);
    const fg = await foregroundApp(target.serial);
    if (fg === pkg) {
      return outcome(true, `Opened ${pkg} — verified foreground.`, {
        serial: target.serial, package: pkg, foregroundPackage: fg,
      }, { verified: true });
    }
    return outcome(false,
      `Launch command sent but foreground shows "${fg ?? "unknown"}", not "${pkg}". The app may have failed to start.`,
      { serial: target.serial, package: pkg, foregroundPackage: fg },
    );
  }

  // ─── Screenshot ─────────────────────────────────────────────────

  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function isPng(bytes: Uint8Array | null): boolean {
    if (!bytes || bytes.length < PNG_MAGIC.length) return false;
    return PNG_MAGIC.every((b, i) => bytes[i] === b);
  }

  /** Contain a local destination inside the allowed roots. */
  function resolveLocalDest(
    name: string,
    explicit: string | undefined,
    allowedRoots: string[],
  ): { ok: true; path: string } | { ok: false; outcome: OpOutcome } {
    let abs: string;
    if (!explicit || explicit.trim() === "") {
      abs = join(littHome, "captures", name);
    } else {
      const resolved = resolve(explicit);
      const inside = allowedRoots.some((root) => {
        const r = resolve(root);
        return resolved === r || resolved.startsWith(r + sep) || resolved.startsWith(r + "/") || resolved.startsWith(r + "\\");
      });
      if (!inside) {
        return {
          ok: false,
          outcome: failureOutcome(
            `Destination "${explicit}" is outside the allowed directories (${allowedRoots.join(", ")})`,
            "invalid_arg",
          ),
        };
      }
      abs = resolved;
    }
    return { ok: true, path: abs };
  }

  async function screenshot(requestedSerial?: string, destPath?: string): Promise<OpOutcome> {
    const target = await resolveTarget(requestedSerial);
    if (!target.ok) return target.outcome;
    const serial = target.serial;
    const adb = adbDeps(deps.shell);
    const name = `screenshot_${now()}.png`;
    const remote = `${REMOTE_LITT_DIR}/${name}`;

    const dest = resolveLocalDest(name, destPath, [join(littHome, "captures"), deps.shell.cwd]);
    if (!dest.ok) return dest.outcome;

    // 1. Ensure the remote LiTT dir exists.
    const mk = await runAdb(adb, { serial, args: ["shell", "mkdir", "-p", REMOTE_LITT_DIR], timeoutMs: ANDROID_TIMEOUTS.screenshot });
    if (!mk.ok) return adbFailureOutcome("screenshot: could not prepare remote dir", mk.failure!, mk.status);

    // 2. Capture on-device (binary stays on the device — no stdout mangling).
    const cap = await runAdb(adb, { serial, args: ["shell", "screencap", "-p", remote], timeoutMs: ANDROID_TIMEOUTS.screenshot });
    if (!cap.ok) return adbFailureOutcome("screenshot: capture failed", cap.failure!, cap.status);

    // 3. Pull to the local destination.
    mkdirp(dirname(dest.path));
    const pull = await runAdb(adb, { serial, args: ["pull", remote, dest.path], timeoutMs: ANDROID_TIMEOUTS.pull });
    // 4. Always attempt remote cleanup — it is our own file.
    await runAdb(adb, { serial, args: ["shell", "rm", "-f", remote], timeoutMs: ANDROID_TIMEOUTS.discovery });
    if (!pull.ok) return adbFailureOutcome("screenshot: pull failed", pull.failure!, pull.status);

    // 5. Verify: file exists, non-empty, real PNG magic — not just exit 0.
    const bytes = readFileBytes(dest.path);
    if (!isPng(bytes)) {
      return outcome(false,
        `screenshot pulled to ${dest.path} but the file is missing or not a valid PNG — not counting as captured.`,
        { serial, path: dest.path, bytes: bytes?.length ?? 0 });
    }
    return outcome(true, `Screenshot captured → ${dest.path} (${bytes!.length} bytes, PNG verified).`, {
      serial, path: dest.path, bytes: bytes!.length,
    }, { verified: true });
  }

  // ─── File transfer (confined to REMOTE_LITT_DIR) ────────────────

  /** Remote filenames: basename only — no separators, no traversal. */
  const REMOTE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

  function validRemoteName(name: unknown): name is string {
    return typeof name === "string" && REMOTE_NAME_RE.test(name) && !name.includes("..");
  }

  async function pushFile(
    localPath: unknown, remoteName: unknown, requestedSerial?: string,
  ): Promise<OpOutcome> {
    const target = await resolveTarget(requestedSerial);
    if (!target.ok) return target.outcome;
    if (typeof localPath !== "string" || localPath.trim() === "") {
      return failureOutcome("push requires a local file path", "invalid_arg");
    }
    const local = resolve(localPath);
    const st = statFile(local);
    if (!st || !st.isFile) {
      return failureOutcome(`Local file "${localPath}" does not exist or is not a file`, "invalid_arg");
    }
    const name = remoteName === undefined || remoteName === null || remoteName === ""
      ? basename(local)
      : remoteName;
    if (!validRemoteName(name)) {
      return failureOutcome(
        `Remote name "${String(name)}" is invalid — basename only (letters, digits, . _ -), no path separators or "..". Files are confined to ${REMOTE_LITT_DIR}/.`,
        "invalid_arg",
      );
    }
    const adb = adbDeps(deps.shell);
    const remote = `${REMOTE_LITT_DIR}/${name}`;
    const mk = await runAdb(adb, { serial: target.serial, args: ["shell", "mkdir", "-p", REMOTE_LITT_DIR], timeoutMs: ANDROID_TIMEOUTS.push });
    if (!mk.ok) return adbFailureOutcome("push: could not prepare remote dir", mk.failure!, mk.status);
    const res = await runAdb(adb, { serial: target.serial, args: ["push", local, remote], timeoutMs: ANDROID_TIMEOUTS.push });
    if (!res.ok) return adbFailureOutcome("push failed", res.failure!, res.status);

    // Verify remote size matches local size.
    const stat = await runAdb(adb, {
      serial: target.serial,
      args: ["shell", "stat", "-c", "%s", remote],
      timeoutMs: ANDROID_TIMEOUTS.discovery,
    });
    const remoteSize = strictInt(stat.stdout.trim());
    const verified = stat.ok && remoteSize === st.size;
    return outcome(verified,
      verified
        ? `Pushed ${local} → ${remote} (${st.size} bytes, verified).`
        : `Push completed (exit 0) but remote size check returned ${remoteSize ?? "unknown"} vs local ${st.size} — unverified.`,
      { serial: target.serial, localPath: local, remotePath: remote, bytes: st.size },
      { verified });
  }

  async function pullFile(
    remoteName: unknown, destDir: unknown, requestedSerial?: string,
  ): Promise<OpOutcome> {
    const target = await resolveTarget(requestedSerial);
    if (!target.ok) return target.outcome;
    if (!validRemoteName(remoteName)) {
      return failureOutcome(
        `Remote name "${String(remoteName)}" is invalid — basename only. Files are confined to ${REMOTE_LITT_DIR}/.`,
        "invalid_arg",
      );
    }
    const remote = `${REMOTE_LITT_DIR}/${remoteName}`;
    const dir = typeof destDir === "string" && destDir.trim() !== "" ? destDir : join(littHome, "captures");
    const dest = resolveLocalDest(remoteName as string, join(dir, remoteName as string),
      [join(littHome, "captures"), deps.shell.cwd]);
    if (!dest.ok) return dest.outcome;

    const adb = adbDeps(deps.shell);
    const res = await runAdb(adb, { serial: target.serial, args: ["pull", remote, dest.path], timeoutMs: ANDROID_TIMEOUTS.pull });
    if (!res.ok) return adbFailureOutcome("pull failed", res.failure!, res.status);
    const st = statFile(dest.path);
    const verified = st !== null && st.isFile && st.size > 0;
    return outcome(verified,
      verified
        ? `Pulled ${remote} → ${dest.path} (${st!.size} bytes, verified).`
        : `Pull completed (exit 0) but ${dest.path} is missing or empty — unverified.`,
      { serial: target.serial, remotePath: remote, localPath: dest.path, bytes: st?.size ?? 0 },
      { verified });
  }

  return {
    listDevices,
    deviceState,
    foregroundApp,
    screenSize,
    tap,
    swipe,
    key,
    typeText,
    openApp,
    screenshot,
    pushFile,
    pullFile,
  };
}

export type AndroidOps = ReturnType<typeof createAndroidOps>;
