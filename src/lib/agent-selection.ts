/**
 * AgentSelection — the canonical runtime identity for any agent.
 *
 * A built-in agent (LiTT, Spark) is identified by its slug.
 * A marketplace agent is identified by its private instance ID (user_agents.id).
 *
 * The browser sends an instance ID, not a system prompt, version, agent UUID
 * or trusted slug. The server resolves the instance to its full runtime
 * configuration via resolveRuntimeAgent().
 */

export type BuiltinAgentSlug = "litt" | "spark";

export type AgentSelection =
  | { kind: "builtin"; slug: BuiltinAgentSlug }
  | { kind: "installed"; instanceId: string };

/**
 * Parse a client-supplied agent identifier into an AgentSelection.
 *
 * Accepts:
 *   - "litt" or "spark" → builtin
 *   - A UUID string → installed instance
 *   - An object with { kind, slug } or { kind, instanceId }
 *
 * Returns null for invalid input.
 */
export function parseAgentSelection(
  input: unknown,
): AgentSelection | null {
  if (!input) return null;

  // Object form: { kind: "builtin", slug } or { kind: "installed", instanceId }
  if (typeof input === "object" && input !== null) {
    const obj = input as Record<string, unknown>;
    if (obj.kind === "builtin" && (obj.slug === "litt" || obj.slug === "spark")) {
      return { kind: "builtin", slug: obj.slug };
    }
    if (obj.kind === "installed" && typeof obj.instanceId === "string") {
      return { kind: "installed", instanceId: obj.instanceId };
    }
    return null;
  }

  // String form: slug or UUID
  if (typeof input === "string") {
    if (input === "litt" || input === "spark") {
      return { kind: "builtin", slug: input };
    }
    // UUID-like string → installed instance
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input)) {
      return { kind: "installed", instanceId: input };
    }
  }

  return null;
}

/**
 * Serialize an AgentSelection for URL query params.
 */
export function serializeAgentSelection(sel: AgentSelection): string {
  return sel.kind === "builtin" ? sel.slug : sel.instanceId;
}
