/**
 * Bounded conversation context for a phone call.
 *
 * The recent turns remain ordered dialogue. Earlier user/assistant exchanges
 * are surfaced as explicitly labelled excerpts, not mixed into the recent
 * dialogue as if they happened immediately before the current question.
 *
 * This is deterministic and makes no additional LLM/API calls. It cannot
 * replace a real running summary or recover messages not stored in the DB.
 */
export type VoiceHistoryMessage = { role: "user" | "assistant"; content: string };

const RECENT_ENTRIES = 8; // individual messages, generally four exchanges
const MAX_EARLIER_PAIRS = 3;
const MAX_EXCERPT_CHARS = 260;
const STOP_WORDS = new Set([
  "about", "again", "also", "and", "are", "can", "could", "did", "does",
  "for", "from", "have", "how", "into", "its", "just", "like", "more",
  "now", "our", "please", "said", "say", "tell", "that", "the", "their",
  "them", "there", "these", "they", "this", "those", "was", "were",
  "what", "when", "where", "which", "who", "why", "will", "with", "would",
  "you", "your",
]);

function keywords(value: string): Set<string> {
  return new Set(
    (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
      .map((word) => word.endsWith("s") && word.length > 4 ? word.slice(0, -1) : word)
      .filter((word) => word.length >= 3 && !STOP_WORDS.has(word)),
  );
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_EXCERPT_CHARS
    ? flat.slice(0, MAX_EXCERPT_CHARS - 1).trimEnd() + "…"
    : flat;
}

export function buildVoiceConversationContext(
  completedMessages: VoiceHistoryMessage[],
  currentMessage: string,
): { recent: VoiceHistoryMessage[]; earlierContext: string } {
  const recent = completedMessages.slice(-RECENT_ENTRIES);
  const earlier = completedMessages.slice(0, Math.max(0, completedMessages.length - RECENT_ENTRIES));
  if (earlier.length === 0) return { recent, earlierContext: "" };

  // Keep one early caller goal, one recent older exchange, and up to two
  // topically relevant earlier exchanges. Each chosen pair has a hard length
  // cap to avoid unbounded prompts on long calls.
  const candidates = earlier.flatMap((entry, index) =>
    entry.role === "user" && entry.content.trim()
      ? [{ index, entry, reply: earlier[index + 1]?.role === "assistant" ? earlier[index + 1] : null }]
      : [],
  );
  if (candidates.length === 0) return { recent, earlierContext: "" };

  const firstGoal = candidates.find((c) => c.entry.content.trim().length >= 12) ?? candidates[0];
  const latestOlder = candidates[candidates.length - 1];
  const queryWords = keywords(currentMessage);
  const ranked = candidates
    .map((c) => ({
      ...c,
      relevance: [...keywords(c.entry.content)].filter((term) => queryWords.has(term)).length,
    }))
    .filter((c) => c.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance || b.index - a.index);

  const chosen = new Map<number, typeof candidates[number]>();
  chosen.set(firstGoal.index, firstGoal);
  for (const candidate of ranked) {
    if (chosen.size >= MAX_EARLIER_PAIRS - 1) break;
    chosen.set(candidate.index, candidate);
  }
  if (chosen.size < MAX_EARLIER_PAIRS) chosen.set(latestOlder.index, latestOlder);

  const excerpts = [...chosen.values()]
    .sort((a, b) => a.index - b.index)
    .map((c) => {
      const said = `Earlier caller: "${excerpt(c.entry.content)}"`;
      return c.reply ? `${said}\nEarlier LiTT: "${excerpt(c.reply.content)}"` : said;
    });

  return {
    recent,
    earlierContext: excerpts.join("\n"),
  };
}
