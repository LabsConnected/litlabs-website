/**
 * Text-format tool-call markup detection.
 *
 * The agent loop only executes NATIVE structured tool calls — text-parsed
 * tool invocations are deliberately unsupported. Some models (notably
 * smaller free-tier routes) ignore the tool schema and instead emit their
 * training-format markup as ordinary text:
 *
 *   <tool_call>terminal\n<arg_key>command</arg_key>…</tool_call>
 *   <invoke name="files.read">…</invoke>
 *   <dots_function_call>…</dots_function_call>
 *   ```tool_call {"name": "files.read", "arguments": {…}} ```
 *   {"name": "files.read", "arguments": {…}}          (bare JSON body)
 *
 * Production defect: such a response was persisted as normal assistant
 * prose and the run finished `completed` even though no tool executed —
 * the model's intent was silently dropped.
 *
 * `findToolCallMarkup` decides whether a text payload shows INVOCATION
 * INTENT — i.e. the envelope's payload names one of the declared tools or
 * carries tool-call argument structure. Ordinary prose that merely quotes
 * markup (inside backticks, or with a non-tool payload) returns null: it
 * can never execute anyway, so it must not poison the route pool.
 */

/** Envelope formats we recognize as tool-call protocol attempts. */
const ENVELOPE_TAGS = [
  "tool_call",
  "invoke",
  "dots_function_call",
  "function_call",
  "function_calls",
] as const;

const ENVELOPE_RE = new RegExp(
  `<(${ENVELOPE_TAGS.join("|")})(\\s[^>]*)?>([\\s\\S]*?)(?:<\\/(?:${ENVELOPE_TAGS.join("|")})>|$)`,
  "gi",
);

const FENCED_BLOCK_RE = /```(?:tool_call|function_call|json)?\s*\n([\s\S]*?)```/g;

const ARG_STRUCTURE_RE = /<arg_key>|<arg_value>|<parameter|<antml:parameter|"arguments"\s*:|"parameters"\s*:|"command"\s*:/;

export interface ToolCallMarkupHit {
  /** Which surface produced the hit — for diagnostics, never secrets. */
  kind: "envelope" | "fenced_json" | "bare_json" | "truncated_envelope";
  /** The matched tool id when one was recognized. */
  toolId?: string;
}

function toolIdCandidates(knownToolIds: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  for (const id of knownToolIds) {
    ids.add(id); // terminal.execute
    ids.add(id.replace(/\./g, "_")); // terminal_execute
    const prefix = id.split(".")[0];
    if (prefix) ids.add(prefix); // terminal
  }
  return ids;
}

function payloadMentionsTool(payload: string, candidates: ReadonlySet<string>): string | undefined {
  const head = payload.trim().slice(0, 200).toLowerCase();
  for (const cand of candidates) {
    // Word-boundary match so `terminal` doesn't match `terminality`.
    if (new RegExp(`(^|[^a-z0-9_])${cand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_]|$)`, "i").test(head)) {
      return cand;
    }
  }
  return undefined;
}

function jsonPayloadToolId(payload: string, candidates: ReadonlySet<string>): string | undefined {
  try {
    const parsed = JSON.parse(payload.trim()) as Record<string, unknown>;
    const name =
      (typeof parsed?.name === "string" && parsed.name) ||
      (typeof (parsed?.function as Record<string, unknown> | undefined)?.name === "string" &&
        ((parsed.function as Record<string, unknown>).name as string)) ||
      (typeof parsed?.tool === "string" && parsed.tool) ||
      "";
    if (!name) return undefined;
    return candidates.has(name.toLowerCase()) ? name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Inspect a model's text payload for tool-call markup with invocation
 * intent. Returns the first hit, or null when the text is ordinary prose
 * (including prose that quotes markup as an example).
 */
export function findToolCallMarkup(
  text: string,
  knownToolIds: ReadonlySet<string>,
): ToolCallMarkupHit | null {
  if (!text || !text.trim()) return null;
  const candidates = toolIdCandidates(knownToolIds);

  // 1. XML-style envelopes — closed or truncated. A trailing `$` in the
  //    pattern also catches an opener whose close tag never arrived.
  for (const m of text.matchAll(ENVELOPE_RE)) {
    const openTag = m[0];
    const payload = m[3] ?? "";
    // Skip markup quoted inside inline code — `like <tool_call>x</tool_call>`
    // — those are examples, not invocations.
    const idx = m.index ?? 0;
    const before = text.slice(Math.max(0, idx - 1), idx);
    if (before === "`" && text.slice(idx + openTag.length, idx + openTag.length + 1) === "`") {
      continue;
    }
    const toolId = payloadMentionsTool(payload, candidates) ?? payloadMentionsTool(m[2] ?? "", candidates);
    const hasArgs = ARG_STRUCTURE_RE.test(payload);
    if (toolId || hasArgs) {
      const truncated = !new RegExp(`<\\/(?:${ENVELOPE_TAGS.join("|")})>\\s*$`, "i").test(openTag);
      return { kind: truncated ? "truncated_envelope" : "envelope", toolId };
    }
  }

  // 2. Fenced code blocks carrying a tool-call JSON payload.
  for (const m of text.matchAll(FENCED_BLOCK_RE)) {
    const payload = m[1] ?? "";
    const toolId = jsonPayloadToolId(payload, candidates);
    if (toolId) return { kind: "fenced_json", toolId };
  }

  // 3. Bare JSON object as the entire payload.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const toolId = jsonPayloadToolId(trimmed, candidates);
    if (toolId) return { kind: "bare_json", toolId };
  }

  return null;
}
