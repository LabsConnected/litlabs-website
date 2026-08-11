import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ghl/test
 * Shows the expected GHL payload schema and instructions.
 *
 * POST /api/ghl/test
 * Receives a payload (from GHL or manual test) and logs/returns it.
 * Use this to verify the payload format before configuring GHL workflows.
 */
export async function GET() {
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
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  console.log("[GHL-TEST] Received payload:", JSON.stringify(body, null, 2));

  return NextResponse.json({
    received: true,
    payload: body,
    message: "Payload received successfully. This is what GHL would get.",
  });
}
