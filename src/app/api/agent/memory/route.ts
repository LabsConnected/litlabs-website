import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { recallPersonaMemory, savePersonaMemory } from "@/lib/agent-memory";
import type { PersonaId } from "@/lib/persona";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const personaId = searchParams.get("persona_id") as PersonaId | null;
  const limit = parseInt(searchParams.get("limit") ?? "5", 10);

  if (!personaId || (personaId !== "littcode" && personaId !== "littlebit")) {
    return NextResponse.json({ error: "Invalid persona_id" }, { status: 400 });
  }

  try {
    const memories = await recallPersonaMemory(userId, personaId, Number.isNaN(limit) ? 5 : limit);
    return NextResponse.json({ memories });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Memory recall failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      personaId?: PersonaId;
      content?: string;
      source?: string;
    };

    if (!body.personaId || (body.personaId !== "littcode" && body.personaId !== "littlebit")) {
      return NextResponse.json({ error: "Invalid personaId" }, { status: 400 });
    }
    if (!body.content || typeof body.content !== "string") {
      return NextResponse.json({ error: "Missing content" }, { status: 400 });
    }

    const memory = await savePersonaMemory(userId, body.personaId, body.content, body.source);
    return NextResponse.json({ memory });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Memory save failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
