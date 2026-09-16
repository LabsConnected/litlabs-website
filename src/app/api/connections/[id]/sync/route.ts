import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * POST /api/connections/[id]/sync
 * Re-syncs a provider connection for the signed-in user.
 *
 * Currently only GitHub has a real sync backend (proxied to
 * /api/github/sync). Other providers return 501 rather than
 * pretending to sync.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  if (id === "github") {
    const body = await req.text();
    const base = new URL(req.url).origin;
    const res = await fetch(`${base}/api/github/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await res.text();
    return NextResponse.json(data ? JSON.parse(data) : {}, {
      status: res.status,
    });
  }

  return NextResponse.json(
    { error: `Sync is not available for "${id}" yet.` },
    { status: 501 },
  );
}

export const dynamic = "force-dynamic";
