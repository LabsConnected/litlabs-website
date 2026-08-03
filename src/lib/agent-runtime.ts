/**
 * resolveRuntimeAgent — the single entry point for loading any agent's
 * runtime configuration (LiTT, Spark, or a marketplace agent instance).
 *
 * It verifies:
 *   1. User authentication (caller provides clerkId)
 *   2. Instance ownership (for installed agents)
 *   3. Active installation status
 *   4. Entitlement or plan inclusion
 *   5. Version compatibility
 *   6. Agent status (active/paused/disabled)
 *
 * Then loads:
 *   - The immutable published version's system prompt and personality
 *   - The model configuration
 *   - The allowed tools
 *   - The memory namespace
 *
 * Returns a sanitized runtime configuration that the conversation/message
 * runtime uses to execute the agent.
 */

import { supabaseAdmin } from "@/lib/supabase";
import { getAgentDefinition } from "@/lib/agent-registry";
import { resolveAgentEntitlement } from "@/lib/agent-entitlements";
import type { AgentSelection, BuiltinAgentSlug } from "@/lib/agent-selection";

export interface RuntimeAgent {
  /** The selection that was resolved. */
  selection: AgentSelection;
  /** Display name for the agent. */
  displayName: string;
  /** System prompt from the immutable published version. */
  systemPrompt: string;
  /** Personality overlay (may be empty). */
  personality: string;
  /** Model identifier (e.g. "gpt-4o-mini"). */
  model: string;
  /** Tool allowlist for this agent. */
  enabledTools: string[];
  /** Isolated memory namespace for this instance. */
  memoryNamespace: string;
  /** The agent instance ID (for installed agents) or null for builtins. */
  agentInstanceId: string | null;
  /** The agent template ID (from the agents table). */
  agentId: string | null;
  /** The published version ID. */
  agentVersionId: string | null;
  /** Approval mode for this instance. */
  approvalMode: "supervised" | "autonomous" | "ask-first";
  /** Per-run budget in credits (0 = unlimited). */
  perRunBudgetCredits: number;
  /** Whether this is a builtin agent (LiTT/Spark) or a marketplace instance. */
  isBuiltin: boolean;
}

export interface ResolveRuntimeAgentParams {
  clerkId: string;
  selection: AgentSelection;
}

export interface ResolveRuntimeAgentResult {
  ok: boolean;
  agent?: RuntimeAgent;
  error?: string;
  /** HTTP status code for the error. */
  status?: number;
}

/**
 * Resolve a runtime agent from either a builtin slug or an installed instance ID.
 *
 * For builtin agents (LiTT, Spark):
 *   - Loads the static registry definition (system prompt, tools, model).
 *   - Checks plan entitlement via resolveAgentEntitlement.
 *   - Uses a per-user memory namespace (clerkId:slug).
 *
 * For installed agents (marketplace):
 *   - Loads the user_agents row by instance ID.
 *   - Verifies ownership (user_id matches the clerk's user).
 *   - Verifies status is 'active'.
 *   - Re-checks entitlement or plan inclusion.
 *   - Loads the published agent_version for the system prompt, personality, model.
 *   - Uses the instance's memory_namespace for isolated memory.
 */
export async function resolveRuntimeAgent(
  params: ResolveRuntimeAgentParams,
): Promise<ResolveRuntimeAgentResult> {
  const { clerkId, selection } = params;

  // ── Builtin agents (LiTT, Spark) ──────────────────────────────
  if (selection.kind === "builtin") {
    return resolveBuiltinAgent(clerkId, selection.slug);
  }

  // ── Installed marketplace agent ───────────────────────────────
  return resolveInstalledAgent(clerkId, selection.instanceId);
}

async function resolveBuiltinAgent(
  clerkId: string,
  slug: BuiltinAgentSlug,
): Promise<ResolveRuntimeAgentResult> {
  const def = getAgentDefinition(slug);
  if (!def) {
    return { ok: false, error: "Agent not found", status: 404 };
  }

  // Check entitlement (plan-based for builtins).
  const entitlement = await resolveAgentEntitlement({ clerkId, agentSlug: slug });
  if (!entitlement.allowed) {
    return {
      ok: false,
      error: entitlement.reason || "Access denied",
      status: 403,
    };
  }

  return {
    ok: true,
    agent: {
      selection: { kind: "builtin", slug },
      displayName: def.name,
      systemPrompt: def.systemPrompt,
      personality: "",
      model: "gpt-4o-mini", // Builtin agents use the default model routing
      enabledTools: def.tools.allowlist,
      memoryNamespace: `${clerkId}:${slug}`,
      agentInstanceId: null,
      agentId: null,
      agentVersionId: null,
      approvalMode: "ask-first",
      perRunBudgetCredits: 0,
      isBuiltin: true,
    },
  };
}

async function resolveInstalledAgent(
  clerkId: string,
  instanceId: string,
): Promise<ResolveRuntimeAgentResult> {
  // 1. Load the user's internal ID.
  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("clerk_id", clerkId)
    .maybeSingle();

  if (userError || !user) {
    return { ok: false, error: "User not found", status: 404 };
  }

  // 2. Load the agent instance, verifying ownership.
  const { data: instance, error: instanceError } = await supabaseAdmin
    .from("user_agents")
    .select(`
      id,
      user_id,
      agent_id,
      agent_version_id,
      display_name,
      name,
      status,
      is_active,
      memory_namespace,
      approval_mode,
      enabled_tools,
      per_run_budget_credits,
      settings,
      last_active_at,
      agent_versions (
        id,
        system_prompt,
        personality,
        model,
        version_status
      ),
      agents (
        id,
        slug,
        display_name,
        is_public
      )
    `)
    .eq("id", instanceId)
    .maybeSingle();

  if (instanceError || !instance) {
    return { ok: false, error: "Agent instance not found", status: 404 };
  }

  // 3. Verify ownership.
  if (instance.user_id !== user.id) {
    return { ok: false, error: "Access denied", status: 403 };
  }

  // 4. Verify status.
  if (instance.status === "paused" || !instance.is_active) {
    return { ok: false, error: "Agent is paused", status: 403 };
  }
  if (instance.status === "disabled") {
    return { ok: false, error: "Agent access has been revoked", status: 403 };
  }
  if (instance.status === "error") {
    return { ok: false, error: "Agent is in an error state", status: 503 };
  }

  // 5. Re-check entitlement (plan-included or purchased).
  // Supabase nested select returns arrays for relations.
  const agentRow = Array.isArray(instance.agents) ? instance.agents[0] : instance.agents;
  const agentSlug = agentRow?.slug;
  if (agentSlug) {
    const entitlement = await resolveAgentEntitlement({ clerkId, agentSlug });
    if (!entitlement.allowed) {
      return {
        ok: false,
        error: entitlement.reason || "Access denied",
        status: 403,
      };
    }
  }

  // 6. Load the published version's prompt, personality, model.
  const version = Array.isArray(instance.agent_versions) ? instance.agent_versions[0] : instance.agent_versions;
  if (!version || version.version_status !== "published") {
    return { ok: false, error: "Agent version is not available", status: 404 };
  }

  // 7. Build the runtime agent.
  const displayName = instance.display_name || instance.name || agentRow?.display_name || "Agent";
  const systemPrompt = version.system_prompt || "";
  const personality = version.personality || "";
  const model = version.model || "gpt-4o-mini";
  const enabledTools = Array.isArray(instance.enabled_tools) ? instance.enabled_tools : [];
  const memoryNamespace = instance.memory_namespace || instance.id;
  const approvalMode = (instance.approval_mode as RuntimeAgent["approvalMode"]) || "ask-first";
  const perRunBudgetCredits = instance.per_run_budget_credits || 0;

  return {
    ok: true,
    agent: {
      selection: { kind: "installed", instanceId },
      displayName,
      systemPrompt,
      personality,
      model,
      enabledTools,
      memoryNamespace,
      agentInstanceId: instance.id,
      agentId: instance.agent_id,
      agentVersionId: instance.agent_version_id,
      approvalMode,
      perRunBudgetCredits,
      isBuiltin: false,
    },
  };
}
