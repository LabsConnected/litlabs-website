import type { LLMMessage, ToolDefinition } from "./llm-tool-calling";

const charsToTokens = (chars: number): number =>
  Math.max(1, Math.ceil(Math.max(0, chars) / 4));

export function instrumentInputBudget(
  systemPrompt: string,
  messages: LLMMessage[],
  toolDefs: ToolDefinition[],
) {
  const systemTokens = charsToTokens(systemPrompt.length);
  const toolTokens = charsToTokens(JSON.stringify(toolDefs).length);
  const messageChars = messages.reduce(
    (sum, m) => sum + (m.content?.length ?? 0) +
      (m.tool_calls?.reduce((n, tc) => n + (tc.function.arguments?.length ?? 0), 0) ?? 0),
    0,
  );
  const messageTokens = charsToTokens(messageChars);
  return {
    systemTokens, toolTokens, messageTokens,
    totalTokens: systemTokens + toolTokens + messageTokens,
    messageCount: messages.length,
  };
}

type MessageGroup = { start: number; end: number };

/**
 * Treat an assistant tool call and ALL its immediately following tool results
 * as one indivisible group. Dropping only the assistant creates orphaned tool
 * results and invalid OpenAI-compatible transcripts.
 */
function groupMessages(messages: LLMMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;
  while (i < messages.length) {
    const start = i;
    const m = messages[i++];
    if (m.role === "assistant" && m.tool_calls?.length) {
      while (i < messages.length && messages[i].role === "tool") i++;
    }
    groups.push({ start, end: i });
  }
  return groups;
}

/**
 * Trim complete message groups while keeping the ORIGINAL current request,
 * the most recent user turn (e.g. a continuation nudge), and the latest
 * assistant/tool exchange. A trailing tool result is not the user request.
 */
export function compactBuildInputs(
  systemPrompt: string,
  messages: LLMMessage[],
  toolDefs: ToolDefinition[],
  maxInputTokens = 6000,
  currentRequestIndex?: number,
) {
  const budget = instrumentInputBudget(systemPrompt, messages, toolDefs);
  const exceedsFixedBudget = budget.systemTokens + budget.toolTokens >= maxInputTokens;
  if (budget.totalTokens <= maxInputTokens) {
    return { systemPrompt, messages, compacted: false, budget, exceedsFixedBudget };
  }

  const groups = groupMessages(messages);
  const lastUserIndex = messages.findLastIndex((m) => m.role === "user");
  const requestIndex = currentRequestIndex !== undefined &&
      currentRequestIndex >= 0 &&
      currentRequestIndex < messages.length &&
      messages[currentRequestIndex].role === "user"
    ? currentRequestIndex
    : lastUserIndex;

  const protectedGroups = new Set<number>();
  for (let g = 0; g < groups.length; g++) {
    const { start, end } = groups[g];
    if (
      (start <= requestIndex && requestIndex < end) ||
      (start <= lastUserIndex && lastUserIndex < end) ||
      g === groups.length - 1
    ) {
      protectedGroups.add(g);
    }
  }

  const retained = new Set(groups.map((_, i) => i));
  const materialize = (): LLMMessage[] =>
    groups.flatMap((g, i) => retained.has(i) ? messages.slice(g.start, g.end) : []);
  for (let g = 0; g < groups.length; g++) {
    if (protectedGroups.has(g)) continue;
    if (instrumentInputBudget(systemPrompt, materialize(), toolDefs).totalTokens <= maxInputTokens) break;
    retained.delete(g);
  }

  const compactedMessages = materialize();
  return {
    systemPrompt,
    messages: compactedMessages,
    compacted: compactedMessages.length < messages.length,
    budget: instrumentInputBudget(systemPrompt, compactedMessages, toolDefs),
    exceedsFixedBudget,
  };
}
