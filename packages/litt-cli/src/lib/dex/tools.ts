/**
 * dex.* tool family — the phone-side agent link.
 *
 * Only dex.status is implemented. The Dex v2.0 command interface on
 * the phone could not be verified during integration (sshd was not
 * running), so no command-forwarding tool is exposed — a tool that
 * cannot be verified is a tool that must not exist.
 */

import type { ToolDefinition, ToolEntry, ToolHandler, ToolMetadata, ToolResult } from "@litt/agent-core";
import { probeDex, formatDexStatus, type DexProbeDeps } from "./dex-link.js";
import type { AndroidPolicy } from "../android/device-registry.js";

const READ_ONLY_META: ToolMetadata = { projectScoped: false, mutating: false, readOnly: true };

export interface DexToolDeps {
  policyProvider?: () => AndroidPolicy;
  adbPath?: string | null;
  env?: (key: string) => string | undefined;
  which?: (command: string) => string | null;
  probeDeps?: Partial<DexProbeDeps>;
  /** Resolve the adb serial used for `adb forward` (best-effort). */
  adbSerial?: string;
}

export function buildDexToolEntries(deps: DexToolDeps = {}): Record<string, ToolEntry> {
  const def: ToolDefinition = {
    id: "dex.status",
    name: "dex_status",
    description:
      "Check whether the phone-side Dex agent link is reachable (Termux sshd via adb-forwarded SSH, pubkey-only) and whether a Dex process is detected. Read-only.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
  };

  const handler: ToolHandler = async (ctx): Promise<ToolResult> => {
    const policy = deps.policyProvider?.();
    const cfg = policy?.dex ?? {
      enabled: true, host: "127.0.0.1", port: 8022, user: "u0_a235",
      keyPath: "", knownHostsPath: "",
    };
    // adb forward needs a target serial — prefer the configured default,
    // then the sole allowlisted serial. Forwarding to an unattached
    // serial fails harmlessly inside probeDex.
    const adbSerial = deps.adbSerial
      ?? policy?.defaultSerial
      ?? (policy && policy.allowedSerials.length === 1 ? policy.allowedSerials[0] : undefined);
    const r = await probeDex(
      {
        shell: ctx.shell,
        adbPath: deps.adbPath ?? null,
        env: deps.env,
        which: deps.which,
        adbSerial,
        ...(deps.probeDeps ?? {}),
      },
      cfg,
    );
    return {
      status: r.linkUp ? "success" : "failed",
      success: r.linkUp,
      message: formatDexStatus(r),
      data: { ...r },
    };
  };

  return { "dex.status": { definition: def, handler, metadata: READ_ONLY_META } };
}
