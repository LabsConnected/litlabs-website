import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Supermemory } from "supermemory";

function getSupermemory() {
  const key = process.env.SUPERMEMORY_API_KEY;
  if (!key) throw new Error("SUPERMEMORY_API_KEY is not configured");
  return new Supermemory({ apiKey: key });
}

function getContainerTag(userId: string, scope?: string) {
  return scope ? `${userId}:${scope}` : userId;
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
    const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);

    const results = await getSupermemory().search.memories({
      q,
      containerTag: getContainerTag(userId, scope),
      limit,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
