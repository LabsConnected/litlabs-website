/**
 * Terminal control plane.
 *
 * The control plane is the server-side service that orchestrates
 * sandbox lifecycle, token issuance, and ownership enforcement.
 *
 * It sits between the Next.js API routes and the sandbox provider.
 * It never exposes provider details to the frontend.
 */

import { getSandboxProvider } from "./providers";
import { FeatureDisabledError } from "./providers/disabled-provider";
import {
  createTerminalTokenV1,
  verifyTerminalTokenV1,
  TerminalTokenError,
  tokenErrorToStatus,
  type VerifyTerminalTokenOptions,
} from "./token";
import { buildSandboxEnv, assertNoPlatformSecrets } from "./env-allowlist";
import type {
  CreateSandboxInput,
  SandboxInstance,
  TerminalToken,
  TerminalTokenClaims,
  ShellType,
} from "./types";

// ─── Feature flag check ──────────────────────────────────────────

export function isTerminalEnabled(): boolean {
  return process.env.TERMINAL_ENABLED === "true";
}

export function isTerminalEnabledClient(): boolean {
  return process.env.NEXT_PUBLIC_TERMINAL_ENABLED === "true";
}

export const TERMINAL_DISABLED_RESPONSE = {
  error: "Terminal is coming soon. This feature is not available yet.",
  disabled: true,
  code: "FEATURE_DISABLED",
} as const;

export const TERMINAL_DISABLED_STATUS = 503;

// ─── Control Plane Operations ────────────────────────────────────

/**
 * Create a sandbox for a project workspace.
 *
 * Requires:
 * - Terminal feature enabled
 * - Valid userId and projectId
 * - Workspace must exist (verified by caller)
 */
export async function createSandbox(input: {
  userId: string;
  projectId: string;
  workspaceId: string;
  shell?: ShellType;
  limits?: Partial<CreateSandboxInput["limits"]>;
}): Promise<{ sandbox: SandboxInstance; token: TerminalToken }> {
  if (!isTerminalEnabled()) {
    throw new FeatureDisabledError("Terminal is disabled");
  }

  if (!input.userId) throw new Error("userId is required");
  if (!input.projectId) throw new Error("projectId is required");
  if (!input.workspaceId) throw new Error("workspaceId is required");

  const provider = getSandboxProvider();

  const env = buildSandboxEnv({
    userId: input.userId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    sandboxId: "", // Will be set after creation
  });

  // Safety check: never pass platform secrets
  assertNoPlatformSecrets(env);

  const sandbox = await provider.create({
    workspaceId: input.workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    limits: input.limits,
    env,
  });

  // Issue a project-bound token with sandbox ID
  const token = createTerminalTokenV1({
    userId: input.userId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    sandboxId: sandbox.sandboxId,
  });

  return { sandbox, token };
}

/**
 * Verify a terminal token and optionally check constraints.
 */
export function verifyToken(
  token: string,
  options?: VerifyTerminalTokenOptions,
): TerminalTokenClaims {
  return verifyTerminalTokenV1(token, options);
}

/**
 * Start a stopped sandbox.
 */
export async function startSandbox(
  sandboxId: string,
  userId: string,
): Promise<void> {
  if (!isTerminalEnabled()) {
    throw new FeatureDisabledError("Terminal is disabled");
  }
  const provider = getSandboxProvider();
  const sandbox = await provider.get(sandboxId);
  if (!sandbox) throw new Error("Sandbox not found");
  if (sandbox.userId !== userId) throw new Error("Forbidden");
  await provider.start(sandboxId);
}

/**
 * Stop a running sandbox (preserves persistent storage).
 */
export async function stopSandbox(
  sandboxId: string,
  userId: string,
): Promise<void> {
  if (!isTerminalEnabled()) {
    throw new FeatureDisabledError("Terminal is disabled");
  }
  const provider = getSandboxProvider();
  const sandbox = await provider.get(sandboxId);
  if (!sandbox) throw new Error("Sandbox not found");
  if (sandbox.userId !== userId) throw new Error("Forbidden");
  await provider.stop(sandboxId);
}

/**
 * Permanently destroy a sandbox.
 */
export async function destroySandbox(
  sandboxId: string,
  userId: string,
): Promise<void> {
  if (!isTerminalEnabled()) {
    throw new FeatureDisabledError("Terminal is disabled");
  }
  const provider = getSandboxProvider();
  const sandbox = await provider.get(sandboxId);
  if (!sandbox) throw new Error("Sandbox not found");
  if (sandbox.userId !== userId) throw new Error("Forbidden");
  await provider.destroy(sandboxId);
}

/**
 * Get sandbox metadata (sanitized for API response).
 */
export async function getSandbox(
  sandboxId: string,
  userId: string,
): Promise<SandboxInstance | null> {
  if (!isTerminalEnabled()) {
    return null;
  }
  const provider = getSandboxProvider();
  const sandbox = await provider.get(sandboxId);
  if (!sandbox) return null;
  if (sandbox.userId !== userId) return null;
  return sandbox;
}

/**
 * Check if the terminal system is healthy.
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  provider: string;
  details?: Record<string, unknown>;
}> {
  if (!isTerminalEnabled()) {
    return {
      healthy: false,
      provider: "disabled",
      details: { reason: "TERMINAL_ENABLED is not true" },
    };
  }

  const provider = getSandboxProvider();
  const result = await provider.health();
  return {
    healthy: result.healthy,
    provider: provider.name,
    details: result.details,
  };
}

// ─── Error handling helpers ──────────────────────────────────────

export function isFeatureDisabledError(err: unknown): boolean {
  return err instanceof FeatureDisabledError;
}

export function isTerminalTokenError(err: unknown): boolean {
  return err instanceof TerminalTokenError;
}

export { tokenErrorToStatus, TerminalTokenError, FeatureDisabledError };
