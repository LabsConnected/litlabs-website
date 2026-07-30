// src/lib/music/safety-filter.ts
// Prompt + lyrics safety filtering. Runs BEFORE any LBC is reserved, so
// rejected prompts cost the user nothing.

export interface SafetyCheck {
  allowed: boolean;
  reason?: string;
  rewrittenPrompt?: string;
}

const BLOCKED_PATTERNS = [
  /use the (exact )?voice of/i,
  /sound exactly like/i,
  /imitate (artist|singer|band)/i,
  /copy (the )?style of/i,
  /clone (the )?voice of/i,
  /replicate (the )?voice of/i,
  /unauthorized recording/i,
  /stolen (audio|vocals|lyrics)/i,
];

const COPYRIGHTED_LYRICS = [
  "imagine all the people",
  "we are the champions",
  "like a rolling stone",
  "smells like teen spirit",
  "bohemian rhapsody",
];

export function checkPromptSafety(prompt: string, lyrics?: string): SafetyCheck {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(prompt)) {
      return {
        allowed: false,
        reason:
          "Requests that imitate specific artists or voices are not allowed. Please describe the style, mood, or genre instead.",
        rewrittenPrompt: rewritePrompt(prompt),
      };
    }
  }

  if (lyrics) {
    const lowerLyrics = lyrics.toLowerCase();
    for (const lyric of COPYRIGHTED_LYRICS) {
      if (lowerLyrics.includes(lyric)) {
        return {
          allowed: false,
          reason:
            "The provided lyrics appear to contain copyrighted material. Please provide original lyrics.",
        };
      }
    }
  }

  const celebrityPattern =
    /(celebrity|famous|well-known|popular) (singer|artist|musician|voice)/i;
  if (celebrityPattern.test(prompt)) {
    return {
      allowed: false,
      reason:
        "Please describe the vocal style rather than requesting a specific person.",
      rewrittenPrompt: rewritePrompt(prompt),
    };
  }

  return { allowed: true };
}

function rewritePrompt(prompt: string): string {
  return prompt
    .replace(/sound(s)? (exactly )?like /gi, "in the style of ")
    .replace(/use the (exact )?voice of /gi, "with vocals similar to ")
    .replace(/imitate /gi, "inspired by ")
    .replace(/clone /gi, "reminiscent of ");
}

export function checkExplicitContent(
  prompt: string,
  lyrics?: string,
): { explicit: boolean; confidence: number } {
  const explicitWords = [
    "explicit",
    "nsfw",
    "adult",
    "sex",
    "drugs",
    "violence",
    "kill",
    "death",
  ];
  const text = `${prompt} ${lyrics || ""}`.toLowerCase();

  let matches = 0;
  for (const word of explicitWords) {
    if (text.includes(word)) matches++;
  }

  return {
    explicit: matches > 0,
    confidence: Math.min(matches / 3, 1),
  };
}
