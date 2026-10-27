/**
 * TOOL INVENTORY lane — deterministic answers for "what tools do you have".
 *
 * WHY THIS EXISTS
 * ---------------
 * A tool-inventory question ("What tools do you have available right
 * now?") asks about LiTT's OWN runtime state — the registered,
 * permission-filtered ToolRegistry. The truthful answer is already in
 * the registry; it needs zero model inference and zero tool execution.
 *
 * Before this lane existed, the question fell through to CHAT, which
 * hands the model the FULL tool list inside an agent loop and lets it
 * call tools for several rounds. A weak local model answered a question
 * ABOUT the tools by CALLING them — repository inspection, diagnostics,
 * build/test checks — while the workstream honestly displayed
 * INSPECTING/RUNNING for calls that should never have happened. On a
 * phone-class local model, each round is tens of seconds, so one
 * informational question burned a minute-plus of unrelated execution.
 *
 * Scope discipline (mirrors local-fast-lane / utility-lane):
 *   - Exact-phrase and ANCHORED-pattern matching only. A query that
 *     merely mentions tools ("use the tools to fix X", "list tools in
 *     package.json") does NOT match — trailing words break the anchor.
 *   - No model call, no ExecutionGateway execution, no mission, no
 *     VerificationGate. The answer is rendered from the registry itself.
 *   - Permission truth: each tool is annotated with what the CURRENT
 *     session mode actually allows (the ExecutionGateway's own policy —
 *     PLAN denies mutations, ACT requires approval for mutating tools,
 *     AUTO requires a verified grant or approval). The list is the
 *     registered inventory filtered/annotated by that real policy, not
 *     a static marketing list.
 *
 * Truthfulness:
 *   - The inventory is read from `session.getGateway().getTools()` —
 *     the SAME registry the agent loop exposes to the model. If a tool
 *     is not listed here it is not callable; if it is listed it is
 *     registered (mode-gating is shown per-tool).
 *   - `project.run` is annotated honestly: the tool itself is generic
 *     command execution and each command is individually risk-classified
 *     by the gateway (elevated/dangerous commands still need approval).
 */

import type { ToolRegistry } from "@litt/agent-core";

// ─── Matching ──────────────────────────────────────────────────────

/**
 * Leading politeness/modal wrappers stripped before matching so
 * "can you list your tools" matches the same lane as "list your tools".
 */
const INVENTORY_WRAPPERS = [
  "can you", "could you", "would you", "will you",
  "please can you", "please", "kindly",
  "hey litt", "litt",
];

/**
 * Anchored patterns — the WHOLE normalized query must be a
 * tool-inventory question. Anchoring at both ends is the rejection
 * mechanism: "list tools then fix the build", "show tools that can
 * deploy", and "what tools does this project use" all fail to match
 * and keep their existing routing (mission / read / chat).
 */
const INVENTORY_PATTERNS: RegExp[] = [
  // "what tools do you have (available) (right now)?"
  // "what tools are (there|available|installed)?" — NOT "installed":
  // installed-tool discovery is a machine-lane/OS question, not the
  // agent registry.
  /^what tools (?:do you have|are there|are available|can you use|can you call|can you invoke|do you support|do you offer|do you have access to|are registered)(?: available)?(?: right now| now| currently| here)?$/,
  // "which tools do you have / are available / can you use"
  /^which tools (?:do you have|are available|can you use|can you call|can you invoke|do you support|are registered)$/,
  // "list (all|the|your|available|registered) tools"
  // "show (me) (your|the|available|registered) tools"
  // "name (your|the|available) tools"
  /^(?:list|show|name)(?: me)?(?: all)?(?: (?:the|your|available|registered))* tools$/,
  // "tell me (about) your tools"
  /^tell me (?:about )?your tools$/,
  // "what is your tool list / toolset / tool inventory / toolbox"
  /^what(?:'s| is| are) your tool ?(?:list|set|belt|box|inventory)$/,
  // bare "tool inventory" / "tools inventory"
  /^tools? inventory$/,
];

/**
 * Normalize input for matching: lowercase, collapse whitespace, strip
 * sentence punctuation, strip one leading politeness wrapper and one
 * trailing "please". Same normalization style as the local fast lane.
 */
function normalizeInventoryQuery(input: string): string {
  let n = input
    .toLowerCase()
    .trim()
    .replace(/[?!.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const w of INVENTORY_WRAPPERS) {
    if (n === w) return n;
    if (n.startsWith(w + " ")) {
      n = n.slice(w.length + 1).trim();
      break;
    }
  }
  n = n.replace(/\s+please$/, "").replace(/[?!.,;:]+$/g, "").trim();
  return n;
}

/**
 * True when `input` is a tool-inventory question answerable from the
 * registered ToolRegistry — and NOTHING else. False means the caller
 * falls through to normal intent classification exactly as before.
 */
export function matchToolInventoryQuery(input: string): boolean {
  const n = normalizeInventoryQuery(input);
  if (!n || n.startsWith("/")) return false;
  return INVENTORY_PATTERNS.some((re) => re.test(n));
}

// ─── Formatting ────────────────────────────────────────────────────

/**
 * Per-tool access annotation under the session's CURRENT mode — the
 * same decisions the ExecutionGateway's evaluatePolicy() makes:
 *
 *   read-only tool  → allowed in every mode
 *   mutating tool   → PLAN: denied · ACT: requires approval
 *                     AUTO: requires a verified grant or approval
 *   project.run     → generic command execution; the gateway
 *                     risk-classifies every command individually, so
 *                     read-only commands run freely and elevated /
 *                     dangerous ones still hit approval (or denial in
 *                     PLAN/AUTO). It is metadata-read-only but NOT
 *                     unconditionally safe — the honest label is
 *                     "per-command risk policy".
 */
function toolAccessLabel(
  toolId: string,
  mutating: boolean,
  mode: "plan" | "act" | "auto",
): string {
  if (toolId === "project.run") {
    switch (mode) {
      case "plan": return "commands allowed — mutating commands blocked (PLAN)";
      case "act": return "commands allowed — elevated/dangerous need approval (ACT)";
      case "auto": return "commands allowed — elevated need grant/approval, dangerous blocked (AUTO)";
    }
  }
  if (!mutating) return "read-only";
  switch (mode) {
    case "plan": return "blocked (PLAN mode)";
    case "act": return "requires approval (ACT)";
    case "auto": return "requires grant or approval (AUTO)";
  }
}

/**
 * Build the deterministic tool-inventory answer from the LIVE registry.
 *
 * `registry` is `session.getGateway().getTools()` — the same registry
 * exposed to the model, so the answer can never drift from what the
 * agent can actually call. Sorted by tool id for stable output.
 */
export function formatToolInventory(
  registry: ToolRegistry,
  mode: "plan" | "act" | "auto",
): string {
  const defs = registry.list().slice().sort((a, b) => a.id.localeCompare(b.id));

  const lines: string[] = [];
  lines.push(`Registered tools (${defs.length}) — mode: ${mode.toUpperCase()}`);
  lines.push("");

  for (const def of defs) {
    const entry = registry.get(def.id);
    const mutating = entry?.metadata.mutating ?? false;
    const access = toolAccessLabel(def.id, mutating, mode);
    const description = def.description.replace(/\s+/g, " ").trim();
    lines.push(`- ${def.id} — ${description} [${access}]`);
  }

  return lines.join("\n");
}
