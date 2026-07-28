import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/connections/github/sync
 * Proxy to /api/github/sync — kept for dashboard compatibility.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const base = new URL(req.url).origin;
  const res = await fetch(`${base}/api/github/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await res.text();
  return NextResponse.json(data ? JSON.parse(data) : {}, { status: res.status });
}

export const dynamic = "force-dynamic";
