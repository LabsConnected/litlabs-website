import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { trackLeadIdempotent, sanitizeAmId } from "@/lib/ghl-affiliate";

/**
 * POST /api/affiliate/track-lead
 *
 * Server-side, idempotent GHL affiliate lead tracking.
 *
 * Called by the client after Clerk signup/signin. The server checks
 * the `ghl_lead_tracked` column on the users table — if already TRUE,
 * the request is a no-op (replay). If FALSE, the server submits the
 * lead to GHL and marks the user as tracked on success.
 *
 * Body:
 *   { amId?: string }  — the affiliate manager ID from the URL/cookie
 *
 * Response:
 *   { tracked: boolean, replayed: boolean, reason?: string }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: { amId?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // We need the user's email and name from Clerk.
  // The client passes them since it already has them from useUser().
  // The server validates auth — only the authenticated user can track
  // their own lead.
  const { amId, email, firstName, lastName } = body as {
    amId?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
  };

  if (!email) {
    return NextResponse.json(
      { error: "Email is required" },
      { status: 400 },
    );
  }

  const result = await trackLeadIdempotent({
    clerkId: userId,
    email,
    firstName,
    lastName,
    amId: sanitizeAmId(amId), // sanitize untrusted client input
  });

  return NextResponse.json(result, {
    headers: { "Cache-Control": "no-store" },
  });
}
