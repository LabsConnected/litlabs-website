import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Simple single-turn wrapper — accepts { message, systemPrompt, agentId }
// Returns { response: string }
export async function POST(req: NextRequest) {
  try {
    const { message, systemPrompt } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY not configured" }, { status: 500 });
    }

    const body = {
      system_instruction: systemPrompt
        ? { parts: [{ text: systemPrompt }] }
        : undefined,
      contents: [{ role: "user", parts: [{ text: message }] }],
      generationConfig: {
        temperature: 0.9,
        topP: 0.95,
        maxOutputTokens: 1024,
      },
    };

    const model = "gemini-2.0-flash";
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.text();
      console.error("Gemini API error:", err);
      return NextResponse.json({ error: "Gemini API error" }, { status: 502 });
    }

    const data = await geminiRes.json();
    const response = data.candidates?.[0]?.content?.parts?.[0]?.text || "I'm thinking...";
    return NextResponse.json({ response });
  } catch (err) {
    console.error("Gemini route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
