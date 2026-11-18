/**
 * Disabled sandbox provider (terminal side).
 *
 * This is the provider the terminal service wires for sandbox work
 * today, and the one Phase 0 ships with: it refuses every operation and
 * reports itself unhealthy, so the verification canary can never go
 * green against it and production behavior is bit-for-bit what it was
 * before the canary existed. It mirrors the web-side DisabledProvider
 * in src/lib/terminal-v1/providers/disabled-provider.ts.
 */

import type {
  CreateSandboxInput,
  ExecuteCommandInput,
  ExecuteCommandResult,
  PreviewEndpoint,
  SandboxInstance,
  SandboxProvider,
  TerminalConnectOptions,
  TerminalTransport,
} from "./provider";

export class SandboxDisabledError extends Error {
  readonly code = "SANDBOX_DISABLED" as const;

  constructor(message: string) {
    super(message);
    this.name = "SandboxDisabledError";
  }
}

export class DisabledSandboxProvider implements SandboxProvider {
  readonly name = "disabled";

  private disabled(): never {
    throw new SandboxDisabledError(
      "Sandbox provider is disabled. No verified sandbox backend is configured.",
    );
  }

  async create(_input: CreateSandboxInput): Promise<SandboxInstance> {
    this.disabled();
  }

  async get(_sandboxId: string): Promise<SandboxInstance | null> {
    return null;
  }

  async start(_sandboxId: string): Promise<void> {
    this.disabled();
  }

  async stop(_sandboxId: string): Promise<void> {
    this.disabled();
  }

  async destroy(_sandboxId: string): Promise<void> {
    this.disabled();
  }

  async connectTerminal(
    _sandboxId: string,
    _options: TerminalConnectOptions,
  ): Promise<TerminalTransport> {
    this.disabled();
  }

  async execute(
    _sandboxId: string,
    _input: ExecuteCommandInput,
  ): Promise<ExecuteCommandResult> {
    this.disabled();
  }

  async exposePort(
    _sandboxId: string,
    _port: number,
  ): Promise<PreviewEndpoint> {
    this.disabled();
  }

  async health(): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    return {
      healthy: false,
      details: {
        reason: "Sandbox provider is disabled",
        provider: this.name,
      },
    };
  }
}
