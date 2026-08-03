import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { buildIntegrationStatus } from "@/lib/integrations/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { userId } = await auth(req).catch(() => ({ userId: null }));

  try {
    const status = await buildIntegrationStatus(userId);
    return NextResponse.json(status, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build integration status";
    return NextResponse.json(
      { error: message, integrations: [], summary: null },
      { status: 500 },
    );
  }
}
