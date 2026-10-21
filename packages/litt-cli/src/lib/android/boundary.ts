/**
 * Android device-identity boundary validator.
 *
 * Registered with agent-core's runCommand() so every device-targeting
 * `adb` invocation — project.run, /local machine lane, litt run —
 * must pass the android.json allowlist BEFORE reaching the shell
 * executor. Reuses loadAndroidPolicy(), resolveSerial() helpers and
 * isSerialAllowed(); fails closed on any ambiguity.
 */

import {
  extractAdbInvocation,
  type AdbTargetValidation,
  type ShellExecutor,
} from "@litt/agent-core";
import { runAdb, parseAdbDevices, type AdbDeps } from "./adb-client.js";
import {
  loadAndroidPolicy,
  isSerialAllowed,
  SERIAL_RE,
  type AndroidPolicy,
} from "./device-registry.js";

export interface BoundaryDeps {
  policyProvider?: () => AndroidPolicy;
  env?: (key: string) => string | undefined;
  adbPath?: string | null;
  which?: (command: string) => string | null;
}

function deny(reason: string): AdbTargetValidation {
  return { ok: false, reason };
}

export async function validateAdbTarget(
  args: string[],
  shell: ShellExecutor,
  deps: BoundaryDeps = {},
): Promise<AdbTargetValidation> {
  const env = deps.env ?? ((k: string) => process.env[k]);
  const policy = deps.policyProvider?.() ?? loadAndroidPolicy({ env });
  const { serial, transportId } = extractAdbInvocation(args);

  // -t targets a transport id, not a serial — it cannot be checked
  // against the serial allowlist, so it is rejected rather than
  // silently allowed.
  if (transportId !== undefined) {
    return deny(`adb -t (transport ${transportId}) targeting is not permitted — use -s <serial>`);
  }

  // Environment-selected target: adb honors ANDROID_SERIAL when -s is
  // absent — it must pass the same allowlist as an explicit serial.
  const explicit = serial ?? env("ANDROID_SERIAL") ?? undefined;

  // Enumerate devices — explicit targets must be connected AND usable;
  // implicit targets must resolve unambiguously to an allowlisted one.
  const adbDeps: AdbDeps = { shell, adbPath: deps.adbPath ?? null, env, which: deps.which };
  const list = await runAdb(adbDeps, { args: ["devices", "-l"], timeoutMs: 10_000 });
  if (!list.ok) {
    return deny(`could not enumerate devices: ${list.failure?.kind ?? "adb error"}`);
  }
  const connected = parseAdbDevices(list.stdout);
  const usable = connected.filter((d) => d.usable);

  if (explicit !== undefined) {
    if (!SERIAL_RE.test(explicit)) return deny(`malformed device serial "${explicit}"`);
    if (!isSerialAllowed(policy, explicit)) {
      return deny(`device "${explicit}" is not in the Android allowlist`);
    }
    const dev = connected.find((d) => d.serial === explicit);
    if (!dev) return deny(`allowlisted device "${explicit}" is not attached`);
    if (!dev.usable) return deny(`device "${explicit}" is attached but state="${dev.state}"`);
    return { ok: true };
  }

  // Implicit target — adb would act on the sole connected device.
  if (usable.length === 0) return deny("no usable device attached");
  if (usable.length > 1) {
    return deny(`implicit target is ambiguous — ${usable.length} devices attached; pass -s <serial>`);
  }
  const only = usable[0];
  if (!isSerialAllowed(policy, only.serial)) {
    return deny(`connected device "${only.serial}" is not in the Android allowlist`);
  }
  return { ok: true };
}
