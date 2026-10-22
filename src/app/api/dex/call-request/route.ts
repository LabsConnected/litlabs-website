import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { authorizeOutboundCall, type CallAuthorizationRepo } from "@/lib/voice/call-authorization";
import { MockTwilioProvider } from "@/lib/voice/providers/mock-twilio-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 1: in-memory, default-deny repo. This is intentionally hard-coded
// closed — replace with a Supabase-backed repo in Phase 2 only after Larry
// has populated call_consent / call_authorizations / call_kill_switch and
// explicitly authorized flipping the switch. Until then this endpoint can
// never authorize a real call no matter what request it receives.
const phase1Repo: CallAuthorizationRepo = {
  isKillSwitchEngaged: async () => true, // OFF by default: no calls allowed
  hasConsent: async () => false,
  getSpendCapCents: async () => 0,
  getAttemptsToday: async () => 0,
  recordAttempt: async () => {},
};

// Exported for tests only, so a test can assert the mock provider was (or
// wasn't) invoked without reaching into module internals another way.
export const __test__mockProvider = new MockTwilioProvider();

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.DEX_BRIDGE_SECRET ?? "";
  if (secret.length < 32 || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("x-dex-signature");

  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let parsed: { phone: string; requestedBy: string; estimatedCostCents: number };
  try {
    parsed = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const decision = await authorizeOutboundCall(parsed, phase1Repo);

  if (!decision.allowed) {
    return NextResponse.json({ allowed: false, reason: decision.reason }, { status: 403 });
  }

  const result = await __test__mockProvider.placeCall({
    to: parsed.phone,
    from: "+10000000000",
    agentInstructions: "Phase 1 mock call — no real dial performed.",
  });

  return NextResponse.json({ allowed: true, providerCallId: result.providerCallId }, { status: 202 });
}
