/**
 * Disabled sandbox provider.
 *
 * This is the default provider when TERMINAL_PROVIDER=disabled or
 * when the terminal feature is not enabled. It refuses all operations
 * with a controlled FEATURE_DISABLED response.
 */

import type { SandboxProvider } from "../sandbox-provider";
import type {
  CreateSandboxInput,
  SandboxInstance,
  TerminalConnectOptions,
  TerminalTransport,
  ExecuteCommandInput,
  ExecuteCommandResult,
  PreviewEndpoint,
} from "../types";

export class DisabledProvider implements SandboxProvider {
  readonly name = "disabled";

  private disabled(): never {
    throw new FeatureDisabledError(
      "Terminal is disabled. Set TERMINAL_PROVIDER and TERMINAL_ENABLED=true to enable.",
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
        reason: "Terminal provider is disabled",
        provider: this.name,
      },
    };
  }
}

export class FeatureDisabledError extends Error {
  readonly code = "FEATURE_DISABLED" as const;

  constructor(message: string) {
    super(message);
    this.name = "FeatureDisabledError";
  }
}
