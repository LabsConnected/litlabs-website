import "server-only";

/**
 * LiTT Tool Health — Part F of the Tool Orchestrator fix.
 *
 * Before presenting tools to the model, determine actual availability.
 * A real tool can be:
 * - AVAILABLE: can execute now
 * - DEGRADED: may work but is known-unreliable (use sparingly, no retry loops)
 * - UNAVAILABLE: cannot execute — do NOT advertise to the model
 * - APPROVAL_REQUIRED: executes only after user approval (still advertised,
 *   but the permission engine gates it)
 *
 * The cardinal rule: do not advertise tools to LiTT that cannot currently
 * execute. Example: terminal.execute has a real handler, but production
 * currently returns Forbidden for unauthorized users — until the auth
 * problem is fixed for a given user, the capability resolves as
 * UNAVAILABLE/DEGRADED for that user rather than letting the model
 * repeatedly choose a broken capability.
 *
 * When a capability is unavailable:
 * - use a safe alternative where possible
 * - tell the user only when it prevents completion
 * - never fake completion
 */

export type ToolHealth = "available" | "degraded" | "unavailable" | "approval_required";

export interface ToolHealthReport {
  toolId: string;
  health: ToolHealth;
  /** Machine-readable reason code. */
  reason: string;
  /** Human-readable detail for logs/debugging. */
  detail?: string;
}

// ─── Terminal health ──────────────────────────────────────────────
// The terminal's PTY path requires: (1) a reachable terminal server,
// (2) a valid TERMINAL_AUTH_SECRET shared between web app and terminal
// server, (3) the user in the terminal owner allowlist. The owner gate
// (terminal-server/terminal-owner-gate.ts) intentionally returns
// "Forbidden" for non-owners — that is the gate working, not a bug.

export interface TerminalHealthContext {
  /** Clerk user ID of the requesting user (server-verified). */
  userId?: string | null;
  /**
   * Whether the user is in the terminal owner allowlist.
   * When false, the terminal server WILL return Forbidden — report
   * UNAVAILABLE truthfully instead of advertising a broken tool.
   */
  isTerminalOwner?: boolean;
  /** Whether the terminal server was reachable on last check. */
  terminalServerReachable?: boolean;
}

/**
 * Resolve terminal tool health for a user.
 * Pure function — the caller supplies the (server-verified) facts.
 */
export function resolveTerminalHealth(ctx: TerminalHealthContext): ToolHealthReport {
  if (!ctx.userId) {
    return {
      toolId: "terminal.execute",
      health: "unavailable",
      reason: "no_authenticated_user",
      detail: "Terminal requires an authenticated user.",
    };
  }
  if (ctx.isTerminalOwner === false) {
    return {
      toolId: "terminal.execute",
      health: "unavailable",
      reason: "not_terminal_owner",
      detail:
        "Terminal shell access is restricted to the workspace owner. " +
        "The terminal server returns Forbidden for non-owners by design.",
    };
  }
  // Ownership unknown (caller couldn't verify): degraded, not unavailable.
  // Truthful but conservative — the tool might work, but don't plan
  // around it and never retry it in a loop.
  if (ctx.isTerminalOwner === undefined) {
    return {
      toolId: "terminal.execute",
      health: "degraded",
      reason: "ownership_unverified",
      detail:
        "Terminal ownership could not be verified for this user. " +
        "Attempt at most once; do not retry in a loop.",
    };
  }
  if (ctx.terminalServerReachable === false) {
    return {
      toolId: "terminal.execute",
      health: "degraded",
      reason: "terminal_server_unreachable",
      detail:
        "Terminal server unreachable on last check. The tool may fail; " +
        "do not retry in a loop — report the outage if it blocks completion.",
    };
  }
  return {
    toolId: "terminal.execute",
    health: "available",
    reason: "ok",
  };
}

// ─── Generic health resolution ────────────────────────────────────

export interface ToolHealthContext {
  terminal?: TerminalHealthContext;
  /**
   * Per-tool overrides for health states determined by the caller
   * (e.g. a browser tool when no browser session infra is configured).
   */
  overrides?: Record<string, ToolHealthReport>;
}

/**
 * Default health for tools without a specific resolver: available.
 * Tools that require approval are marked approval_required so the
 * permission engine (not this module) enforces the gate — the tool is
 * still advertised because it CAN execute after approval.
 */
const APPROVAL_GATED_TOOLS = new Set([
  "project.deploy",
  "deploy.execute",
  "git.push",
  "file.delete",
  "secrets.update",
]);

/**
 * Resolve health for a set of tool IDs.
 */
export function resolveToolHealth(
  toolIds: string[],
  ctx: ToolHealthContext = {},
): Map<string, ToolHealthReport> {
  const out = new Map<string, ToolHealthReport>();
  for (const toolId of toolIds) {
    const override = ctx.overrides?.[toolId];
    if (override) {
      out.set(toolId, override);
      continue;
    }
    if (toolId === "terminal.execute") {
      out.set(toolId, resolveTerminalHealth(ctx.terminal ?? {}));
      continue;
    }
    if (APPROVAL_GATED_TOOLS.has(toolId)) {
      out.set(toolId, {
        toolId,
        health: "approval_required",
        reason: "permission_engine_gated",
        detail: "Advertised; the permission engine pauses for approval before execution.",
      });
      continue;
    }
    out.set(toolId, { toolId, health: "available", reason: "ok" });
  }
  return out;
}

/**
 * Filter a tool-ID list to only those the model should be offered.
 * UNAVAILABLE tools are dropped. DEGRADED tools are kept but flagged so
 * the prompt can warn against retry loops.
 */
export function filterOfferableTools(
  health: Map<string, ToolHealthReport>,
): { offerable: string[]; degraded: string[]; dropped: string[] } {
  const offerable: string[] = [];
  const degraded: string[] = [];
  const dropped: string[] = [];
  for (const [toolId, report] of health) {
    if (report.health === "unavailable") {
      dropped.push(toolId);
    } else if (report.health === "degraded") {
      offerable.push(toolId);
      degraded.push(toolId);
    } else {
      offerable.push(toolId);
    }
  }
  return { offerable, degraded, dropped };
}

/**
 * Render a compact health note for the operator prompt.
 */
export function buildToolHealthPromptNote(
  health: Map<string, ToolHealthReport>,
): string | null {
  const { degraded, dropped } = filterOfferableTools(health);
  const lines: string[] = [];
  if (dropped.length > 0) {
    const reasons = dropped
      .map((id) => {
        const r = health.get(id);
        return `${id} (${r?.reason ?? "unknown"})`;
      })
      .join(", ");
    lines.push(
      `UNAVAILABLE TOOLS (do not attempt — they cannot execute): ${reasons}. ` +
        `Use safe alternatives where possible; tell the user only if this prevents completion.`,
    );
  }
  if (degraded.length > 0) {
    lines.push(
      `DEGRADED TOOLS (may fail — attempt at most once, never retry in a loop): ${degraded.join(", ")}.`,
    );
  }
  return lines.length > 0 ? lines.join("\n") : null;
}
