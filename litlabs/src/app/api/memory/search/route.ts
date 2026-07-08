import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSupermemory } from "@/lib/api/supermemory";
import { errorMessage } from "@/lib/api/response";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    const uid = userId || "anonymous";

    const { searchParams } = new URL(req.url);
    const q = searchParams.get("q") || "";
    const limit = Number(searchParams.get("limit")) || 20;

    const results = await getSupermemory().search.memories({
      q,
      containerTag: uid,
      limit,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = errorMessage(error, "Search failed");
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
