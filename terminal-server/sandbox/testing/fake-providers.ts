/**
 * Reference fake sandbox providers — test doubles for the Phase 0
 * verification canary (../canary.ts).
 *
 * `FakeSandboxProvider` is a faithful in-memory implementation of the
 * SandboxProvider contract: each sandbox gets its own filesystem map
 * and environment, exec round-trips really read and write that state,
 * and destroy really removes it. Behavior knobs model the failure
 * classes the canary exists to catch, one per variant factory below:
 *
 *   createCompliantFakeProvider()       passes every canary check
 *   createSharedFilesystemFakeProvider() tenants share one filesystem
 *   createHostExecFakeProvider()         exec secretly runs on the host
 *                                        (writes land in the real fs)
 *   createOpenEgressFakeProvider()       metadata endpoint is reachable
 *   createProxyDeniedEgressFakeProvider() an intermediary answers the
 *                                        metadata request with its own
 *                                        error (403, no metadata header)
 *                                        — a refusal: no metadata is
 *                                        served, so the canary's
 *                                        verdict rule counts the
 *                                        target as blocked
 *   createNoLimitsFakeProvider()         requested limits ignored
 *   createUnhealthyFakeProvider()        health() reports unhealthy
 *
 * The fake recognises the canary's documented probe commands (shell
 * file operations, printenv, and the node one-liners carrying the
 * EGRESS_PROBE / LIMITS_PROBE / MEMORY_HOG tokens). Any other command
 * exits 127 — fail-closed, so a canary change that introduces a new
 * probe command fails loudly here until the fake learns it.
 *
 * These fakes are how the contract is integration-tested in CI without
 * a vendor account. They are NOT a substitute for running the canary
 * against the real provider before the Phase 4 policy flip (see
 * ../README.md) — they exist so provider authors can validate their
 * integration against the contract's expectations first.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname } from "path";
import {
  DEFAULT_SANDBOX_LIMITS,
  type CreateSandboxInput,
  type ExecuteCommandInput,
  type ExecuteCommandResult,
  type PreviewEndpoint,
  type SandboxInstance,
  type SandboxProvider,
  type SandboxResourceLimits,
  type TerminalConnectOptions,
  type TerminalTransport,
} from "../provider";

export interface FakeSandboxProviderOptions {
  /** health() result. Default true. */
  healthy?: boolean;
  /** All sandboxes (and the "host") share one filesystem map. */
  shareFilesystem?: boolean;
  /** exec reads/writes the REAL filesystem, like a host-exec leak. */
  executeOnHost?: boolean;
  /** Return true for egress targets the sandbox can reach. Default: none reachable. */
  egressOpen?: (url: string) => boolean;
  /** HTTP status the egress probe "receives" for a reachable target. Default 200. */
  egressOpenStatus?: number;
  /**
   * Whether a reachable target's response carries the
   * `Metadata-Flavor: Google` header. Default true (the real metadata
   * service answered); false models an intermediary answering instead.
   */
  egressOpenMetadataFlavor?: boolean;
  /** Ignore requested limits: instances echo defaults and nothing is enforced. */
  ignoreLimits?: boolean;
  /** Values the limits-visibility probe reports when ignoreLimits is set. */
  hostTotalmemBytes?: number;
  hostCpuCount?: number;
}

interface FakeSandboxRecord {
  instance: SandboxInstance;
  env: Record<string, string>;
  fs: Map<string, string>;
  hostFilesWritten: string[];
}

function result(exitCode: number, stdout = "", stderr = ""): ExecuteCommandResult {
  return { exitCode, stdout, stderr, durationMs: 1 };
}

export class FakeSandboxProvider implements SandboxProvider {
  readonly name = "fake";

  private readonly options: FakeSandboxProviderOptions;
  private readonly sandboxes = new Map<string, FakeSandboxRecord>();
  private readonly sharedFs = new Map<string, string>();
  private sequence = 0;

  /** Counts canary-relevant calls so tests can assert dedupe/cleanup. */
  readonly calls = { health: 0, create: 0, execute: 0, destroy: 0 };

  constructor(options: FakeSandboxProviderOptions = {}) {
    this.options = options;
  }

  liveSandboxCount(): number {
    return this.sandboxes.size;
  }

  async health(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    this.calls.health += 1;
    const healthy = this.options.healthy ?? true;
    return {
      healthy,
      details: healthy ? { provider: this.name } : { provider: this.name, reason: "fake provider configured unhealthy" },
    };
  }

  async create(input: CreateSandboxInput): Promise<SandboxInstance> {
    this.calls.create += 1;
    this.sequence += 1;
    const sandboxId = `fake-${this.sequence}`;
    const limits: SandboxResourceLimits = this.options.ignoreLimits
      ? { ...DEFAULT_SANDBOX_LIMITS }
      : { ...DEFAULT_SANDBOX_LIMITS, ...(input.limits ?? {}) };
    const nowIso = new Date().toISOString();
    const instance: SandboxInstance = {
      sandboxId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.projectId,
      state: "running",
      limits,
      createdAt: nowIso,
      startedAt: nowIso,
      lastActiveAt: nowIso,
      stoppedAt: null,
      failureReason: null,
      provider: this.name,
      endpoint: null,
    };
    this.sandboxes.set(sandboxId, {
      instance,
      env: { ...(input.env ?? {}) },
      fs: this.options.shareFilesystem ? this.sharedFs : new Map<string, string>(),
      hostFilesWritten: [],
    });
    return instance;
  }

  async get(sandboxId: string): Promise<SandboxInstance | null> {
    return this.sandboxes.get(sandboxId)?.instance ?? null;
  }

  async start(_sandboxId: string): Promise<void> {}

  async stop(_sandboxId: string): Promise<void> {}

  async destroy(sandboxId: string): Promise<void> {
    this.calls.destroy += 1;
    const record = this.sandboxes.get(sandboxId);
    if (record && this.options.executeOnHost) {
      for (const path of record.hostFilesWritten) {
        try {
          rmSync(path, { force: true });
        } catch {
          // best-effort cleanup of leaked test files
        }
      }
    }
    this.sandboxes.delete(sandboxId);
  }

  async connectTerminal(
    _sandboxId: string,
    _options: TerminalConnectOptions,
  ): Promise<TerminalTransport> {
    throw new Error("FakeSandboxProvider does not support terminal attach");
  }

  async exposePort(_sandboxId: string, _port: number): Promise<PreviewEndpoint> {
    throw new Error("FakeSandboxProvider does not support port exposure");
  }

  async execute(
    sandboxId: string,
    input: ExecuteCommandInput,
  ): Promise<ExecuteCommandResult> {
    this.calls.execute += 1;
    const record = this.sandboxes.get(sandboxId);
    if (!record) return result(404, "", `no such sandbox: ${sandboxId}`);
    const command = input.command.trim();

    // mkdir -p <dir> && printf '%s' '<text>' > <path>
    let m = command.match(/^mkdir -p \S+ && printf '%s' '([^']*)' > (\S+)$/);
    if (m) {
      this.writeFile(record, m[2], m[1]);
      return result(0);
    }

    // printf '%s' '<text>' > <path>
    m = command.match(/^printf '%s' '([^']*)' > (\S+)$/);
    if (m) {
      this.writeFile(record, m[2], m[1]);
      return result(0);
    }

    // cat <path>
    m = command.match(/^cat (\S+)$/);
    if (m) {
      const content = this.readFile(record, m[1]);
      return content === null
        ? result(1, "", `cat: ${m[1]}: No such file or directory`)
        : result(0, content);
    }

    // printenv <NAME>
    m = command.match(/^printenv (\S+)$/);
    if (m) {
      const value = record.env[m[1]];
      return value === undefined ? result(1) : result(0, `${value}\n`);
    }

    // Egress probe (node one-liner carrying the EGRESS_PROBE token)
    if (command.includes("EGRESS_PROBE")) {
      const urlMatch = command.match(/https?:\/\/[^\s"\\]+/);
      const url = urlMatch?.[0] ?? "";
      const open = this.options.egressOpen?.(url) ?? false;
      return result(
        0,
        open
          ? `EGRESS_OPEN ${this.options.egressOpenStatus ?? 200} flavor=${this.options.egressOpenMetadataFlavor === false ? "absent" : "present"}`
          : "EGRESS_BLOCKED",
      );
    }

    // Limits visibility probe (LIMITS_PROBE token)
    if (command.includes("LIMITS_PROBE")) {
      const payload = this.options.ignoreLimits
        ? {
            totalmemBytes: this.options.hostTotalmemBytes ?? 64 * 1073741824,
            cpuCount: this.options.hostCpuCount ?? 16,
          }
        : {
            totalmemBytes: Math.floor(record.instance.limits.memoryMB * 1048576 * 0.98),
            cpuCount: record.instance.limits.cpuVcpus,
          };
      return result(0, JSON.stringify(payload));
    }

    // Memory hog (MEMORY_HOG token): enforces the sandbox's memory limit
    if (command.includes("MEMORY_HOG")) {
      const targetMatch = command.match(/const target=(\d+)/);
      const target = targetMatch ? Number(targetMatch[1]) : 0;
      const limitBytes = record.instance.limits.memoryMB * 1048576;
      if (!this.options.ignoreLimits && target > limitBytes) {
        return result(137, "", "Killed");
      }
      return result(0, `HOG_COMPLETED ${target}`);
    }

    return result(127, "", `fake provider: unsupported command: ${command.slice(0, 80)}`);
  }

  private writeFile(record: FakeSandboxRecord, path: string, content: string): void {
    if (this.options.executeOnHost) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
      record.hostFilesWritten.push(path);
      return;
    }
    record.fs.set(path, content);
  }

  private readFile(record: FakeSandboxRecord, path: string): string | null {
    if (this.options.executeOnHost) {
      try {
        return existsSync(path) ? readFileSync(path, "utf8") : null;
      } catch {
        return null;
      }
    }
    return record.fs.get(path) ?? null;
  }
}

// ─── Variant factories: one per failure class the canary must catch ──

export function createCompliantFakeProvider(): FakeSandboxProvider {
  return new FakeSandboxProvider();
}

export function createSharedFilesystemFakeProvider(): FakeSandboxProvider {
  return new FakeSandboxProvider({ shareFilesystem: true });
}

export function createHostExecFakeProvider(): FakeSandboxProvider {
  return new FakeSandboxProvider({ executeOnHost: true });
}

export function createOpenEgressFakeProvider(): FakeSandboxProvider {
  return new FakeSandboxProvider({ egressOpen: () => true });
}

export function createProxyDeniedEgressFakeProvider(): FakeSandboxProvider {
  return new FakeSandboxProvider({
    egressOpen: () => true,
    egressOpenStatus: 403,
    egressOpenMetadataFlavor: false,
  });
}

export function createNoLimitsFakeProvider(): FakeSandboxProvider {
  return new FakeSandboxProvider({ ignoreLimits: true });
}

export function createUnhealthyFakeProvider(): FakeSandboxProvider {
  return new FakeSandboxProvider({ healthy: false });
}
