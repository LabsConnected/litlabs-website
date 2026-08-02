/**
 * Sandbox provider abstraction.
 *
 * This interface decouples the control plane from any specific
 * sandbox runtime (Docker, Kubernetes, cloud VM, etc.).
 *
 * Frontend components must never depend on a specific provider.
 */

import type {
  CreateSandboxInput,
  SandboxInstance,
  TerminalConnectOptions,
  TerminalTransport,
  ExecuteCommandInput,
  ExecuteCommandResult,
  PreviewEndpoint,
} from "./types";

export interface SandboxProvider {
  /** Unique provider name (e.g. "disabled", "managed-sandbox"). */
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
