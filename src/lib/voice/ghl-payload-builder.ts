/**
 * Intent Classifier + GHL Payload Builder
 *
 * After a Vapi call ends, this module:
 *   1. Classifies the call intent from the transcript (website/ai/branding/music/support/other)
 *   2. Determines lead status (hot/warm/cold/not-lead)
 *   3. Decides if human follow-up is needed
 *   4. Generates a short call summary
 *   5. Assembles the normalized GHL payload
 *
 * Uses the "fast" LLM category (Groq) for speed — this runs async after the call ends.
 */

import { generateText } from "@/lib/llm";
import type { GHLCallPayload, IntentTag, LeadStatus } from "./ghl-types";

const INTENT_KEYWORDS: Record<IntentTag, string[]> = {
  "intent:website": ["website", "web design", "landing page", "web dev", "seo", "site", "wordpress", "webflow", "react", "next.js"],
  "intent:ai": ["ai", "ai agent", "chatbot", "automation", "llm", "gpt", "voice ai", "vapi", "ai assistant", "machine learning"],
  "intent:branding": ["branding", "logo", "brand identity", "design", "visual identity", "brand strategy", "style guide"],
  "intent:music": ["music", "song", "audio", "track", "beat", "album", "sound", "music production", "mixing"],
  "intent:support": ["support", "help", "bug", "issue", "problem", "error", "broken", "not working", "fix"],
  "intent:other": [],
};

const HOT_SIGNALS = ["ready to start", "budget", "deadline", "asap", "urgent", "ready to pay", "sign up", "subscribe", "hire"];
const WARM_SIGNALS = ["interested", "thinking about", "considering", "next week", "soon", "maybe", "learn more", "quote", "pricing"];
const COLD_SIGNALS = ["just browsing", "curious", "not sure", "maybe later", "just looking", "information"];
const NOT_LEAD_SIGNALS = ["wrong number", "spam", "sales call", "telemarketer", "not interested"];

function classifyIntentFromKeywords(transcript: string): IntentTag {
  const lower = transcript.toLowerCase();
  let best: IntentTag = "intent:other";
  let bestScore = 0;

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS) as [IntentTag, string[]][]) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }

  return best;
}

function classifyLeadStatus(transcript: string): LeadStatus {
  const lower = transcript.toLowerCase();

  for (const sig of NOT_LEAD_SIGNALS) {
    if (lower.includes(sig)) return "not-lead";
  }
  for (const sig of HOT_SIGNALS) {
    if (lower.includes(sig)) return "hot";
  }
  for (const sig of WARM_SIGNALS) {
    if (lower.includes(sig)) return "warm";
  }
  for (const sig of COLD_SIGNALS) {
    if (lower.includes(sig)) return "cold";
  }

  return "warm";
}

function detectFollowUpNeeded(transcript: string, leadStatus: LeadStatus): boolean {
  const lower = transcript.toLowerCase();
  if (leadStatus === "hot" || leadStatus === "warm") return true;
  if (lower.includes("follow up") || lower.includes("call back") || lower.includes("get back to me")) return true;
  if (lower.includes("appointment") || lower.includes("schedule") || lower.includes("meeting")) return true;
  return false;
}

/**
 * Use LLM to generate a short call summary + intent classification.
 * Falls back to keyword-based classification if LLM is unavailable.
 */
async function llmClassifyCall(
  transcript: string,
): Promise<{ intent: IntentTag; summary: string; leadStatus: LeadStatus; followUpNeeded: boolean }> {
  const fallbackIntent = classifyIntentFromKeywords(transcript);
  const fallbackLead = classifyLeadStatus(transcript);
  const fallbackFollowUp = detectFollowUpNeeded(transcript, fallbackLead);

  if (!transcript || transcript.length < 20) {
    return {
      intent: fallbackIntent,
      summary: "Call was too short to summarize.",
      leadStatus: fallbackLead,
      followUpNeeded: fallbackFollowUp,
    };
  }

  const systemPrompt = [
    "You are a call analysis assistant. Analyze the phone call transcript and return a JSON object with:",
    '{ "intent": "website|ai|branding|music|support|other", "summary": "1-2 sentence summary", "leadStatus": "hot|warm|cold|not-lead", "followUpNeeded": true|false }',
    "",
    "Intent categories:",
    "- website: caller wants a website, web design, landing page, SEO",
    "- ai: caller wants AI agents, chatbots, automation, voice AI",
    "- branding: caller wants branding, logo, visual identity",
    "- music: caller wants music production, audio, tracks",
    "- support: caller needs help, has a bug or issue",
    "- other: doesn't fit above categories",
    "",
    "Lead status:",
    "- hot: ready to start, has budget, urgent deadline",
    "- warm: interested, exploring, wants more info",
    "- cold: just curious, browsing, no urgency",
    "- not-lead: wrong number, spam, telemarketer",
    "",
    "followUpNeeded: true if the caller explicitly asked for a callback, appointment, or if lead is hot/warm.",
    "",
    "Return ONLY the JSON object, no other text.",
  ].join("\n");

  const userPrompt = `Transcript:\n${transcript.slice(0, 3000)}\n\nAnalyze this call and return the JSON object:`;

  try {
    const result = await generateText(
      userPrompt,
      { task: "chat", category: "fast", maxTokens: 200, timeoutMs: 10_000 },
      systemPrompt,
    );

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const parsed = JSON.parse(jsonMatch[0]) as {
      intent?: string;
      summary?: string;
      leadStatus?: string;
      followUpNeeded?: boolean;
    };

    const intentMap: Record<string, IntentTag> = {
      website: "intent:website",
      ai: "intent:ai",
      branding: "intent:branding",
      music: "intent:music",
      support: "intent:support",
      other: "intent:other",
    };

    const leadMap: Record<string, LeadStatus> = {
      hot: "hot",
      warm: "warm",
      cold: "cold",
      "not-lead": "not-lead",
    };

    return {
      intent: intentMap[parsed.intent ?? "other"] ?? fallbackIntent,
      summary: parsed.summary?.slice(0, 500) ?? "Call analyzed.",
      leadStatus: leadMap[parsed.leadStatus ?? ""] ?? fallbackLead,
      followUpNeeded: parsed.followUpNeeded ?? fallbackFollowUp,
    };
  } catch {
    return {
      intent: fallbackIntent,
      summary: transcript.slice(0, 200) + (transcript.length > 200 ? "..." : ""),
      leadStatus: fallbackLead,
      followUpNeeded: fallbackFollowUp,
    };
  }
}

/**
 * Build a normalized GHL call payload from Vapi end-of-call data.
 */
export async function buildGHLCallPayload(params: {
  callId: string;
  to: string;
  from: string;
  callerName: string | null;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: string;
  transcript: string;
  isKnownUser: boolean;
  userId: string | null;
  projectId: string | null;
  projectName: string | null;
  conversationId: string | null;
}): Promise<GHLCallPayload> {
  const { intent, summary, leadStatus, followUpNeeded } = await llmClassifyCall(params.transcript);

  return {
    callId: params.callId,
    to: params.to,
    from: params.from,
    callerName: params.callerName,
    startedAt: params.startedAt,
    endedAt: params.endedAt,
    durationMs: params.durationMs,
    status: params.status,
    intent,
    leadStatus,
    followUpNeeded,
    summary,
    isKnownUser: params.isKnownUser,
    userId: params.userId,
    projectId: params.projectId,
    projectName: params.projectName,
    transcript: params.transcript.slice(0, 5000) || null,
    conversationId: params.conversationId,
  };
}
