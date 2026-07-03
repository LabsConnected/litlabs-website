import { Supermemory } from "supermemory";
import { NextRequest, NextResponse } from "next/server";

const sm = new Supermemory({
  apiKey: process.env.SUPERMEMORY_API_KEY!,
});

export async function POST(req: NextRequest) {
  try {
    const { content, userId, metadata } = await req.json();

    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const result = await sm.add({
      content,
      containerTag: userId || "default",
      metadata,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to add memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || "";
    const userId = searchParams.get("userId") || "default";
    const limit = Number(searchParams.get("limit")) || 5;

    const results = await sm.search.memories({
      q: query,
      containerTag: userId,
      limit,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to search memories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { id, userId, content } = await req.json();

    if (!id && !content) {
      return NextResponse.json({ error: "id or content is required" }, { status: 400 });
    }

    const result = await sm.memories.forget({
      containerTag: userId || "default",
      id,
      content,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to forget memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, content, userId, newContent } = await req.json();

    if ((!id && !content) || !newContent) {
      return NextResponse.json(
        { error: "id or content and newContent are required" },
        { status: 400 }
      );
    }

    const result = await sm.memories.updateMemory({
      containerTag: userId || "default",
      id,
      content,
      newContent,
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
