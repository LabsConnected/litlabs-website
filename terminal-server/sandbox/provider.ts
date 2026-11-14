/**
 * Terminal-side sandbox provider contract.
 *
 * This is the terminal service's mirror of the SandboxProvider interface
 * that already exists on the web side at `src/lib/terminal-v1/`
 * (`sandbox-provider.ts` + `types.ts`). It exists as a separate copy
 * because the terminal service is its own deployable: it does not import
 * from `src/` (see SANDBOX-PLAN.md §1.5, seam S7). The two contracts MUST
 * stay shape-compatible — a provider written against one must be
 * structurally assignable to the other.
 *
 * Phase 0 (verification contract) deliberately depends only on
 * {@link CanaryProvider}, the structural subset of this interface the
 * canary probe actually exercises. Any full SandboxProvider — the
 * DisabledProvider below, the web-side Docker provider, or the Phase 1
 * E2B provider — satisfies that subset by construction.
 *
 * Nothing in this module changes runtime behavior. It is types plus the
 * disabled implementation; the isolation policy is untouched and still
 * fails closed exactly as before.
 */

export interface SandboxResourceLimits {
  cpuVcpus: number;
  memoryMB: number;
  processLimit: number;
  diskGB: number;
  idleTimeoutMinutes: number;
  maxSessionMinutes: number;
}

/** Keep in sync with DEFAULT_SANDBOX_LIMITS in src/lib/terminal-v1/types.ts. */
export const DEFAULT_SANDBOX_LIMITS: SandboxResourceLimits = {
  cpuVcpus: 1,
  memoryMB: 1024,
  processLimit: 100,
  diskGB: 5,
  idleTimeoutMinutes: 15,
  maxSessionMinutes: 120,
};

export type SandboxState =
  | "requested"
  | "provisioning"
  | "ready"
  | "connecting"
  | "running"
  | "idle"
  | "stopping"
  | "stopped"
  | "failed"
  | "deleting"
  | "deleted";

export interface SandboxInstance {
  sandboxId: string;
  workspaceId: string;
  userId: string;
  projectId: string;
  state: SandboxState;
  limits: SandboxResourceLimits;
  createdAt: string;
  startedAt: string | null;
  lastActiveAt: string;
  stoppedAt: string | null;
  failureReason: string | null;
  provider: string;
  endpoint: string | null;
}

export interface CreateSandboxInput {
  workspaceId: string;
  userId: string;
  projectId: string;
  limits?: Partial<SandboxResourceLimits>;
  env?: Record<string, string>;
}

export interface ExecuteCommandInput {
  command: string;
  stdin?: string;
  timeoutMs?: number;
  cwd?: string;
  /**
   * Per-command PROJECT env (Phase 2, design note §1.6): variables
   * that apply to this one command only, layered over the sandbox's
   * composed base env. Identity variables in it are ignored (identity
   * always wins), and providers refuse any value equal to one of the
   * terminal's own platform secrets (env.ts value-based check) — a
   * project's own secrets under the same NAMES are fine. Mirrored on
   * the web-side contract (src/lib/terminal-v1) per the seam rule.
   */
  env?: Record<string, string>;
}

export interface ExecuteCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface TerminalConnectOptions {
  shell: "bash" | "pwsh";
  cols: number;
  rows: number;
  env?: Record<string, string>;
}

export interface TerminalTransport {
  sessionId: string;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  onOutput: (callback: (data: string) => void) => void;
  onExit: (callback: (info: { exitCode: number; signal?: string }) => void) => void;
  kill: () => void;
}

export interface PreviewEndpoint {
  port: number;
  url: string;
  state: "closed" | "requesting" | "private" | "public" | "expired" | "revoked" | "failed";
  previewToken: string;
  expiresAt: string;
}

/**
 * Full provider contract — the terminal-side mirror of
 * `SandboxProvider` in src/lib/terminal-v1/sandbox-provider.ts.
 */
export interface SandboxProvider {
  /** Unique provider name (e.g. "disabled", "e2b"). */
  readonly name: string;

  /** Create a new isolated sandbox for a workspace. */
  create(input: CreateSandboxInput): Promise<SandboxInstance>;

  /** Get sandbox metadata. Returns null if not found. */
  get(sandboxId: string): Promise<SandboxInstance | null>;

  /** Start a stopped sandbox. */
  start(sandboxId: string): Promise<void>;

  /** Stop a running sandbox (preserves disk). */
  stop(sandboxId: string): Promise<void>;

  /** Permanently destroy a sandbox and its ephemeral resources. */
  destroy(sandboxId: string): Promise<void>;

  /** Attach to a sandbox's terminal stream. */
  connectTerminal(
    sandboxId: string,
    options: TerminalConnectOptions,
  ): Promise<TerminalTransport>;

  /** Execute a single command in the sandbox (non-interactive). */
  execute(
    sandboxId: string,
    input: ExecuteCommandInput,
  ): Promise<ExecuteCommandResult>;

  /** Expose an internal sandbox port as a preview URL. */
  exposePort(
    sandboxId: string,
    port: number,
  ): Promise<PreviewEndpoint>;

  /** Check if the provider is healthy and ready. */
  health(): Promise<{ healthy: boolean; details?: Record<string, unknown> }>;
}

/**
 * The subset of the provider contract the Phase 0 canary exercises.
 * Structural on purpose: any full {@link SandboxProvider} is assignable
 * to this type, so the canary written today runs unchanged against the
 * Phase 1 E2B provider tomorrow.
 */
export type CanaryProvider = Pick<
  SandboxProvider,
  "name" | "health" | "create" | "get" | "execute" | "destroy"
>;
