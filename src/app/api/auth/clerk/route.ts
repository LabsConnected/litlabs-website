// POST /api/auth/clerk
// Redirects to /api/webhook/clerk — this endpoint is deprecated.
// Configure Clerk to use: https://litlabs.net/api/webhook/clerk

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  // Forward to the canonical webhook endpoint
  const url = new URL("/api/webhook/clerk", req.url);
  return NextResponse.redirect(url, 308);
}

export const dynamic = "force-dynamic";
