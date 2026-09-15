// List deployment records
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { userId } = await auth(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(req.url);
    const hoursParam = searchParams.get("hours");
    const hours = hoursParam === null ? null : Number(hoursParam);
    const status = searchParams.get("status") as
      | "pending"
      | "building"
      | "ready"
      | "error"
      | "canceled"
      | null;
    const environment = searchParams.get("environment") as
      | "preview"
      | "development"
      | "production"
      | null;
    const requestedLimit = Number(searchParams.get("limit") || "50");
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
      : 50;
    const projectId = searchParams.get("projectId");

    const since = hours !== null && Number.isFinite(hours) && hours > 0
      ? new Date(Date.now() - hours * 60 * 60 * 1000)
      : undefined;

    let query = supabaseAdmin
      .from("project_deployments")
      .select("id, integration_project_id, provider, deployment_id, environment, status, url, commit_sha, commit_message, branch, created_at, updated_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (since) query = query.gte("created_at", since.toISOString());
    if (status) query = query.eq("status", status);
    if (environment) query = query.eq("environment", environment);
    if (projectId) query = query.eq("integration_project_id", projectId);

    const { data, error } = await query;
    if (error) throw error;
    const deployments = data ?? [];

    return NextResponse.json({ deployments, count: deployments.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch deployments", message },
      { status: 500 },
    );
  }
}
