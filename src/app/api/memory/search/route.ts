import { Supermemory } from "supermemory";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) {
    throw new Error("SUPERMEMORY_API_KEY is not configured");
  }
  return new Supermemory({ apiKey: key });
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const scope = searchParams.get("scope") || undefined;
    const limit = Number(searchParams.get("limit")) || 20;

    const results = await getSupermemory().search.memories({
      q,
      containerTag: scope ? `${userId}:${scope}` : userId,
      limit,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
