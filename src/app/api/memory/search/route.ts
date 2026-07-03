import { Supermemory } from "supermemory";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const sm = new Supermemory({
  apiKey: process.env.SUPERMEMORY_API_KEY!,
});

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    const uid = userId || "anonymous";

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const limit = Number(searchParams.get("limit")) || 20;

    const results = await sm.search.memories({
      q,
      containerTag: uid,
      limit,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
