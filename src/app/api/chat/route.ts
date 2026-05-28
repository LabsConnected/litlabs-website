import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/chat — direct AI chat via OpenRouter (bypasses n8n).
 *
 * Primary: OpenRouter (fast, reliable, configured on Vercel)
 * Fallback: proxy to Termux API via cloudflared tunnel
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-001";

// Fallback: Termux API via cloudflared tunnel (n8n or direct Gemini)
const TERMUX_API = process.env.TERMUX_API_URL || "https://api.litlabs.net";

async function chatOpenRouter(message: string) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "HTTP-Referer": "https://litlabs.net",
      "X-Title": "LitLabs",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [{ role: "user", content: message }],
      max_tokens: 1024,
      temperature: 0.8,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text.substring(0, 200)}`);
  }

  const data = await res.json();
  return {
    reply: data?.choices?.[0]?.message?.content || "No response",
    model: OPENROUTER_MODEL,
  };
}

async function chatTermuxFallback(message: string) {
  const res = await fetch(`${TERMUX_API}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      agent: "default",
      sessionId: "visitor_" + Math.random().toString(36).slice(2, 8),
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Termux API error: ${res.status}`);
  return await res.json();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "message required" },
        { status: 400 }
      );
    }

    // ── Primary: OpenRouter direct ─────────────────────────
    if (OPENROUTER_API_KEY) {
      try {
        const result = await chatOpenRouter(message);
        return NextResponse.json({
          source: "openrouter",
          ...result,
        });
      } catch (err) {
        // Log but don't expose key errors
        console.error("OpenRouter failed:", (err as Error).message);
      }
    }

    // ── Fallback: Termux API (n8n tunnel) ─────────────────
    try {
      const result = await chatTermuxFallback(message);
      return NextResponse.json({
        source: "termux",
        ...result,
      });
    } catch (err) {
      console.error("Termux fallback failed:", (err as Error).message);
    }

    return NextResponse.json(
      {
        error: "Chat unavailable",
        detail: "All AI backends are unreachable",
      },
      { status: 503 }
    );
  } catch (err) {
    const msg = (err as Error)?.message || "Unknown";
    return NextResponse.json(
      { error: `Chat failed: ${msg}` },
      { status: 502 }
    );
  }
}
