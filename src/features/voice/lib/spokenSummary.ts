/**
 * Spoken-summary helpers for LiTT voice TTS.
 *
 * The chat reply shown on screen is written text; reading it aloud verbatim
 * sounds robotic. The TTS pipeline speaks the short spoken-style form these
 * helpers produce instead — the full text stays on screen, only the spoken
 * form changes.
 */

/** Replies at or under this length are spoken as-is (no LLM call, no latency). */
export const SPOKEN_DIRECT_MAX_CHARS = 220;
/** Hard cap for the deterministic client-side fallback summary. */
export const SPOKEN_FALLBACK_MAX_CHARS = 280;
/** Hard cap (words) for the LLM-generated spoken summary. */
export const SPOKEN_SUMMARY_MAX_WORDS = 40;

export type SpokenAgentId = "litt" | "spark";

/**
 * Deterministic fallback: first 1–2 sentences of the text, capped at
 * SPOKEN_FALLBACK_MAX_CHARS. Used when the /api/voice/speak-summary
 * endpoint is unreachable — voice keeps working with zero LLM cost.
 */
export function truncateToSpokenFallback(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return "";
  if (clean.length <= SPOKEN_FALLBACK_MAX_CHARS) return clean;

  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let out = "";
  for (const sentence of sentences) {
    const candidate = (out ? `${out} ` : "") + sentence.trim();
    if (candidate.length > SPOKEN_FALLBACK_MAX_CHARS) break;
    out = candidate;
    // Stop after two sentences — this is a spoken summary, not a reading.
    if ((out.match(/[.!?]/g) ?? []).length >= 2) break;
  }
  if (!out) {
    // No sentence boundary under the cap (e.g. one giant run-on) — hard cut.
    out = clean.slice(0, SPOKEN_FALLBACK_MAX_CHARS).trim();
  }
  return out;
}

/**
 * System prompt for the /api/voice/speak-summary endpoint (gpt-4o-mini).
 * Produces 1–2 conversational spoken sentences from a full chat reply.
 */
export function buildSpokenSummarySystemPrompt(agentId: SpokenAgentId): string {
  const persona =
    agentId === "spark"
      ? "Spark, LiTT's playful creative companion: bright, warm, expressive."
      : "LiTT, the lead AI copilot: deep, calm, precise, mid-thirties energy.";
  return `You are ${persona}

Rewrite the assistant reply below into what you would SAY aloud in a voice conversation: 1–2 short conversational sentences, max ${SPOKEN_SUMMARY_MAX_WORDS} words.
Rules:
- Plain spoken English only. No markdown, no code, no URLs, no file paths, no lists, no symbols.
- Use contractions. Sound natural, not read aloud.
- Never invent facts not present in the reply. If the reply asks the user a question, keep it a question.
- Output ONLY the spoken sentences, nothing else.`;
}

/** User content for the summary call — capped so a giant reply can't blow up the bill. */
export function buildSpokenSummaryUserContent(text: string): string {
  return text.slice(0, 4000);
}

/**
 * Ask the server for a spoken-style summary of a long reply.
 * Falls back to the deterministic client-side truncation on any failure.
 */
export async function fetchSpokenSummary(
  text: string,
  agentId: string,
): Promise<string> {
  try {
    const res = await fetch("/api/voice/speak-summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, agentId }),
    });
    if (res.ok) {
      const data = (await res.json()) as { spoken?: unknown };
      if (typeof data?.spoken === "string" && data.spoken.trim()) {
        return data.spoken.trim();
      }
    }
  } catch {
    // Network or server failure — fall through to the free fallback.
  }
  return truncateToSpokenFallback(text);
}
