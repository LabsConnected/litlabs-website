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
 * Phase 2 lifecycle additions (same fail-closed rule): the file
 * transfer capability over the in-memory filesystem, port exposure
 * with a deliberately unroutable host, timeout extension recording,
 * and exec shapes for the lifecycle's own commands — a small git
 * model (clone / remote set-url / config --get / rev-parse),
 * package-manager install, `test -d/-f`, `ln -sfn`, the detached
 * preview start template, and `kill <pid>`. start/stop now track the
 * instance state the contract promises (the canary never calls them,
 * so Phase 0/1 behavior is unchanged).
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
  type SandboxFileEntry,
  type SandboxFileTransfer,
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
  /**
   * Phase 2 lifecycle: files a fake `git clone` materializes in the
   * working tree (paths relative to the clone target). Defaults to a
   * single README so sync-back has something real to carry.
   */
  cloneFiles?: Record<string, string>;
  /**
   * Phase 2 lifecycle NEGATIVE knob: when true, the fake clone writes
   * the per-command token env value into .git/config (simulating a
   * URL-embedded token), so the lifecycle's fatal verify step has a
   * real leak to catch. Never set outside that one test class.
   */
  cloneLeaksTokenIntoConfig?: boolean;
}

interface FakeGitRepo {
  config: string;
  head: string;
  branch: string;
}

interface FakeSandboxRecord {
  instance: SandboxInstance;
  env: Record<string, string>;
  fs: Map<string, string>;
  hostFilesWritten: string[];
  /** Phase 2: explicit directories (the fs map alone cannot see empty ones). */
  dirs: Set<string>;
  /** Phase 2: symlink path -> target as stored. */
  links: Map<string, string>;
  /** Phase 2: git repositories keyed by absolute repo directory. */
  gitRepos: Map<string, FakeGitRepo>;
  /** Phase 2: the detached preview process, once started. */
  previewPid: number | null;
  /** Phase 2: extendTimeout calls, in ms. */
  timeoutExtensions: number[];
  /** Phase 2: monotonic clock for file mtimes. */
  clock: number;
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
      dirs: new Set(["/workspace"]),
      links: new Map(),
      gitRepos: new Map(),
      previewPid: null,
      timeoutExtensions: [],
      clock: 0,
    });
    return instance;
  }

  async get(sandboxId: string): Promise<SandboxInstance | null> {
    const record = this.sandboxes.get(sandboxId);
    return record ? { ...record.instance } : null;
  }

  async start(sandboxId: string): Promise<void> {
    const record = this.sandboxes.get(sandboxId);
    if (record) record.instance.state = "running";
  }

  async stop(sandboxId: string): Promise<void> {
    const record = this.sandboxes.get(sandboxId);
    if (record) record.instance.state = "stopped";
  }

  /** Timeout extensions recorded for a sandbox (preview keepalive tests). */
  timeoutExtensionsFor(sandboxId: string): number[] {
    return this.sandboxes.get(sandboxId)?.timeoutExtensions ?? [];
  }

  async extendTimeout(sandboxId: string, timeoutMs: number): Promise<void> {
    const record = this.sandboxes.get(sandboxId);
    if (record) record.timeoutExtensions.push(timeoutMs);
  }

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

  async exposePort(sandboxId: string, port: number): Promise<PreviewEndpoint> {
    const record = this.sandboxes.get(sandboxId);
    if (!record) throw new Error(`no such sandbox: ${sandboxId}`);
    return {
      port,
      // Deliberately unroutable host: tests assert this string never
      // reaches a browser-facing surface (design note §3.5).
      url: `https://fake-preview-${sandboxId}-${port}.invalid`,
      state: "private",
      previewToken: `fake-traffic-${sandboxId}`,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  }

  /**
   * Phase 2 file transfer over the in-memory filesystem. Paths are
   * absolute sandbox paths; listing paths come back relative to the
   * listed root, matching the real providers' contract.
   */
  readonly fileTransfer: SandboxFileTransfer = {
    readFile: async (sandboxId, path) => {
      const record = this.recordFor(sandboxId);
      const content = this.readFile(record, path);
      if (content === null) throw new Error(`no such file: ${path}`);
      return new TextEncoder().encode(content);
    },
    writeFile: async (sandboxId, path, data) => {
      const record = this.recordFor(sandboxId);
      this.writeFile(record, path, new TextDecoder().decode(data));
      this.registerParents(record, path);
    },
    listDir: async (sandboxId, path) => {
      const record = this.recordFor(sandboxId);
      return this.listEntries(record, path, false);
    },
    listTree: async (sandboxId, path) => {
      const record = this.recordFor(sandboxId);
      return this.listEntries(record, path, true);
    },
    removePath: async (sandboxId, path) => {
      const record = this.recordFor(sandboxId);
      this.removePath(record, path);
    },
    makeDir: async (sandboxId, path) => {
      const record = this.recordFor(sandboxId);
      record.dirs.add(path);
      this.registerParents(record, path);
    },
    renamePath: async (sandboxId, oldPath, newPath) => {
      const record = this.recordFor(sandboxId);
      const content = this.readFile(record, oldPath);
      if (content !== null) {
        this.writeFile(record, newPath, content);
        record.fs.delete(oldPath);
        return;
      }
      if (record.links.has(oldPath)) {
        record.links.set(newPath, record.links.get(oldPath) as string);
        record.links.delete(oldPath);
        return;
      }
      // Directory rename: move every key under the prefix.
      const prefix = `${oldPath}/`;
      for (const key of [...record.fs.keys()]) {
        if (key.startsWith(prefix)) {
          record.fs.set(`${newPath}${key.slice(oldPath.length)}`, record.fs.get(key) as string);
          record.fs.delete(key);
        }
      }
      record.dirs.delete(oldPath);
      record.dirs.add(newPath);
    },
  };

  private recordFor(sandboxId: string): FakeSandboxRecord {
    const record = this.sandboxes.get(sandboxId);
    if (!record) throw new Error(`no such sandbox: ${sandboxId}`);
    return record;
  }

  private registerParents(record: FakeSandboxRecord, path: string): void {
    const parts = path.split("/").filter(Boolean);
    let current = "";
    for (const part of parts.slice(0, -1)) {
      current += `/${part}`;
      record.dirs.add(current);
    }
  }

  private removePath(record: FakeSandboxRecord, path: string): void {
    record.fs.delete(path);
    record.links.delete(path);
    if (record.dirs.has(path)) {
      record.dirs.delete(path);
      const prefix = `${path}/`;
      for (const key of [...record.fs.keys()]) {
        if (key.startsWith(prefix)) record.fs.delete(key);
      }
      for (const key of [...record.links.keys()]) {
        if (key.startsWith(prefix)) record.links.delete(key);
      }
      for (const dir of [...record.dirs]) {
        if (dir.startsWith(prefix)) record.dirs.delete(dir);
      }
    }
  }

  private listEntries(
    record: FakeSandboxRecord,
    rootPath: string,
    recursive: boolean,
  ): SandboxFileEntry[] {
    const root = rootPath.endsWith("/") ? rootPath.slice(0, -1) : rootPath;
    const prefix = `${root}/`;
    const out = new Map<string, SandboxFileEntry>();
    const consider = (absPath: string, entry: SandboxFileEntry) => {
      if (!absPath.startsWith(prefix)) return;
      const rel = absPath.slice(prefix.length);
      if (!rel) return;
      if (!recursive && rel.includes("/")) return;
      out.set(rel, { ...entry, path: rel });
    };
    for (const dir of record.dirs) {
      consider(dir, { path: "", type: "dir", size: 0, mtimeMs: 0, mode: 0o755 });
    }
    for (const [absPath, content] of record.fs) {
      consider(absPath, {
        path: "",
        type: "file",
        size: new TextEncoder().encode(content).length,
        mtimeMs: 0,
        mode: 0o644,
      });
    }
    for (const [absPath, target] of record.links) {
      consider(absPath, {
        path: "",
        type: "symlink",
        size: 0,
        mtimeMs: 0,
        mode: 0o777,
        linkTarget: target,
      });
    }
    return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
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

    // printenv <NAME> — per-command env (input.env) layers over the
    // sandbox's create-time env for this call only, like a real
    // provider's envs-for-one-command semantics.
    m = command.match(/^printenv (\S+)$/);
    if (m) {
      const value = input.env?.[m[1]] ?? record.env[m[1]];
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

    // ─── Phase 2 lifecycle shapes ─────────────────────────────────
    // The lifecycle lane's own commands (git clone/verify, dependency
    // install, detached preview start/stop, symlink creation, path
    // probes). Tokenized with the same single/double-quote rules the
    // executor's argv-safe builder emits.
    const argv = splitShellArgs(command);
    const cwd = input.cwd ?? "/workspace";

    if (argv[0] === "git") {
      return this.executeGit(record, argv.slice(1), cwd, input.env ?? {});
    }

    // <pm> install ... — materialize node_modules like a real install.
    if (
      (argv[0] === "pnpm" || argv[0] === "npm" || argv[0] === "yarn") &&
      argv[1] === "install"
    ) {
      record.dirs.add(`${cwd}/node_modules`);
      this.writeFile(record, `${cwd}/node_modules/.fake-installed`, "1");
      return result(0);
    }
    if (
      (argv[0] === "pnpm" || argv[0] === "npm" || argv[0] === "yarn") &&
      argv[1] === "add"
    ) {
      return result(0);
    }

    // test -d <path> / test -f <path>
    if (argv[0] === "test" && argv.length === 3) {
      if (argv[1] === "-d") {
        const exists =
          record.dirs.has(argv[2]) ||
          [...record.fs.keys()].some((k) => k.startsWith(`${argv[2]}/`));
        return result(exists ? 0 : 1);
      }
      if (argv[1] === "-f") {
        return result(record.fs.has(argv[2]) ? 0 : 1);
      }
    }

    // ln -sfn <target> <path>
    if (argv[0] === "ln" && argv[1] === "-sfn" && argv.length === 4) {
      record.links.set(argv[3], argv[2]);
      this.registerParents(record, argv[3]);
      return result(0);
    }

    // Detached preview start (sandbox-runtime's fixed template):
    // setsid nohup bash <script> >> <log> 2>&1 < /dev/null & echo $! > <pid>
    const previewStart = command.match(
      /^setsid nohup bash (\S+) >> (\S+) 2>&1 < \/dev\/null & echo \$! > (\S+)$/,
    );
    if (previewStart) {
      this.sequence += 1;
      const pid = 4200 + this.sequence;
      record.previewPid = pid;
      this.writeFile(record, previewStart[3], `${pid}\n`);
      const prior = this.readFile(record, previewStart[2]) ?? "";
      this.writeFile(record, previewStart[2], `${prior}[fake preview] dev server started\n`);
      return result(0);
    }

    // kill [-TERM] <pid | -pgid> — the preview stop path (the pid is
    // read from the pid file; the sandbox runtime kills the group).
    if (argv[0] === "kill") {
      const target = argv[argv.length - 1] ?? "";
      const pid = Number(target.replace(/^-/, ""));
      if (/^-?\d+$/.test(target) && Number.isFinite(pid)) {
        if (record.previewPid === pid) {
          record.previewPid = null;
          return result(0);
        }
        return result(1, "", `kill: (${pid}) - No such process`);
      }
    }

    return result(127, "", `fake provider: unsupported command: ${command.slice(0, 80)}`);
  }

  /**
   * The fake git model (Phase 2 lifecycle). Repos are keyed by
   * absolute directory; clone materializes `.git/config` + HEAD + the
   * configured working-tree files. The credential env is NEVER
   * written into the config — exactly like real git with a credential
   * helper — unless the cloneLeaksTokenIntoConfig negative knob is
   * set, which exists so the verify step has a leak to catch.
   */
  private executeGit(
    record: FakeSandboxRecord,
    args: string[],
    cwd: string,
    env: Record<string, string>,
  ): ExecuteCommandResult {
    // Skip global options: -c <kv> pairs before the subcommand.
    let i = 0;
    while (args[i] === "-c" && i + 1 < args.length) i += 2;
    const sub = args[i];
    const rest = args.slice(i + 1);

    if (sub === "clone") {
      let branch = "main";
      const positional: string[] = [];
      for (let j = 0; j < rest.length; j += 1) {
        if (rest[j] === "--depth") j += 1;
        else if (rest[j] === "--branch") branch = rest[++j] ?? branch;
        else positional.push(rest[j]);
      }
      const [url, target] = positional;
      if (!url || !target) return result(129, "", "usage: git clone <repo> [<dir>]");
      const repoDir = target === "."
        ? cwd
        : target.startsWith("/")
          ? target
          : `${cwd}/${target}`;
      this.sequence += 1;
      const head = `f00d${this.sequence}`.padStart(40, "0");
      let config =
        `[core]\n\trepositoryformatversion = 0\n` +
        `[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`;
      if (this.options.cloneLeaksTokenIntoConfig) {
        const leaked = Object.values(env)[0] ?? "";
        if (leaked) config += `\t; leaked credential: ${leaked}\n`;
      }
      record.gitRepos.set(repoDir, { config, head, branch });
      record.dirs.add(repoDir);
      record.dirs.add(`${repoDir}/.git`);
      this.writeFile(record, `${repoDir}/.git/config`, config);
      this.writeFile(record, `${repoDir}/.git/HEAD`, `ref: refs/heads/${branch}\n`);
      const files = this.options.cloneFiles ?? { "README.md": "# fake clone\n" };
      for (const [rel, content] of Object.entries(files)) {
        this.writeFile(record, `${repoDir}/${rel}`, content);
        this.registerParents(record, `${repoDir}/${rel}`);
      }
      return result(0, "", `Cloning into '${target}'...`);
    }

    const repo = record.gitRepos.get(cwd);
    if (!repo) return result(128, "", "fatal: not a git repository");

    if (sub === "remote" && rest[0] === "set-url" && rest[1] === "origin" && rest[2]) {
      repo.config = repo.config.replace(/url = .*/, `url = ${rest[2]}`);
      this.writeFile(record, `${cwd}/.git/config`, repo.config);
      return result(0);
    }
    if (sub === "config" && rest[0] === "--get" && rest[1] === "remote.origin.url") {
      const url = repo.config.match(/url = (.*)/)?.[1] ?? "";
      return result(0, `${url}\n`);
    }
    if (sub === "config") {
      // git config gc.auto 0 / user.* — accepted, kept in memory only.
      return result(0);
    }
    if (sub === "rev-parse" && rest[0] === "HEAD") {
      return result(0, `${repo.head}\n`);
    }
    return result(127, "", `fake provider: unsupported git command: ${sub ?? ""}`);
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

/**
 * Minimal shell tokenizer for the fake's Phase 2 command shapes:
 * whitespace splits, single quotes are literal (with the standard
 * '\'' escape), double quotes group, backslash escapes the next char.
 * Understands exactly what the workspace executor's argv-safe command
 * builder emits; it is not a shell.
 */
export function splitShellArgs(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let hasCurrent = false;
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      hasCurrent = true;
      i += 1;
      while (i < command.length && command[i] !== "'") {
        current += command[i];
        i += 1;
      }
      i += 1; // closing quote
      continue;
    }
    if (ch === '"') {
      hasCurrent = true;
      i += 1;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === "\\" && i + 1 < command.length) {
          current += command[i + 1];
          i += 2;
        } else {
          current += command[i];
          i += 1;
        }
      }
      i += 1;
      continue;
    }
    if (ch === "\\" && i + 1 < command.length) {
      hasCurrent = true;
      current += command[i + 1];
      i += 2;
      continue;
    }
    if (ch === " " || ch === "\t") {
      if (hasCurrent) {
        args.push(current);
        current = "";
        hasCurrent = false;
      }
      i += 1;
      continue;
    }
    hasCurrent = true;
    current += ch;
    i += 1;
  }
  if (hasCurrent) args.push(current);
  return args;
}
