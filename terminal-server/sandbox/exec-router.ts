/**
 * Sandbox exec gate + router — Phase 1 of SANDBOX-PLAN.md §4.
 *
 * This is the ONLY new execution path Phase 1 adds, and it routes
 * exactly one surface: `workspace.exec` (server.ts POST
 * /internal/workspace/:workspaceId/exec). Every other execution
 * surface keeps its current behavior.
 *
 * A command is routed into a sandbox only when ALL of these hold:
 *   1. provider-enabled — the factory built a real provider (E2B),
 *      not the disabled default (config claim, necessary not
 *      sufficient);
 *   2. routing-enabled environment — Phase 1 routed on the staging
 *      deployment only (cohort gate). Phase 2 (Larry's production
 *      unlock, 2026-11-14) adds the production deployment, and only
 *      when SANDBOX_PRODUCTION_ENABLED=true was set explicitly —
 *      see config.ts `routingEnabled`. Configuring the provider
 *      alone never opens production routing;
 *   3. owner — the requesting user is on the terminal owner
 *      allowlist (TERMINAL_OWNER_CLERK_IDS via terminal-owner-gate);
 *   4. canary-verified — SandboxVerificationService.isVerified() is
 *      true RIGHT NOW: a fresh, fully green canary report exists.
 *      This is the isolation proof; if the canary is red, stale, or
 *      has never run, execution stays closed (invariant 2).
 *
 * When the gate is closed, tryExecute returns null and the caller
 * falls through to the pre-Phase-1 code path untouched — which in
 * production-like environments is the fail-closed host-execution
 * refusal, and locally is the existing gateway. Non-owner and
 * production behavior is therefore identical to today.
 *
 * Bindings are per (userId, projectId, workspaceId): one sandbox
 * serves exactly one project for exactly one user (invariant 3).
 * Every routed execution is audit-logged with those identities
 * (invariant 7) — command text is logged by the endpoint's existing
 * auditCommand, never duplicated here.
 */

import { isTerminalOwner } from "../terminal-owner-gate";
import {
  createSandboxProvider,
  resolveSandboxRuntimeConfig,
  type SandboxRuntimeConfig,
} from "./config";
import type {
  ExecuteCommandResult,
  SandboxProvider,
} from "./provider";
import { SandboxVerificationService } from "./verification";

export type SandboxGateDenialReason =
  | "provider-disabled"
  | "routing-not-enabled"
  | "not-owner"
  | "canary-not-verified";

export interface SandboxGateDecision {
  allowed: boolean;
  reason: SandboxGateDenialReason | "ok";
}

export interface SandboxExecGateOptions {
  /** True when a real provider was configured (not the disabled default). */
  providerEnabled: boolean;
  /**
   * True when this process may route: a staging deployment, or a
   * production deployment with SANDBOX_PRODUCTION_ENABLED=true
   * (config.ts `routingEnabled`).
   */
  routingEnabled: boolean;
  /** Owner check. Defaults to the terminal owner allowlist. */
  isOwner?: (userId: string) => boolean;
  /** The ONLY isolation proof the gate consults. */
  isVerified: () => boolean;
}

export class SandboxExecGate {
  private readonly providerEnabled: boolean;
  private readonly routingEnabled: boolean;
  private readonly isOwner: (userId: string) => boolean;
  private readonly isVerified: () => boolean;

  constructor(options: SandboxExecGateOptions) {
    this.providerEnabled = options.providerEnabled;
    this.routingEnabled = options.routingEnabled;
    this.isOwner = options.isOwner ?? isTerminalOwner;
    this.isVerified = options.isVerified;
  }

  decide(userId: string): SandboxGateDecision {
    if (!this.providerEnabled) return { allowed: false, reason: "provider-disabled" };
    if (!this.routingEnabled) return { allowed: false, reason: "routing-not-enabled" };
    if (!this.isOwner(userId)) return { allowed: false, reason: "not-owner" };
    if (!this.isVerified()) return { allowed: false, reason: "canary-not-verified" };
    return { allowed: true, reason: "ok" };
  }
}

export interface SandboxExecRequest {
  userId: string;
  projectId: string;
  workspaceId: string;
  command: string;
  stdin?: string;
  timeoutMs?: number;
  cwd?: string;
  /**
   * Per-command PROJECT env (design note §1.6/§3.4): a project's own
   * variables for this one command. Providers guard it by VALUE
   * against the terminal's own platform secrets (env.ts) — never by
   * name — so a project's own Clerk keys are not rejected.
   */
  env?: Record<string, string>;
}

export interface SandboxExecOutcome {
  result: ExecuteCommandResult;
  sandboxId: string;
}

export interface SandboxExecRouterOptions {
  /** Audit/info log sink. Defaults to console.info. */
  log?: (message: string) => void;
  /** Called with the denial reason whenever the gate closes (observability). */
  onDenied?: (reason: SandboxGateDenialReason, userId: string) => void;
}

export class SandboxExecRouter {
  private readonly provider: SandboxProvider;
  private readonly gate: SandboxExecGate;
  private readonly log: (message: string) => void;
  private readonly onDenied?: SandboxExecRouterOptions["onDenied"];
  /** (userId, projectId, workspaceId) -> sandboxId. Never shared. */
  private readonly bindings = new Map<string, string>();

  constructor(
    provider: SandboxProvider,
    gate: SandboxExecGate,
    options: SandboxExecRouterOptions = {},
  ) {
    this.provider = provider;
    this.gate = gate;
    this.log = options.log ?? ((m) => console.info(m));
    this.onDenied = options.onDenied;
  }

  private bindingKey(req: SandboxExecRequest): string {
    return `${req.userId}${req.projectId}${req.workspaceId}`;
  }

  /**
   * Attempt to execute in the project's sandbox. Returns null when
   * the gate is closed (caller falls through to the legacy path).
   * Throws only on provider failures after the gate opened; the
   * caller treats those as execution failures, never as permission
   * to fall back to host execution in production (the legacy path
   * itself fails closed there).
   */
  async tryExecute(req: SandboxExecRequest): Promise<SandboxExecOutcome | null> {
    const decision = this.gate.decide(req.userId);
    if (!decision.allowed) {
      this.onDenied?.(decision.reason as SandboxGateDenialReason, req.userId);
      return null;
    }

    const key = this.bindingKey(req);
    let sandboxId = this.bindings.get(key);
    let instance = sandboxId ? await this.provider.get(sandboxId) : null;
    if (!instance) {
      const created = await this.provider.create({
        workspaceId: req.workspaceId,
        userId: req.userId,
        projectId: req.projectId,
      });
      sandboxId = created.sandboxId;
      instance = created;
      this.bindings.set(key, sandboxId);
      this.log(
        `[sandbox-exec] created sandbox=${sandboxId} user=${req.userId} project=${req.projectId} workspace=${req.workspaceId}`,
      );
    } else if (instance.state === "stopped") {
      await this.provider.start(sandboxId as string);
    }

    const result = await this.provider.execute(sandboxId as string, {
      command: req.command,
      stdin: req.stdin,
      timeoutMs: req.timeoutMs,
      cwd: req.cwd,
      env: req.env,
    });
    this.log(
      `[sandbox-exec] exec sandbox=${sandboxId} user=${req.userId} project=${req.projectId} workspace=${req.workspaceId} exit=${result.exitCode}`,
    );
    return { result, sandboxId: sandboxId as string };
  }

  /** Destroy the sandbox bound to a workspace, if any (cleanup hooks). */
  async destroyBinding(userId: string, projectId: string, workspaceId: string): Promise<void> {
    const key = `${userId}${projectId}${workspaceId}`;
    const sandboxId = this.bindings.get(key);
    if (!sandboxId) return;
    this.bindings.delete(key);
    await this.provider.destroy(sandboxId);
  }
}

// ─── Assembly ───────────────────────────────────────────────────────

export interface SandboxExecStack {
  config: SandboxRuntimeConfig;
  provider: SandboxProvider;
  verification: SandboxVerificationService;
  gate: SandboxExecGate;
  router: SandboxExecRouter;
}

export interface CreateSandboxExecStackDeps {
  e2bClient?: import("./e2b-provider").E2bClient;
  isOwner?: (userId: string) => boolean;
  log?: (message: string) => void;
  /** Terminal's own internal base URL for the canary egress probe. */
  terminalBeaconUrl?: string;
}

/**
 * Build the full Phase 1 stack from the environment: provider
 * (factory), verification service (canary signal over that provider),
 * gate, and router. With no explicit E2B configuration this yields
 * the disabled provider and a gate that can never open — the Phase 0
 * shipping state.
 */
export function createSandboxExecStack(
  env: Record<string, string | undefined>,
  deps: CreateSandboxExecStackDeps = {},
): SandboxExecStack {
  const config = resolveSandboxRuntimeConfig(env);
  const provider = createSandboxProvider(env, { e2bClient: deps.e2bClient });
  const verification = new SandboxVerificationService(provider, {
    canary: { terminalBeaconUrl: deps.terminalBeaconUrl },
    onReport: (report) => {
      (deps.log ?? ((m: string) => console.info(m)))(
        `[sandbox-canary] provider=${report.provider} passed=${report.passed} checks=${report.checks
          .map((c) =>
            // Observability: the network-egress check carries its
            // probe detail on the boot line. When egress reads open,
            // the status code and metadata-signature flag in that
            // detail are the only evidence of WHAT answered the
            // request (the real metadata service vs an intermediary
            // answering for it). Every other check keeps the bare
            // id:status form, byte-identical to before.
            c.id === "network-egress" ? `${c.id}:${c.status}[${c.detail}]` : `${c.id}:${c.status}`,
          )
          .join(",")}`,
      );
    },
  });
  const gate = new SandboxExecGate({
    providerEnabled: config.providerName !== "disabled",
    routingEnabled: config.routingEnabled,
    isOwner: deps.isOwner,
    isVerified: () => verification.isVerified(),
  });
  const router = new SandboxExecRouter(provider, gate, { log: deps.log });
  return { config, provider, verification, gate, router };
}
