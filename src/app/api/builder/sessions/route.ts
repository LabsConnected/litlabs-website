import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { withRateLimit } from "@/lib/rate-limiter";

type SessionMessage = { role: "user" | "assistant"; content: string; createdAt?: number };

function cleanMessages(value: unknown): SessionMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-200).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const message = item as Record<string, unknown>;
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") return [];
    return [{ role: message.role, content: message.content.slice(0, 100_000), ...(typeof message.createdAt === "number" ? { createdAt: message.createdAt } : {}) }];
  });
}

async function getHandler() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabaseAdmin.from("builder_chat_sessions").select("*").eq("clerk_user_id", userId).order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(100);
  if (error) return NextResponse.json({ error: "Session storage unavailable" }, { status: 503 });
  return NextResponse.json({ sessions: data ?? [] });
}

async function postHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "Invalid session" }, { status: 400 });
  const record = {
    id: body.id,
    clerk_user_id: userId,
    title: typeof body.title === "string" ? body.title.trim().slice(0, 120) || "New chat" : "New chat",
    pinned: body.pinned === true,
    messages: cleanMessages(body.messages),
    context: body.context && typeof body.context === "object" ? body.context : {},
    created_at: typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabaseAdmin.from("builder_chat_sessions").upsert(record, { onConflict: "id" }).select().single();
  if (error) return NextResponse.json({ error: "Failed to save session" }, { status: 500 });
  return NextResponse.json({ session: data });
}

async function deleteHandler(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  let query = supabaseAdmin.from("builder_chat_sessions").delete().eq("clerk_user_id", userId);
  query = id ? query.eq("id", id) : query;
  const { error } = await query;
  if (error) return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export const GET = withRateLimit(getHandler, 100, 60);
export const POST = withRateLimit(postHandler, 120, 60);
export const DELETE = withRateLimit(deleteHandler, 30, 60);
