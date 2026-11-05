/**
 * Shared local-Ollama routing policy — the ONE canonical copy.
 *
 * Consumers: llm.ts (V1 streaming/generation chain), llm-tool-calling.ts
 * (V2 Basic router), and /api/llm/health (truthful local availability).
 * The tool-capable family rule and the preferred-model order previously
 * lived as near-identical copies in both routers — keep them here so the
 * two lanes can never drift apart again.
 */
import "server-only";

import { OLLAMA_ENDPOINT_ENV_VARS } from "@litt/models";

/** Local Ollama route eligibility — the ONE canonical rule. Include local
 *  Ollama when explicitly configured via an endpoint env var, or when not
 *  running on a deployed host (probing localhost on Railway/Vercel is
 *  pointless). LITT_DISABLE_OLLAMA hard-disables.
 *
 *  This rule previously lived as two identical copies (provider-registry's
 *  ollamaIncluded + llm.ts's ollamaTailEligible) — both delegate here now. */
export function ollamaRouteEligible(
  getEnv: (key: string) => string | undefined = (key) => process.env[key],
): boolean {
  if (getEnv("LITT_DISABLE_OLLAMA")) return false;
  if (OLLAMA_ENDPOINT_ENV_VARS.some((k) => !!getEnv(k))) return true;
  const deployed = !!(
    getEnv("RAILWAY_ENVIRONMENT") ||
    getEnv("RAILWAY_PROJECT_ID") ||
    getEnv("VERCEL")
  );
  return !deployed;
}

/** Local model families with reliable structured tool calling. The
 *  litt-hermes builds are Qwen3-based and litt-tools is the tool-tuned
 *  variant — both advertise tool support even though their custom tags
 *  don't match the upstream family names below. litt-coder is the
 *  lightweight lane (qwen2.5-coder base) and DOES advertise tools via
 *  /api/tags (verified Oct 2026). */
export const OLLAMA_TOOL_CAPABLE =
  // litt-hermes-fast excluded: its qwen3-thinking weights emit a
  // `reasoning` preamble even under think:false and produced zero tool
  // calls on the real Studio prompt — flagging it as a builder model
  // invites a guaranteed-dead pick. It stays a fine chat fallback.
  /llama-?3\.[123]|llama3\.[123]|qwen|mistral|nemo|command-r|granite|phi-?4|functionary|deepseek|devstral|gpt-oss|litt-hermes(?!-fast)|litt-builder|litt-tools|litt-coder/i;

/** Prefer a usable local tool model, not just a nominally capable one:
 *  on CPU-heavy dev hosts a full hermes variant measured >300s per call
 *  while litt-hermes-fast answered in ~73s, and both emit valid tool
 *  calls. Returns undefined when nothing tool-capable is loaded.
 *
 *  `minCtxTokens` makes the pick context-fit aware: candidates whose ":Nk"
 *  window is smaller than the estimated request are skipped first — an
 *  over-window pick is a guaranteed truncated turn. Among fitting models
 *  the order is litt-coder (dedicated coding lane) → litt-hermes-fast:64k
 *  → litt-hermes :16k/:32k/:64k → litt-tools, then the legacy order for
 *  anything that does not fit (the caller still logs the over-budget). */
export function preferredLocalToolModel(
  available: string[],
  minCtxTokens = 0,
): string | undefined {
  const capable = available.filter((m) => OLLAMA_TOOL_CAPABLE.test(m));
  // Dedicated 8K coding lane first (litt-coder:8k — Qwen2.5-Coder 1.5B).
  // The prompt-budget lane (compactToolDescription + output reserve +
  // over-budget logging in the caller) is what carries a build request on
  // an 8K window — we do NOT escalate to a bigger tag just because the
  // estimate is large; the manual :16k/:32k/:64k pins remain reachable
  // via explicit model selection.
  // Multi-step tool runs need a model that emits structured tool_calls —
  // litt-coder:8k (1.5B) emits calls as text/prose, not tool_calls (proven
  // in acceptance runs). Prefer the capable 4B hermes window; litt-coder
  // remains available as the lightweight lane after it.
  // CPU-bound box evidence: hermes:16k (4B) emits valid tool calls but
  // burns ~180s/turn; hermes-fast (2B) answered faster but its forced
  // reasoning preamble burned the output budget without emitting calls.
  // litt-builder is the validated builder lane: same non-thinking hermes
  // weights/template that emit clean native tool_calls, at an 8k window
  // that keeps CPU-bound turns under the attempt cap. Preferred over the
  // hermes-fast builds — those are qwen3-thinking builds that emit a
  // `reasoning` preamble even under think:false (proven: reasoning-only
  // responses with zero tool calls on the real Studio prompt).
  const pickFrom = (list: string[]): string | undefined =>
    // litt-coder:16k first — the ONLY local build that completed the full
    // Studio loop end-to-end on CPU-bound hardware (3×12/12 acceptance:
    // real HTML writes, approval-gated edits, persistence, preview,
    // export at ~5-20s/turn). Its fenced text tool calls are recovered by
    // normalizeTextToolCalls, so native tool_calls are not required.
    // litt-builder:16k emits native tool_calls but a 4B model at ~66% CPU
    // offload takes >900s on the write turn — quality fallback only.
    // The 8k window is too small for the build loop (HTTP 400 at 9,383
    // prompt tokens); 8k models remain reachable via explicit selection.
    list.find((m) => /^litt-coder:16k/i.test(m)) ??
    list.find((m) => /^litt-builder:16k/i.test(m)) ??
    list.find((m) => /^litt-builder:8k/i.test(m)) ??
    list.find((m) => /^litt-builder/i.test(m)) ??
    list.find((m) => /^litt-hermes:16k/i.test(m)) ??
    list.find((m) => /^litt-hermes:32k/i.test(m)) ??
    list.find((m) => /^litt-hermes:64k/i.test(m)) ??
    list.find((m) => /^litt-hermes-fast:64k/i.test(m)) ??
    list.find((m) => /^litt-hermes-fast:8k/i.test(m)) ??
    list.find((m) => /^litt-hermes-fast/i.test(m)) ??
    list.find((m) => /^litt-tools/i.test(m)) ??
    list.find((m) => /^litt-coder:8k/i.test(m)) ??
    list.find((m) => /^litt-coder/i.test(m)) ??
    list.find((m) => /^litt-hermes/i.test(m)) ??
    list[0];
  // Context-fit aware: when the caller knows the request's estimated
  // prompt size, prefer candidates whose ":Nk" window can actually hold it
  // (an over-window pick is a guaranteed HTTP 400, not a slow turn).
  // Models without a size hint are treated as fitting — unknown context
  // is not assumed small.
  if (minCtxTokens > 0) {
    const fitting = capable.filter((m) => {
      const ctx = ollamaContextTokens(m);
      return ctx === null || ctx >= minCtxTokens;
    });
    const fitPick = pickFrom(fitting);
    if (fitPick) return fitPick;
  }
  return pickFrom(capable);
}

/** Default local chat model — the lightweight lane. litt-fast:2k is the
 *  tuned general-chat build; hermes-fast next for tool-ish chat; anything
 *  else last. The manual :16k/:32k/:64k pins remain reachable via the
 *  explicit model-override path, which never goes through this pick. */
export function preferredLocalChatModel(available: string[]): string | undefined {
  return (
    available.find((m) => /^litt-fast:2k/i.test(m)) ??
    available.find((m) => /^litt-fast/i.test(m)) ??
    available.find((m) => /^litt-hermes-fast/i.test(m)) ??
    available[0]
  );
}

/** Keep-alive sent on every local request so an active Studio session
 *  never thrashes model load/unload between turns — Ollama's default
 *  unload window is ~5m, which forced a multi-GB reload on every chat
 *  step of a build. Override with OLLAMA_KEEP_ALIVE (duration string,
 *  "-1" to stay resident, "0" to restore eager unload). The same var is
 *  also the daemon's own default keep-alive, so one setting governs
 *  both sides. */
export function ollamaKeepAliveSetting(): string {
  // LiTT policy (litt-coder lane): local models unload 1m after last use so
  // the lightweight lane stays thermally bounded. Callers may still
  // override per-request; the env var wins when set.
  return process.env.OLLAMA_KEEP_ALIVE?.trim() || "1m";
}

// ─── Small-context budget policy (the 8K lane) ────────────────────
//
// Small local builds carry their context size in the tag ("litt-hermes-
// fast:8k", "litt-tools:4k", "litt-coder:8k"). When the window is ≤8K the
// request must budget: system prompt + tool schemas + transcript + the
// RESPONSE all live inside num_ctx. These helpers centralize that policy
// so both routers apply the same rule instead of inventing per-call caps.

/** Parse a ":Nk" context hint out of a model tag. Returns null when the
 *  tag carries no size hint (the caller then applies no small-context
 *  policy — unknown context is not assumed small). */
export function ollamaContextTokens(model: string): number | null {
  const m = /:(\d+)k$/i.exec(model);
  return m ? Number(m[1]) * 1024 : null;
}

/** Upper bound the small-context policy manages. Above this the caller's
 *  own max_tokens (or provider default) stands untouched. */
export const OLLAMA_SMALL_CONTEXT_MAX = 8_192;

/** Response-token budget for a small-context model: a quarter of the
 *  window leaves ~3/4 for system prompt, tool schemas, and transcript.
 *  Returns null for large/unknown contexts (no cap applied). Applied ONLY
 *  when the caller didn't set max_tokens — an explicit budget always
 *  wins. */
export function ollamaOutputTokenBudget(model: string): number | null {
  const ctx = ollamaContextTokens(model);
  if (!ctx || ctx > OLLAMA_SMALL_CONTEXT_MAX) return null;
  return Math.floor(ctx / 4);
}

/** Rough token estimate (~4 chars/token) of what the provider will place
 *  into context: system prompt + every message + serialized tool schemas. */
export function estimateOllamaPromptTokens(
  systemPrompt: string,
  messages: Array<{ content?: unknown }>,
  serializedTools: unknown[],
): number {
  let chars = systemPrompt.length;
  for (const m of messages) {
    chars += typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length;
  }
  for (const t of serializedTools) chars += JSON.stringify(t).length;
  return Math.ceil(chars / 4);
}

/** Cap a tool description for small-context lanes: first sentence, then a
 *  hard ceiling. Keeps tool NAMES and parameter schemas intact — only the
 *  prose shrinks, so calls stay schema-valid. */
export function compactToolDescription(description: string, maxChars = 160): string {
  const first = description.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  const candidate = first.length >= 24 ? first : description;
  return candidate.length <= maxChars ? candidate : `${candidate.slice(0, maxChars - 1).trimEnd()}…`;
}
