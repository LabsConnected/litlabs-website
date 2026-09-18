// List deployment records
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { listLatestDeploymentsForUser } from "@/lib/deployments/deployment-store";
import { HOSTING_DISPLAY_NAME } from "@/lib/deployments/litt-hosting";

export const dynamic = "force-dynamic";

/**
 * GET /api/deployments
 *
 * Returns the account's own CI/CD deployment history (`deployments`) plus
 * the user's published sites (`sites`): the latest LiTT Hosting deployment
 * per project, with the verified live URL when one exists.
 *
 * Copy rule: sites are "Published with LiTT Hosting". Infrastructure
 * provider names never appear here.
 */
async function getPublishedSites(userId: string) {
  try {
    const latest = await listLatestDeploymentsForUser(userId);
    if (latest.length === 0) return [];
    const projectIds = [...new Set(latest.map((d) => d.projectId))];
    const { data: projects } = await supabaseAdmin
      .from("studio_projects")
      .select("id,name")
      .eq("user_id", userId)
      .in("id", projectIds);
    const names = new Map(
      ((projects ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name]),
    );
    return latest.map((d) => ({
      id: d.id,
      projectId: d.projectId,
      projectName: names.get(d.projectId) ?? "Untitled project",
      status: d.status,
      hosting: HOSTING_DISPLAY_NAME,
      liveUrl: d.status === "ready" && d.urlVerified ? d.publicUrl : null,
      urlVerified: d.urlVerified,
      errorMessage: d.status === "failed" ? d.errorMessage : null,
      fileCount: d.fileCount,
    }));
  } catch {
    // Sites are additive: a failure here must not break the main history.
    return [];
  }
}

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

    const sites = await getPublishedSites(userId);

    return NextResponse.json({ deployments, count: deployments.length, sites });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch deployments", message },
      { status: 500 },
    );
  }
}
