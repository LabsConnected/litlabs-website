// LiT-Tip scan endpoint — real-time prompt health and cost awareness
import { NextRequest, NextResponse } from "next/server";
import { scanPrompt, suggestPromptRewrite } from "@/lib/lit-tip";
import { withRateLimit } from "@/lib/rate-limiter";

async function handler(req: NextRequest) {
  if (req.method !== "POST") {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const prompt = typeof body.prompt === "string" ? body.prompt : "";
    const agent = typeof body.agent === "string" ? body.agent : "director";
    const model = typeof body.model === "string" ? body.model : "gemini-2.5-flash";

    const result = scanPrompt(prompt, agent, model);
    const rewrite = suggestPromptRewrite(prompt, result.missing);

    return NextResponse.json({
      ok: true,
      result: {
        ...result,
        rewrite: rewrite !== prompt ? rewrite : undefined,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Scan failed" },
      { status: 500 },
    );
  }
}

export const POST = withRateLimit(handler, 60, 60);
