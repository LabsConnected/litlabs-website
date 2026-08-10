/**
 * Conversational Turn Resolver
 *
 * Expands ambiguous references in user messages using recent conversation
 * context. When a user says "fix that", "no the other one", "why aint it
 * the same as text", the resolver uses prior messages to produce a more
 * complete, self-contained message for the agent loop.
 *
 * This runs BEFORE the agent loop, as a pre-processing step.
 */

import "server-only";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TurnResolverResult {
  /** The expanded/clarified message to feed to the agent loop */
  resolved: string;
  /** The original raw message */
  raw: string;
  /** Confidence score 0-1. Below threshold, suggest clarification. */
  confidence: number;
  /** If confidence is low, suggested clarifications to offer the user */
  clarifications?: string[];
}

// ─── Reference patterns that indicate the message needs resolution ───

const AMBIGUOUS_PATTERNS = [
  /\bit\b/i,
  /\bthat\b/i,
  /\bthis\b/i,
  /\bthe same (thing|one|as)\b/i,
  /\bthe other (one|thing)\b/i,
  /\bthe one before\b/i,
  /\bwhy\b/i,
  /\bhe\b/i,
  /\bshe\b/i,
  /\bthey\b/i,
  /\bthat shit\b/i,
  /\bthis shit\b/i,
  /\bmy shit\b/i,
  /\bno\b/i,
  /\bnah\b/i,
  /\bdont\b/i,
  /\bdon't\b/i,
  /\bnot that\b/i,
  /\bagain\b/i,
  /\bsame problem\b/i,
  /\bas before\b/i,
];

function isAmbiguous(message: string): boolean {
  const trimmed = message.trim();
  // Short messages are more likely to be references
  if (trimmed.length < 80) {
    return AMBIGUOUS_PATTERNS.some((p) => p.test(trimmed));
  }
  // Longer messages with explicit references
  return /\b(it|that|this|the same|the other)\b/i.test(trimmed) && trimmed.length < 200;
}

/**
 * Extract the most recent substantive topic from conversation history.
 * Looks at the last few user messages and assistant responses to identify
 * what "it" or "that" likely refers to.
 */
function extractRecentTopic(history: ConversationTurn[]): string | null {
  // Look at last 6 turns max
  const recent = history.slice(-6);
  if (recent.length === 0) return null;

  // Find the last user message with substantive content (before the current one)
  const lastUserMessages = recent
    .filter((t) => t.role === "user")
    .map((t) => t.content.trim())
    .filter((c) => c.length > 5);

  if (lastUserMessages.length === 0) return null;

  // The most recent substantive user message is the most likely referent
  const lastUser = lastUserMessages[lastUserMessages.length - 1];

  // If the last assistant message contains a question or suggestion,
  // the user's "it" or "that" likely refers to that
  const lastAssistant = [...recent].reverse().find((t) => t.role === "assistant");
  if (lastAssistant) {
    const assistantContent = lastAssistant.content;
    // Check if assistant mentioned specific things (files, errors, suggestions)
    const fileMention = assistantContent.match(/`([^`]+\.[a-z]+)`/);
    if (fileMention) return `the file \`${fileMention[1]}\``;

    const errorMention = assistantContent.match(/(?:error|problem|issue)[:\s]+([^\n.]{10,80})/i);
    if (errorMention) return `the error: ${errorMention[1]}`;
  }

  return lastUser;
}

/**
 * Build a resolved message by combining the raw message with context.
 */
function resolveMessage(
  raw: string,
  history: ConversationTurn[],
): TurnResolverResult {
  const trimmed = raw.trim();

  // Not ambiguous — return as-is with high confidence
  if (!isAmbiguous(trimmed)) {
    return { resolved: trimmed, raw: trimmed, confidence: 1.0 };
  }

  const topic = extractRecentTopic(history);

  if (!topic) {
    // Ambiguous but no history to resolve from
    return {
      resolved: trimmed,
      raw: trimmed,
      confidence: 0.3,
      clarifications: undefined,
    };
  }

  // Build the expanded message
  // Different expansion strategies based on the type of ambiguity

  // "why" questions — expand to include the topic being questioned
  if (/^why\b/i.test(trimmed) && trimmed.length < 60) {
    const expanded = `${trimmed} — in the context of: ${topic}`;
    return { resolved: expanded, raw: trimmed, confidence: 0.85 };
  }

  // "no" / "nah" / "not that" — user is correcting a previous suggestion
  if (/^(no|nah|not that|nope)\b/i.test(trimmed)) {
    const expanded = `Regarding ${topic}: ${trimmed}. Please reconsider and try a different approach.`;
    return { resolved: expanded, raw: trimmed, confidence: 0.75 };
  }

  // "same problem" / "as before" / "again" — recurring issue
  if (/(same problem|as before|again|same thing)/i.test(trimmed)) {
    const expanded = `I'm experiencing the same issue as before with: ${topic}. ${trimmed}`;
    return { resolved: expanded, raw: trimmed, confidence: 0.88 };
  }

  // "fix that" / "fix that shit" / "fix it" — reference to previous topic
  if (/(fix|repair|resolve|handle)\b.*(it|that|this|that shit|this shit)/i.test(trimmed)) {
    const expanded = `${trimmed} — referring to: ${topic}`;
    return { resolved: expanded, raw: trimmed, confidence: 0.82 };
  }

  // "make this better" / "make it better" — vague improvement request
  if (/make\b.*(it|this|that)\b.*(better|good|nice|work)/i.test(trimmed)) {
    const expanded = `${trimmed} — referring to: ${topic}`;
    return { resolved: expanded, raw: trimmed, confidence: 0.80 };
  }

  // "dont" / "don't" — correction
  if (/^(dont|don't)\b/i.test(trimmed)) {
    const expanded = `Regarding ${topic}: ${trimmed}.`;
    return { resolved: expanded, raw: trimmed, confidence: 0.78 };
  }

  // Generic "it" / "that" / "this" references
  if (/\b(it|that|this)\b/i.test(trimmed) && trimmed.length < 80) {
    const expanded = `${trimmed} — referring to: ${topic}`;
    return { resolved: expanded, raw: trimmed, confidence: 0.72 };
  }

  // Fallback: prepend context
  const expanded = `[Context: ${topic.slice(0, 100)}] ${trimmed}`;
  return { resolved: expanded, raw: trimmed, confidence: 0.65 };
}

/**
 * Main entry point. Resolves ambiguous references in the user's message
 * using conversation history.
 *
 * @param message The raw user message
 * @param history Prior conversation turns (oldest first)
 * @returns Resolved message with confidence score
 */
export function resolveTurn(
  message: string,
  history: ConversationTurn[],
): TurnResolverResult {
  return resolveMessage(message, history);
}
