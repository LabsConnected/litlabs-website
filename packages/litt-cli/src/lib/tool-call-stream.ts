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
const MID_LINE_TOOL_JSON_RE = /\n[ \t]*\{[ \t]*"(?:tool|name|command|type)"/;
const MID_LINE_PROTOCOL_RE = /\n[ \t]*(?:tool_call|tool_result)[ \t]*\r?\n/;
const PARTIAL_FENCE_RE = /`{1,2}$|```(?:t|to|too|j|js|jso)?$/i;
const TOOL_KEYS = ['"tool"', '"name"', '"command"', '"type"'];
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
 *
 * Protocol states:
 *   - inFence: inside a ```tool_call/```tool_result/```tool/```json
 *     fence — everything is suppressed until the closing ```.
 *   - inJsonObject: a bare JSON tool object (`{ "tool": ... }`) was
 *     detected WITHOUT fences. It is suppressed until the braces
 *     balance (the object is complete). This closes the leak where a
 *     tool object split across deltas — e.g. delta A `{"tool":"`,
 *     delta B `project.status","inputs":{}}` — previously emitted the
 *     trailing fragments (`project.status","inputs":{}`) because they
 *     no longer started with `{`.
 */
export function createToolCallStreamFilter(): ToolCallStreamFilter {
  let carry = "";
  let inFence = false;
  let jsonDepth = 0;
  let inString = false;
  let escaped = false;
  let lineStart = true;

  function discardToolJson() {
    let i = 0;
    while (i < carry.length) {
      const ch = carry[i++];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") jsonDepth++;
      else if (ch === "}" && --jsonDepth === 0) break;
    }
    carry = carry.slice(i);
  }

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
        lineStart = true;
        continue;
      }

      if (jsonDepth > 0) {
        discardToolJson();
        continue;
      }

      const fenceIdx = carry.search(FENCE_OPENER_RE);
      const jsonIdx = carry.search(lineStart ? BARE_TOOL_JSON_RE : MID_LINE_TOOL_JSON_RE);
      const protoIdx = carry.search(lineStart ? BARE_PROTOCOL_LINE_RE : MID_LINE_PROTOCOL_RE);

      // Earliest trigger wins. Prefer the fence opener.
      let start = -1;
      let kind: "fence" | "line" | "json" | null = null;
      if (fenceIdx !== -1) {
        start = fenceIdx;
        kind = "fence";
        if (jsonIdx !== -1 && jsonIdx < start) { start = jsonIdx; kind = "json"; }
        if (protoIdx !== -1 && protoIdx < start) { start = protoIdx; kind = "line"; }
      } else {
        const candidates = [jsonIdx, protoIdx].filter((i) => i !== -1);
        if (candidates.length > 0) {
          start = Math.min(...candidates);
          kind = start === jsonIdx ? "json" : "line";
        }
      }

      if (start === -1 || kind === null) {
        // Only defer a suffix that can still become a protocol opener.
        // Holding ordinary prose makes short replies appear all at once.
        let boundary = carry.search(PARTIAL_FENCE_RE);
        if (boundary === -1) boundary = carry.length;
        const lastNewline = carry.lastIndexOf("\n");
        const lineOffset = lastNewline + 1;
        if (lastNewline >= 0 || lineStart) {
          const tail = carry.slice(lineOffset).replace(/^[ \t]+/, "");
          const pendingJson = tail.startsWith("{")
            && TOOL_KEYS.some((key) => key.startsWith(tail.slice(1).trimStart()));
          const pendingName = ["tool_call", "tool_result"].some((name) =>
            name.startsWith(tail.toLowerCase()) || tail.toLowerCase().trimEnd() === name,
          );
          if (tail && (pendingJson || pendingName)) boundary = Math.min(boundary, lineOffset);
        }
        const visible = carry.slice(0, boundary);
        const nl = visible.lastIndexOf("\n");
        lineStart = (nl >= 0 || lineStart) && /^[ \t]*$/.test(visible.slice(nl + 1));
        out += visible;
        carry = carry.slice(boundary);
        break;
      }

      // Emit prose before the trigger. For line/json triggers the match
      // starts at a newline (or ^) — skip that newline so the protocol
      // content itself is suppressed. For fence triggers the match
      // starts AT the backticks — emit up to them.
      const lineStartOffset = kind !== "fence" && carry[start] === "\n" ? start + 1 : start;
      out += carry.slice(0, lineStartOffset);
      carry = carry.slice(lineStartOffset);
      lineStart = true;

      if (kind === "fence") {
        // Consume the opener itself (```tool_call…) so it is not
        // mistaken for the closing fence, then suppress until close.
        const m = carry.match(FENCE_OPENER_RE);
        if (m) carry = carry.slice(m[0].length);
        inFence = true;
      } else if (kind === "json") {
        discardToolJson();
      } else {
        // Bare protocol line (tool_call / tool_result) — suppress
        // through the line end.
        const nl = carry.indexOf("\n");
        carry = nl === -1 ? "" : carry.slice(nl + 1);
      }
    }

    return out;
  }

  function flush(): string {
    let out = "";
    if (inFence || jsonDepth > 0) {
      // Stream ended inside protocol content — drop the remainder.
      carry = "";
      inFence = false;
      jsonDepth = 0;
      inString = false;
      escaped = false;
      lineStart = true;
      return "";
    }
    // Emit any withheld tail (it never formed a fence).
    out += carry;
    carry = "";
    lineStart = true;
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
