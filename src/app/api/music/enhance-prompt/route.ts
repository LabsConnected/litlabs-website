import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateJSON } from "@/lib/llm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const EnhanceSchema = z.object({
  prompt: z.string().min(1).max(500),
});

interface EnhanceResponse {
  original: string;
  enhanced: string;
  genre: string;
  subgenre: string;
  tempo: string;
  key: string;
  drums: string;
  bass: string;
  instrumentation: string;
  vocalCharacter: string;
  hookDirection: string;
  arrangement: string;
  productionTexture: string;
  energyCurve: string;
}

/**
 * POST /api/music/enhance-prompt
 *
 * Uses the LiTT LLM to produce a structured enhancement of a music prompt.
 * Replaces the old random suffix appender.
 *
 * Returns ORIGINAL and DIRECTED versions so the user can compare
 * before applying.
 */
async function handler(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = EnhanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid request" },
      { status: 400 },
    );
  }

  const { prompt } = parsed.data;

  const systemPrompt = `You are LiTT, an expert music producer. Enhance the user's music prompt with specific, structured production details.

Return ONLY valid JSON with this exact shape:
{
  "original": "the user's original prompt unchanged",
  "enhanced": "a richer, more detailed version of the prompt with production cues, sonic direction, and arrangement notes. 2-4 sentences. Under 400 characters.",
  "genre": "primary genre",
  "subgenre": "subgenre or fusion",
  "tempo": "BPM range or specific value",
  "key": "suggested musical key",
  "drums": "drum style description",
  "bass": "bass style description",
  "instrumentation": "key instruments and sounds",
  "vocalCharacter": "vocal style direction",
  "hookDirection": "how the hook/melody should feel",
  "arrangement": "arrangement approach",
  "productionTexture": "mix and production aesthetic",
  "energyCurve": "how energy changes through the song"
}

Rules:
- Be specific and actionable, not generic
- Reference production techniques generically (not specific artist names)
- Keep the enhanced prompt under 400 characters
- Never suggest imitating specific artists or copyrighted material`;

  const userPrompt = `Enhance this music prompt: "${prompt}"`;

  try {
    const result = await generateJSON<EnhanceResponse>(
      userPrompt,
      { task: "creative", maxTokens: 2048 },
      systemPrompt,
    );
    result.original = prompt;
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Enhancement failed";
    console.error(`[music:enhance] error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = handler;
