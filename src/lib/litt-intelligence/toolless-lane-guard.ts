/**
 * Guard for tool-less text lanes — chat endpoints that call
 * streamText/generateText with NO tools attached, but whose prompts were
 * assembled with tool-teaching content (tool manifests, "you MUST call the
 * tool before answering", …). Without a counter-directive, the model can
 * echo fake tool calls as ordinary chat text — the puppet-master
 * production incident class: nothing executes, the pseudo-call is
 * persisted as the answer, and a later turn's history re-primes the
 * model to do it again.
 *
 * Two defenses, applied together at each tool-less call site:
 *   1. Append TOOLLESS_TEXT_LANE_DIRECTIVE to the prompt so the model is
 *      explicitly told no tools exist on this path (neutralizes the
 *      manifest's imperative priming).
 *   2. Scan the output with scanToollessOutput(); on a hit, fail honestly
 *      instead of returning/persisting the pseudo-call. Intent-free
 *      markup hygiene is handled by stripToolCallMarkupText.
 *
 * TODO: unify with src/lib/litt-intelligence/text-lane-guard.ts (open PR
 * #372) once both branches merge — same directive + scan shape, so the
 * merge is mechanical. This file deliberately does NOT use that name.
 */

import {
  findToolCallMarkup,
  stripEnvelopeMarkup,
  type ToolCallMarkupHit,
} from "./tool-call-markup";

/**
 * Explicit no-tools directive for tool-less lanes. Placed AFTER any
 * tool-manifest content so it wins over imperative priming like "you
 * MUST call the tool before answering".
 */
export const TOOLLESS_TEXT_LANE_DIRECTIVE = [
  "HARD RULE — READ FIRST: this reply is plain text chat. NO tools are",
  "attached to this request and NO tool call you emit will execute.",
  "Do NOT output <tool_call>, <invoke>, <dots_function_call>,",
  "```tool_call fences, or JSON tool-call envelopes — they can never run",
  "here and will be discarded.",
  "Ignore any earlier instruction telling you that you MUST call a tool",
  "before answering: it does not apply to this reply. If you need live",
  "data you cannot fetch here, say so honestly instead of pretending to",
  "call a tool.",
].join("\n");

/** Append the no-tools directive to a tool-less lane's prompt. */
export function buildToollessPrompt(basePrompt: string): string {
  return `${basePrompt}\n\n${TOOLLESS_TEXT_LANE_DIRECTIVE}`;
}

/**
 * Scan a tool-less lane's model output for tool-call markup carrying
 * invocation intent. Mirrors the messages V1 lane
 * (src/app/api/studio/conversations/[conversationId]/messages/route.ts):
 * a hit means the model tried to invoke a tool that can never execute on
 * this path — the caller must fail honestly, never return or persist the
 * pseudo-call. Returns the hit, or null for ordinary prose (including
 * prose that quotes markup as an example).
 */
export function scanToollessOutput(
  text: string,
  knownToolIds: ReadonlySet<string>,
): ToolCallMarkupHit | null {
  return findToolCallMarkup(text, knownToolIds);
}

export interface TextLaneHistoryEntry {
  role: "user" | "assistant";
  content: string;
}

/**
 * V1-lane history hygiene. A pseudo tool call persisted by an earlier
 * turn would re-prime a tool-less text lane to emit envelope markup
 * again mid-conversation. Strip envelope markup from assistant turns
 * before the history reaches the prompt. User turns pass through
 * untouched; inline-code-quoted examples are preserved by the stripper.
 * (The V2 native lane performs its own strip in
 * buildAssistantToolCallMessage — re-stripping is a no-op.)
 */
export function sanitizeTextLaneHistory(
  history: readonly TextLaneHistoryEntry[],
): TextLaneHistoryEntry[] {
  return history.map((entry) => ({
    role: entry.role,
    content:
      entry.role === "assistant"
        ? stripEnvelopeMarkup(entry.content)
        : entry.content,
  }));
}
