import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getAppAuth, getInstallationOctokit, getAppOctokit } from "@/lib/github-app";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DiagStep = {
  step: string;
  status: "pass" | "fail" | "warn";
  detail: string;
  data?: Record<string, unknown>;
};

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const installationIdParam = request.nextUrl.searchParams.get("installation_id");
  const installationId = installationIdParam ? parseInt(installationIdParam, 10) : null;

  const steps: DiagStep[] = [];

  // Step 1: Verify GitHub App credentials exist
  try {
    getAppAuth();
    const appIdVal = process.env.GITHUB_APP_ID;
    steps.push({
      step: "app_credentials",
      status: "pass",
      detail: `GitHub App ID ${appIdVal} configured`,
      data: { app_id: appIdVal },
    });
  } catch (err) {
    steps.push({
      step: "app_credentials",
      status: "fail",
      detail: `Missing or invalid GitHub App credentials: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // Step 2: Verify GitHub App can authenticate
  try {
    const appOctokit = await getAppOctokit();
    const { data: app } = await appOctokit.rest.apps.getAuthenticated();
    if (!app) throw new Error("No app data returned");
    steps.push({
      step: "app_authentication",
      status: "pass",
      detail: `Authenticated as GitHub App "${app.name}" (slug: ${app.slug})`,
      data: { name: app.name, slug: app.slug },
    });
  } catch (err) {
    steps.push({
      step: "app_authentication",
      status: "fail",
      detail: `GitHub App authentication failed: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // Step 3: Verify webhook secret is configured
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (webhookSecret) {
    steps.push({
      step: "webhook_secret",
      status: "pass",
      detail: "Webhook secret is configured",
    });
  } else {
    steps.push({
      step: "webhook_secret",
      status: "fail",
      detail: "GITHUB_WEBHOOK_SECRET is not set — webhooks cannot be verified",
    });
  }

  // Step 4: Check installation ID belongs to user
  if (!installationId) {
    const { data: installations } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id, user_id, created_at")
      .eq("user_id", userId);

    steps.push({
      step: "installation_lookup",
      status: installations && installations.length > 0 ? "pass" : "warn",
      detail: installations && installations.length > 0
        ? `Found ${installations.length} installation(s) for user`
        : "No GitHub installations found for user",
      data: { installations: installations?.map((i) => i.installation_id) || [] },
    });

    if (!installations || installations.length === 0) {
      return NextResponse.json({ steps, overall: "fail" });
    }
  } else {
    const { data: inst, error: instError } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id, user_id")
      .eq("user_id", userId)
      .eq("installation_id", installationId)
      .single();

    if (instError || !inst) {
      steps.push({
        step: "installation_ownership",
        status: "fail",
        detail: `Installation #${installationId} does not belong to this user`,
      });
      return NextResponse.json({ steps, overall: "fail" });
    }
    steps.push({
      step: "installation_ownership",
      status: "pass",
      detail: `Installation #${installationId} verified for user`,
    });
  }

  const instId = installationId ?? (steps.find((s) => s.step === "installation_lookup")?.data as { installations?: number[] } | undefined)?.installations?.[0];
  if (!instId) {
    return NextResponse.json({ steps, overall: "fail" });
  }

  // Step 5: Generate installation access token
  try {
    const octokit = await getInstallationOctokit(instId);
    steps.push({
      step: "installation_token",
      status: "pass",
      detail: `Successfully generated installation access token for #${instId}`,
    });

    // Step 6: Check installation permissions
    const { data: installation } = await octokit.rest.apps.getInstallation({
      installation_id: instId,
    });
    steps.push({
      step: "installation_permissions",
      status: "pass",
      detail: `Installation has ${Object.keys(installation.permissions || {}).length} permissions`,
      data: { permissions: installation.permissions, repository_selection: installation.repository_selection },
    });

    // Step 7: Check repository access
    const { data: reposData } = await octokit.rest.apps.listReposAccessibleToInstallation({
      per_page: 100,
    });
    const repoCount = reposData.total_count ?? (reposData.repositories || []).length;
    steps.push({
      step: "repository_access",
      status: repoCount > 0 ? "pass" : "warn",
      detail: `Installation has access to ${repoCount} repositor${repoCount === 1 ? "y" : "ies"}`,
      data: { count: repoCount, repos: (reposData.repositories || []).slice(0, 10).map((r) => r.full_name) },
    });

    // Step 8: Check rate limits
    const { data: rateLimit } = await octokit.rest.rateLimit.get();
    steps.push({
      step: "rate_limits",
      status: rateLimit.rate.remaining > 100 ? "pass" : rateLimit.rate.remaining > 10 ? "warn" : "fail",
      detail: `${rateLimit.rate.remaining}/${rateLimit.rate.limit} core requests remaining (resets at ${new Date(rateLimit.rate.reset * 1000).toISOString()})`,
      data: { remaining: rateLimit.rate.remaining, limit: rateLimit.rate.limit, reset: rateLimit.rate.reset },
    });
  } catch (err) {
    steps.push({
      step: "installation_token",
      status: "fail",
      detail: `Failed to generate installation token: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // Step 9: Check database persistence
  try {
    const { data: projects, error: dbError } = await supabaseAdmin
      .from("integration_projects")
      .select("id, repository_full_name, sync_status, last_synced_at")
      .eq("user_id", userId)
      .limit(5);

    if (dbError) throw dbError;

    steps.push({
      step: "database_persistence",
      status: "pass",
      detail: `Found ${projects?.length || 0} integration project(s) in database`,
      data: { projects: projects?.map((p) => ({ repo: p.repository_full_name, sync: p.sync_status })) || [] },
    });
  } catch (err) {
    steps.push({
      step: "database_persistence",
      status: "fail",
      detail: `Database query failed: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  // Step 10: Check webhook delivery history
  try {
    const { data: webhooks, error: whError } = await supabaseAdmin
      .from("github_webhook_events")
      .select("event, delivery_id, created_at")
      .order("created_at", { ascending: false })
      .limit(5);

    if (whError) throw whError;

    steps.push({
      step: "webhook_deliveries",
      status: webhooks && webhooks.length > 0 ? "pass" : "warn",
      detail: webhooks && webhooks.length > 0
        ? `Last webhook: ${webhooks[0].event} at ${webhooks[0].created_at}`
        : "No webhook deliveries recorded yet",
      data: { recent: webhooks?.map((w) => ({ event: w.event, at: w.created_at })) || [] },
    });
  } catch (err) {
    steps.push({
      step: "webhook_deliveries",
      status: "warn",
      detail: `Could not query webhook history: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  const failedSteps = steps.filter((s) => s.status === "fail");
  const overall = failedSteps.length === 0 ? "pass" : "fail";

  return NextResponse.json({ steps, overall });
}
