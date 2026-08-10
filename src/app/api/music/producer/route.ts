import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateJSON } from "@/lib/llm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ProducerSchema = z.object({
  prompt: z.string().min(1).max(500),
  currentSettings: z.object({
    mood: z.string().optional(),
    bpm: z.number().optional(),
    energy: z.number().optional(),
    instrumental: z.boolean().optional(),
    vocalType: z.string().optional(),
    styles: z.string().optional(),
    negativeStyles: z.string().optional(),
  }).optional(),
});

interface ProducerResponse {
  enhancedPrompt: string;
  styles: string[];
  avoidStyles: string[];
  bpm: number;
  key: string;
  energy: number;
  vocalDirection: string;
  songStructure: string[];
  producerNote: string;
}

/**
 * POST /api/music/producer
 *
 * Uses the LiTT LLM to generate structured music production changes.
 * Replaces the old canned keyword-matching producer responses.
 *
 * Returns a structured production plan that the client can preview
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

  const parsed = ProducerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid request" },
      { status: 400 },
    );
  }

  const { prompt, currentSettings } = parsed.data;

  const systemPrompt = `You are LiTT, an expert AI music producer and songwriter. You help artists craft their sound with specific, actionable production direction.

Given a user's description and their current settings, return a JSON object with structured production recommendations.

Return ONLY valid JSON with this exact shape:
{
  "enhancedPrompt": "A richly detailed version of the user's prompt with production cues, genre specifics, and sonic direction. 2-3 sentences max.",
  "styles": ["positive style tags - genre, mood, instrumentation, production techniques"],
  "avoidStyles": ["things to avoid"],
  "bpm": number between 60-200,
  "key": "musical key like 'C Minor' or 'auto'",
  "energy": number between 1-10,
  "vocalDirection": "description of vocal style and delivery",
  "songStructure": ["intro", "verse", "chorus", "verse", "chorus", "bridge", "outro"],
  "producerNote": "1-2 sentence explanation of your creative choices"
}

Rules:
- Be specific: "distorted 808s" not "good bass"
- Match the energy and mood the user wants
- If the user says "harder", increase energy and add aggressive styles
- If the user says "catchier", simplify and focus on hook elements
- If the user says "emotional", reduce energy and add intimate styles
- Never suggest copying or imitating specific artists
- Keep enhancedPrompt under 300 characters`;

  const userPrompt = `User request: "${prompt}"

Current settings: ${JSON.stringify(currentSettings || {})}`;

  try {
    const result = await generateJSON<ProducerResponse>(
      userPrompt,
      { task: "json", maxTokens: 2048 },
      systemPrompt,
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Producer failed";
    console.error(`[music:producer] error: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const POST = handler;
