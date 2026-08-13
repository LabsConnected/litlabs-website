import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { withRateLimit } from "@/lib/rate-limiter";
import { getContent, approveContent, rejectContent } from "@/lib/growth/growth-repository";

// GET /api/growth/content/[contentId] — get a single content draft
async function getHandler(req: NextRequest, { params }: { params: Promise<{ contentId: string }> }) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { contentId } = await params;
  const content = await getContent(clerkId, contentId);
  if (!content) {
    return NextResponse.json({ error: "Content not found" }, { status: 404 });
  }

  return NextResponse.json({ content });
}

// PATCH /api/growth/content/[contentId] — approve or reject a draft
async function patchHandler(req: NextRequest, { params }: { params: Promise<{ contentId: string }> }) {
  const { userId: clerkId } = await auth(req);
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const action = typeof b.action === "string" ? b.action : "";
  const { contentId } = await params;

  if (action === "approve") {
    const content = await approveContent(clerkId, contentId);
    if (!content) {
      return NextResponse.json({ error: "Cannot approve — content may not be in draft status" }, { status: 409 });
    }
    return NextResponse.json({ content });
  }

  if (action === "reject") {
    const reason = typeof b.reason === "string" ? b.reason : undefined;
    const content = await rejectContent(clerkId, contentId, reason);
    if (!content) {
      return NextResponse.json({ error: "Cannot reject — content may not be in draft status" }, { status: 409 });
    }
    return NextResponse.json({ content });
  }

  return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
}

export const GET = withRateLimit(getHandler);
export const PATCH = withRateLimit(patchHandler);
