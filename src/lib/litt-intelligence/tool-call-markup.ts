/**
 * Text-format tool-call markup detection and hygiene.
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
 *   files.write(path="index.html", …)                (pseudo-function-call)
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

import { stripToolCallBlocks } from "@litt/agent-core";

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

/** `tool.name(` pseudo-function calls — the `[\s>({\["'`]` lead keeps
 *  `v1.2.3`-style version dots and `foo.bar(` glued to a word from
 *  matching; the name itself must still resolve to a registered tool. */
const FUNCTION_CALL_RE = /(^|[\s>({\["'`])([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)\s*\(/gim;
/** What follows the paren must look like call arguments: a named arg
 *  (`path=`, `content =`), a quoted literal, or a brace/bracket payload. */
const ARG_SIGNATURE_RE = /^\s*(?:[a-z_][a-z0-9_]*\s*=|["'`{[])/i;

export interface ToolCallMarkupHit {
  /** Which surface produced the hit — for diagnostics, never secrets. */
  kind: "envelope" | "fenced_json" | "bare_json" | "truncated_envelope" | "function_call_syntax";
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
      (typeof parsed?.action === "string" && parsed.action) ||
      "";
    if (!name) return undefined;
    return candidates.has(name.toLowerCase()) ? name : undefined;
  } catch {
    return undefined;
  }
}

/** Fields that mark a whole-payload JSON object as a call envelope rather
 *  than data — `action`/`command`/`tool`/`function` carriers or raw
 *  arg_structure keys. `name` alone is too generic to count; it only
 *  signals intent paired with `arguments`/`parameters`. */
const JSON_PROTOCOL_FIELDS = [
  "action",
  "command",
  "tool",
  "tool_call",
  "tool_name",
  "function",
  "function_call",
  "arg_key",
  "arg_value",
] as const;

function jsonHasProtocolFields(parsed: Record<string, unknown>): boolean {
  if (JSON_PROTOCOL_FIELDS.some((k) => k in parsed)) return true;
  return (
    typeof parsed.name === "string" &&
    ("arguments" in parsed || "parameters" in parsed)
  );
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
    // A response that is entirely an action envelope is an attempted
    // invocation even when its action names no registered tool — it can
    // never execute, and it is never user-facing prose.
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && jsonHasProtocolFields(parsed)) {
        return { kind: "bare_json" };
      }
    } catch {
      // Not JSON — not markup.
    }
  }

  // 4. Pseudo-function-call syntax: `files.write(path="index.html", …)`.
  //    Models primed with tool-invocation instructions but given no
  //    structured tools echo the call as code-like text. The name must
  //    resolve to a REGISTERED tool id and the paren must carry an
  //    argument signature (named arg `k=` or a quoted literal) — so
  //    `node.js docs`, `v1.2.3`, or `foo.bar(baz=1)` for an unknown tool
  //    never count. Markup quoted inside inline code is prose, not
  //    protocol, and is skipped.
  for (const m of text.matchAll(FUNCTION_CALL_RE)) {
    const start = m.index ?? 0;
    const whole = m[0];
    // Skip when quoted inside inline code — `like files.write(path="x")`.
    // The lead char is part of the match, so the tool name starts after it.
    const nameStart = start + (m[1]?.length ?? 0);
    if (text[nameStart - 1] === "`") continue;
    const toolId = resolveToolId(`${m[2]}.${m[3]}`, knownToolIds);
    if (!toolId) continue;
    const afterParen = text.slice(start + whole.length, start + whole.length + 160);
    if (!ARG_SIGNATURE_RE.test(afterParen)) continue;
    return { kind: "function_call_syntax", toolId };
  }

  return null;
}

/**
 * True when the text contains a recognizable tool-call envelope
 * (<tool_call>, <invoke>, <dots_function_call>, …) — closed or truncated —
 * that is not quoted inside inline code.
 *
 * Unlike findToolCallMarkup this does NOT require invocation intent: an
 * envelope whose payload names no tool and carries no arg structure is
 * still a text-format tool attempt. The execution lane uses this to fail
 * over instead of accepting such a response as a final answer — otherwise
 * the run silently completes with "nothing was executed".
 */
export function hasToolCallEnvelope(text: string): boolean {
  if (!text || !text.trim()) return false;
  for (const m of text.matchAll(new RegExp(ENVELOPE_RE.source, "gi"))) {
    const idx = m.index ?? 0;
    const whole = m[0];
    // Skip markup quoted inside inline code — `like <tool_call>x</tool_call>`
    // — those are examples, not invocations.
    if (text[idx - 1] === "`" && text[idx + whole.length] === "`") continue;
    return true;
  }
  return false;
}

// ─── Hygiene: strip non-executable markup from visible text ──────────
//
// Models that regress from native function calling emit tool calls as
// text markup — ```tool_call fences (closed or truncated), <tool_call>
// XML tags, or bare JSON tool objects mid-prose. They are NEVER
// executed — but they must not leak verbatim into the user-facing
// transcript either. XML tags are normalized to the fence form first so
// the shared @litt/agent-core stripper covers every shape with one
// implementation.

/** `<tool_call …>…</tool_call>` including an unclosed trailing tag and
 *  attribute-bearing openers. The `(?=[\s/>])` lookahead keeps
 *  `<tool_calls>` (plural) from matching. */
const XML_TOOL_CALL_RE = /<tool_call(?=[\s/>])[^>]*>([\s\S]*?)(<\/tool_call[^>]*>|$)/gi;
/** Orphan `</tool_call>` close tag (truncated markup mid-stream). */
const XML_TOOL_CALL_CLOSE_RE = /<\/tool_call[^>]*>/gi;
/** antml-style `<arg_key>…</arg_key>` / `<arg_value>…</arg_value>` tags —
 *  protocol junk emitted inside tool_call markup; only stripped when the
 *  text already contained tool_call markers. */
const XML_ARG_TAG_RE = /<arg_(key|value)\s*>[\s\S]*?<\/arg_\1\s*>/gi;

function normalizeXmlToolCallTags(text: string): string {
  if (!text.includes("<tool_call") && !text.includes("</tool_call")) return text;
  const fenced = text.replace(XML_TOOL_CALL_RE, (_m, inner: string) => `\`\`\`tool_call\n${inner}\n\`\`\``);
  return fenced.replace(XML_TOOL_CALL_CLOSE_RE, "").replace(XML_ARG_TAG_RE, "");
}

/**
 * Strip tool-call markup from visible text. Returns the input trimmed,
 * minus any recognizable markup. No markup → the trimmed input.
 */
export function stripToolCallMarkupText(text: string): string {
  if (!text) return text;
  return stripToolCallBlocks(normalizeXmlToolCallTags(text)).trim();
}

/**
 * Strip tool-call ENVELOPE markup — <tool_call>, <invoke>,
 * <dots_function_call>, <function_call>, <function_calls>, closed or
 * truncated — from text. stripToolCallMarkupText only covers <tool_call>
 * plus fenced/JSON blocks; the other XML envelope tags pass straight
 * through it.
 *
 * Markup quoted inside inline code (backticks) is prose, not protocol,
 * and is preserved. Used to keep replayed assistant history (including
 * across approval resumes) from re-priming the model to emit the
 * envelope again instead of using structured calls.
 */
export function stripEnvelopeMarkup(text: string): string {
  if (!text) return text;
  // Inline `code` spans are prose examples, not protocol: shield them before
  // any stripping pass. The envelope loop below only skips backtick-adjacent
  // markup, and the trailing stripToolCallBlocks() has no backtick awareness
  // at all — without shielding it would remove quoted examples too.
  // Fenced ``` blocks are left in place: the hygiene pass handles those.
  const codeSpans: string[] = [];
  const shielded = text.replace(/```[\s\S]*?```|(`[^`\n]*`)/g, (m, code) => {
    if (code === undefined) return m;
    const idx = codeSpans.length;
    codeSpans.push(code);
    return `__LITT_CODE_${idx}__`;
  });
  const re = new RegExp(ENVELOPE_RE.source, "gi");
  let out = "";
  let last = 0;
  for (const m of shielded.matchAll(re)) {
    const idx = m.index ?? 0;
    const whole = m[0];
    // Backticks are shielded above; keep the adjacency guard for unbalanced
    // backtick cases the shield regex leaves alone.
    if (shielded[idx - 1] === "`" && shielded[idx + whole.length] === "`") continue;
    out += shielded.slice(last, idx);
    last = idx + whole.length;
  }
  out += shielded.slice(last);
  const cleaned = stripToolCallBlocks(out).trim();
  return cleaned.replace(/__LITT_CODE_(\d+)__/g, (_, n) => codeSpans[Number(n)] ?? "");
}

// ─── Canonical normalization boundary ─────────────────────────────
//
// Detection says WHETHER text carries invocation intent; recovery says
// WHAT the model meant. A markup block is only recoverable when it
// parses deterministically into a registered tool id plus schema-valid
// arguments — anything short of that is an incompatible protocol
// emission, and the caller fails over instead of executing a guess.

export interface RecoveredToolCall {
  toolId: string;
  inputs: Record<string, unknown>;
}

export interface TextToolCallRecovery {
  /** Canonical calls recovered from the text, in document order. */
  calls: RecoveredToolCall[];
  /** The text with every consumed markup span removed. */
  residualText: string;
  /** True when markup intent was detected but could not be fully
   *  normalized — the caller must treat the response as a protocol
   *  failure rather than executing a partial guess. */
  malformed: boolean;
}

const EMPTY_RECOVERY: TextToolCallRecovery = { calls: [], residualText: "", malformed: false };

/** Resolve a recovered name to a registered tool id: exact, the
 *  underscore-sanitized form (`files_read` → `files.read`), or a unique
 *  prefix (`terminal` → `terminal.execute`) when exactly one tool owns it. */
function resolveToolId(name: string, knownToolIds: ReadonlySet<string>): string | undefined {
  const n = name.trim();
  if (knownToolIds.has(n)) return n;
  const lower = n.toLowerCase();
  if (knownToolIds.has(lower)) return lower;
  const undotted = lower.replace(/_/g, ".");
  if (knownToolIds.has(undotted)) return undotted;
  const prefixMatches = [...knownToolIds].filter((id) => id.split(".")[0] === lower);
  if (prefixMatches.length === 1) return prefixMatches[0];
  return undefined;
}

/** antml-style pairs: `<arg_key>k</arg_key><arg_value>v</arg_value>` or
 *  `<parameter name="k">v</parameter>` (invoke form). */
const ARG_PAIR_RE = /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/gi;
const PARAMETER_RE = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;

function parseArgPairs(payload: string): Record<string, unknown> | null {
  const inputs: Record<string, unknown> = {};
  let matched = false;
  for (const m of payload.matchAll(new RegExp(ARG_PAIR_RE.source, "gi"))) {
    inputs[m[1].trim()] = m[2].trim();
    matched = true;
  }
  for (const m of payload.matchAll(new RegExp(PARAMETER_RE.source, "gi"))) {
    inputs[m[1].trim()] = m[2].trim();
    matched = true;
  }
  return matched ? inputs : null;
}

/** JSON envelope shapes: {name,arguments}, {tool,inputs},
 *  {function:{name,arguments}}, {action, ...rest→inputs}. */
function parseJsonEnvelope(raw: string): { name: string; inputs: Record<string, unknown> } | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const fn = parsed.function as Record<string, unknown> | undefined;
  if (fn && typeof fn.name === "string") {
    let args: unknown = fn.arguments ?? fn.parameters;
    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { return null; }
    }
    return { name: fn.name, inputs: args && typeof args === "object" ? (args as Record<string, unknown>) : {} };
  }

  const direct = parsed.name ?? parsed.tool ?? parsed.action ?? parsed.tool_name;
  if (typeof direct !== "string" || !direct) return null;
  const named = parsed.arguments ?? parsed.parameters ?? parsed.inputs;
  if (named && typeof named === "object") {
    return { name: direct, inputs: named as Record<string, unknown> };
  }
  // `name` alone is not a protocol carrier — `{"name": "Jared"}` is data.
  // Only a carrier field (tool/action/tool_name/…) or name+args makes
  // the remaining keys inputs.
  if (!jsonHasProtocolFields(parsed)) return null;
  const rest = Object.fromEntries(
    Object.entries(parsed).filter(
      ([k]) => !["name", "tool", "action", "tool_call", "tool_name", "function", "function_call"].includes(k),
    ),
  );
  return { name: direct, inputs: rest };
}

/** Parse one envelope payload into a name + inputs, or null. */
function parseEnvelopePayload(tagAttrs: string, payload: string): { name: string; inputs: Record<string, unknown> } | null {
  // <invoke name="files.read"><parameter …> — name lives on the tag.
  const attrName = tagAttrs.match(/name\s*=\s*["']([^"']+)["']/i)?.[1];
  const trimmed = payload.trim();

  if (trimmed.startsWith("{")) {
    const env = parseJsonEnvelope(trimmed);
    if (env) return { name: attrName ?? env.name, inputs: env.inputs };
  }

  if (attrName) {
    const inputs = parseArgPairs(payload);
    if (inputs) return { name: attrName, inputs };
  }

  // antml form: first line is the tool name, the rest is arg pairs.
  const firstBreak = trimmed.search(/[\n<]/);
  if (firstBreak > 0) {
    const name = trimmed.slice(0, firstBreak).trim();
    const inputs = parseArgPairs(trimmed.slice(firstBreak));
    if (name && inputs) return { name, inputs };
  }

  return null;
}

interface PendingSpan {
  start: number;
  end: number;
  parsed?: { name: string; inputs: Record<string, unknown> };
  intent: boolean; // markup-like; if unparseable the whole response is malformed
}

/**
 * Recover every safely-parseable tool call from model text. Spans are
 * consumed only when they carry invocation intent; quoted examples and
 * intent-free envelopes stay in the residual text.
 */
export function recoverTextToolCalls(
  text: string,
  knownToolIds: ReadonlySet<string>,
): TextToolCallRecovery {
  if (!text || !text.trim()) return { ...EMPTY_RECOVERY, residualText: text };
  const candidates = toolIdCandidates(knownToolIds);
  const spans: PendingSpan[] = [];

  // 1. XML envelopes — closed or truncated.
  for (const m of text.matchAll(new RegExp(ENVELOPE_RE.source, "gi"))) {
    const start = m.index ?? 0;
    const whole = m[0];
    // Skip markup quoted inside inline code — `like <tool_call>x</tool_call>`.
    if (text[start - 1] === "`" && text[start + whole.length] === "`") continue;
    const truncated = !new RegExp(`<\\/(?:${ENVELOPE_TAGS.join("|")})>\\s*$`, "i").test(whole);
    const parsed = truncated ? null : parseEnvelopePayload(m[2] ?? "", m[3] ?? "");
    const payload = `${m[2] ?? ""}\n${m[3] ?? ""}`;
    const intent =
      !!parsed ||
      payloadMentionsTool(payload, candidates) !== undefined ||
      ARG_STRUCTURE_RE.test(payload);
    if (!intent) continue;
    spans.push({ start, end: start + whole.length, parsed: parsed ?? undefined, intent: true });
  }

  // 2. Fenced blocks — a fence labeled tool_call/function_call is protocol
  //    markup regardless of payload validity; other fences only count when
  //    the payload parses as an envelope or names a known tool.
  for (const m of text.matchAll(new RegExp(FENCED_BLOCK_RE.source, "g"))) {
    const start = m.index ?? 0;
    const payload = (m[1] ?? "").trim();
    const isToolFence = /```\s*(tool_call|function_call)/i.test(m[0].slice(0, 30));
    const parsed = parseJsonEnvelope(payload);
    const intent = isToolFence || !!parsed || payloadMentionsTool(payload, candidates) !== undefined;
    if (!intent) continue;
    spans.push({ start, end: start + m[0].length, parsed: parsed ?? undefined, intent: true });
  }

  // 3. Bare JSON — the whole payload, or a balanced span mid-text that
  //    carries an envelope. Skip spans already covered by earlier markup.
  const covered = (i: number) => spans.some((s) => i >= s.start && i < s.end);
  const tryBare = (raw: string, start: number, end: number) => {
    const parsed = parseJsonEnvelope(raw);
    const hasIntentFields = (() => {
      try {
        const p = JSON.parse(raw) as Record<string, unknown>;
        return !!p && typeof p === "object" && !Array.isArray(p) && jsonHasProtocolFields(p);
      } catch { return false; }
    })();
    if (parsed || hasIntentFields) {
      spans.push({ start, end, parsed: parsed ?? undefined, intent: true });
    }
  };
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}") && !covered(text.indexOf(trimmed))) {
    tryBare(trimmed, text.indexOf(trimmed), text.indexOf(trimmed) + trimmed.length);
  }
  if (spans.length === 0) {
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== "{") continue;
      const span = balancedBraceSpan(text, i);
      if (!span) continue;
      const parsed = parseJsonEnvelope(span);
      if (parsed && resolveToolId(parsed.name, knownToolIds)) {
        spans.push({ start: i, end: i + span.length, parsed, intent: true });
        i += span.length;
      }
    }
  }

  if (spans.length === 0) return { ...EMPTY_RECOVERY, residualText: text };

  spans.sort((a, b) => a.start - b.start);
  const malformed = spans.some((s) => s.intent && !s.parsed);
  const calls: RecoveredToolCall[] = [];
  const seen = new Set<string>();
  for (const s of spans) {
    if (!s.parsed) continue;
    const toolId = resolveToolId(s.parsed.name, knownToolIds);
    if (!toolId) { s.intent = true; s.parsed = undefined; continue; }
    const key = `${toolId}::${JSON.stringify(s.parsed.inputs)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push({ toolId, inputs: s.parsed.inputs });
  }

  // Unknown-tool envelopes count as malformed intent — recomputed after
  // resolution so a recognized-but-unregistered name still fails over.
  const unresolved = spans.some((s) => s.intent && !s.parsed);

  let residual = "";
  let cursor = 0;
  for (const s of spans) {
    residual += text.slice(cursor, s.start);
    cursor = s.end;
  }
  residual += text.slice(cursor);

  return {
    calls,
    residualText: residual.trim(),
    malformed: malformed || unresolved,
  };
}

/** Balanced `{…}` span starting at `openIdx`, or null when unbalanced. */
function balancedBraceSpan(content: string, openIdx: number): string | null {
  let depth = 0;
  for (let i = openIdx; i < content.length; i++) {
    if (content[i] === "{") depth++;
    else if (content[i] === "}") {
      depth--;
      if (depth === 0) return content.slice(openIdx, i + 1);
    }
  }
  return null;
}
