/**
 * Tool-call stream filter — prevents raw model tool-call protocol from
 * leaking into the user-facing chat transcript.
 *
 * The agent loop instructs models to emit tool calls as fenced blocks:
 *
 *   ```tool_call
 *   { "tool": "project.status", "inputs": {} }
 *   ```
 *
 * Models stream token-by-token, so a single block arrives across MANY
 * deltas ("```", "tool", "_call", "\n{", " \"tool\"", ...). A per-delta
 * prefix check can never catch those fragments — which is how raw
 * `tool_call` syntax previously leaked into the live chat preview.
 *
 * This filter is stateful across deltas:
 *   - Detects a ```tool_call / ```tool_result / ```tool / ```json fence
 *     (even when the opener is split across deltas) and suppresses
 *     everything inside it until the closing ```.
 *   - Detects a bare JSON tool object line (`{ "tool": ... }` — models
 *     sometimes skip the fences) and suppresses it.
 *   - Detects a bare `tool_call` / `tool_result` protocol line and
 *     suppresses it.
 *   - Preserves surrounding prose.
 *
 * The finalized message is additionally stripped by the agent loop's
 * stripToolCallBlocks(); this filter only protects the LIVE preview.
 */

/** Fence openers for tool protocol blocks. */
const FENCE_OPENER_RE = /```(?:tool(?:_call|_result)?|json)[ \t]*/i;
/** Bare JSON tool object at the start of a line: { "tool": ... etc. */
const BARE_TOOL_JSON_RE = /(^|\n)[ \t]*\{[ \t]*"(?:tool|name|command|type)"/;
/** Bare protocol word at the start of a line (no fences). */
const BARE_PROTOCOL_LINE_RE = /(^|\n)[ \t]*(?:tool_call|tool_result)[ \t]*\r?\n/;
/** Longest opener + slack — text withheld pending a cross-delta opener. */
const KEEP_TAIL = 32;
/** Keep 3 chars so a closing ``` split across deltas is still caught. */
const CLOSE_TAIL = 3;

export interface ToolCallStreamFilter {
  /** Feed one delta; returns the user-visible portion ("" inside protocol). */
  next(delta: string): string;
  /** Flush withheld tail text. In-progress fence content is dropped. */
  flush(): string;
}

/**
 * Create a stateful per-stream filter. Call once per agent-loop run and
 * feed every delta through next(); the returned string is the visible
 * portion of that delta. Call flush() when the stream ends.
 */
export function createToolCallStreamFilter(): ToolCallStreamFilter {
  let carry = "";
  let inFence = false;

  function next(delta: string): string {
    carry += delta;
    let out = "";

    while (carry.length > 0) {
      if (inFence) {
        const close = carry.indexOf("```");
        if (close === -1) {
          // Still inside the fence — drop everything, keep a tiny tail
          // so a closing fence split across deltas is still detected.
          carry = carry.length > CLOSE_TAIL ? carry.slice(-CLOSE_TAIL) : carry;
          break;
        }
        carry = carry.slice(close + 3);
        inFence = false;
        continue;
      }

      const fenceIdx = carry.search(FENCE_OPENER_RE);
      const jsonIdx = carry.search(BARE_TOOL_JSON_RE);
      const protoIdx = carry.search(BARE_PROTOCOL_LINE_RE);

      // Earliest trigger wins. Prefer the fence opener.
      let start = -1;
      let kind: "fence" | "line" | null = null;
      if (fenceIdx !== -1) {
        start = fenceIdx;
        kind = "fence";
        if (jsonIdx !== -1 && jsonIdx < start) { start = jsonIdx; kind = "line"; }
        if (protoIdx !== -1 && protoIdx < start) { start = protoIdx; kind = "line"; }
      } else {
        const candidates = [jsonIdx, protoIdx].filter((i) => i !== -1);
        if (candidates.length > 0) {
          start = Math.min(...candidates);
          kind = "line";
        }
      }

      if (start === -1 || kind === null) {
        // No trigger — emit everything except a bounded tail (a fence
        // opener could be split across delta boundaries).
        if (carry.length > KEEP_TAIL) {
          out += carry.slice(0, carry.length - KEEP_TAIL);
          carry = carry.slice(-KEEP_TAIL);
        }
        break;
      }

      // Emit prose before the trigger. For "line" triggers the match
      // starts at a newline (or ^) — skip that newline so the protocol
      // line itself is suppressed. For fence triggers the match starts
      // AT the backticks — emit up to them.
      const lineStartOffset = kind === "fence" ? start : (start === 0 ? 0 : start + 1);
      out += carry.slice(0, lineStartOffset);
      carry = carry.slice(lineStartOffset);

      if (kind === "fence") {
        // Consume the opener itself (```tool_call…) so it is not
        // mistaken for the closing fence, then suppress until close.
        const m = carry.match(FENCE_OPENER_RE);
        if (m) carry = carry.slice(m[0].length);
        inFence = true;
      } else {
        // Bare protocol line / JSON line — suppress through the line end.
        const nl = carry.indexOf("\n");
        carry = nl === -1 ? "" : carry.slice(nl + 1);
      }
    }

    return out;
  }

  function flush(): string {
    let out = "";
    if (inFence) {
      // Stream ended inside a fence — drop the remainder.
      carry = "";
      inFence = false;
      return "";
    }
    // Emit any withheld tail (it never formed a fence).
    out += carry;
    carry = "";
    return out;
  }

  return { next, flush };
}

/**
 * Drop-in predicate check for a single text chunk.
 * Kept for existing tests/back-compat; new code should use
 * createToolCallStreamFilter().
 */
export function isToolCallMarkup(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (FENCE_OPENER_RE.test(trimmed) || trimmed.startsWith("```")) return true;
  if (/^\{[ \t]*"(?:tool|name|command|type)"/.test(trimmed)) return true;
  if (/^(?:tool_call|tool_result)[ \t]*$/.test(trimmed)) return true;
  if (trimmed === "```") return true;
  return false;
}
