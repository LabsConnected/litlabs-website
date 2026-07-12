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

function getContainerTag(userId: string | null, scope?: string) {
  if (!userId) return "anonymous";
  // Tenant-safe container. Scope allows profile/agent/project/conversation buckets.
  return scope ? `${userId}:${scope}` : userId;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { content, scope, metadata } = await req.json();

    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const containerTag = getContainerTag(userId, scope);
    const result = await getSupermemory().add({
      content,
      containerTag,
      metadata: { ...metadata, ownerId: userId, scope: scope || "profile" },
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to add memory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const query = searchParams.get("q") || "";
    const scope = searchParams.get("scope") || undefined;
    const limit = Number(searchParams.get("limit")) || 5;

    const results = await getSupermemory().search.memories({
      q: query,
      containerTag: getContainerTag(userId, scope),
      limit,
    });

    return NextResponse.json(results);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to search memories";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, content, scope } = await req.json();

    if (!id && !content) {
      return NextResponse.json({ error: "id or content is required" }, { status: 400 });
    }

    const result = await getSupermemory().memories.forget({
      containerTag: getContainerTag(userId, scope),
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
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, content, newContent, scope } = await req.json();

    if ((!id && !content) || !newContent) {
      return NextResponse.json(
        { error: "id or content and newContent are required" },
        { status: 400 }
      );
    }

    const result = await getSupermemory().memories.updateMemory({
      containerTag: getContainerTag(userId, scope),
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
