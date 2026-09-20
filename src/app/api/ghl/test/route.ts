import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDeployed } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/ghl/test
 *
 * Local-only payload inspector for GHL webhook shape. Deployed
 * environments 404. Unauthenticated requests 401. Never log bodies.
 */
async function gate(req: NextRequest) {
  if (isDeployed()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { userId } = await auth(req);
  if (!userId || userId === "anonymous-dev") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const blocked = await gate(req);
  if (blocked) return blocked;

  const samplePayload = {
    callId: "vapi_call_abc123",
    to: "+13239165462",
    from: "+12314285411",
    callerName: "Larry",
    startedAt: "2026-08-11T02:00:00.000Z",
    endedAt: "2026-08-11T02:05:00.000Z",
    durationMs: 300000,
    status: "ended",
    intent: "intent:website",
    leadStatus: "hot",
    followUpNeeded: true,
    summary: "Caller wants a landing page with SEO, has $5000 budget, wants to start ASAP.",
    isKnownUser: true,
    userId: "clerk_xxx",
    projectId: "proj_xxx",
    projectName: "litlabs-website",
    transcript: "User: Hi, I need a website...\nLiTT: We can help!",
    conversationId: "conv_xxx",
  };

  return NextResponse.json({
    message: "GHL Call Payload Test Endpoint",
    instructions: [
      "1. This endpoint receives the same payload that GHL will get.",
      "2. POST to this URL with a test payload to see the format.",
      "3. When ready, set GHL_WEBHOOK_URL to your GHL webhook URL in Vercel env vars.",
      "4. The end-of-call-report event will then automatically send payloads to GHL.",
    ],
    samplePayload,
    intentTags: [
      "intent:website",
      "intent:ai",
      "intent:branding",
      "intent:music",
      "intent:support",
      "intent:other",
    ],
    leadStatuses: ["hot", "warm", "cold", "not-lead"],
  });
}

export async function POST(req: NextRequest) {
  const blocked = await gate(req);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  return NextResponse.json({
    received: true,
    payload: body,
    message: "Payload received successfully. This is what GHL would get.",
  });
}
