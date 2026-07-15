// List deployment records
import { NextRequest, NextResponse } from "next/server";
import { getDeployments } from "@/lib/deployments";
import { sanitizeProviderError } from "@/lib/provider-error";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hours = Number(searchParams.get("hours"));
    const status = searchParams.get("status") as
      | "queued"
      | "building"
      | "deploying"
      | "live"
      | "failed"
      | "cancelled"
      | null;
    const environment = searchParams.get("environment") as
      | "preview"
      | "staging"
      | "production"
      | null;
    const limit = Math.min(Number(searchParams.get("limit") || "50"), 200);

    const since = Number.isFinite(hours)
      ? new Date(Date.now() - hours * 60 * 60 * 1000)
      : undefined;

    const deployments = await getDeployments({
      since,
      status: status ?? undefined,
      environment: environment ?? undefined,
      limit,
    });

    return NextResponse.json({ deployments, count: deployments.length });
  } catch (error) {
    console.error("[api/deployments] error:", error);
    const { status, error: message } = sanitizeProviderError(error);
    return NextResponse.json(
      { error: "Failed to fetch deployments", message },
      { status },
    );
  }
}
