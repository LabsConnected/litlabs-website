import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyInstallState } from "@/lib/github-install-state";
import { upsertConnection } from "@/lib/connections/state";
import { logAudit } from "@/lib/connections/audit";
import { getInstallationOctokit } from "@/lib/github-app";

export const dynamic = "force-dynamic";

const REDIRECT_BASE = "/studio/github";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action");
  const state = searchParams.get("state");

  if (!installationId) {
    return NextResponse.redirect(
      `${request.nextUrl.origin}${REDIRECT_BASE}?error=missing_installation`,
    );
  }

  const id = parseInt(installationId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.redirect(
      `${request.nextUrl.origin}${REDIRECT_BASE}?error=invalid_installation`,
    );
  }

  // Verify the signed state token to prevent cross-site installation attacks.
  if (!state) {
    return NextResponse.redirect(
      `${request.nextUrl.origin}${REDIRECT_BASE}?error=missing_state`,
    );
  }

  const stateUserId = verifyInstallState(state);
  if (!stateUserId) {
    return NextResponse.redirect(
      `${request.nextUrl.origin}${REDIRECT_BASE}?error=invalid_or_expired_state`,
    );
  }

  if (stateUserId !== userId) {
    return NextResponse.redirect(
      `${request.nextUrl.origin}${REDIRECT_BASE}?error=state_user_mismatch`,
    );
  }

  // Store the installation reference for the user. Tokens are never stored;
  // short-lived installation tokens are generated on demand.
  try {
    const { error } = await supabaseAdmin.from("github_installations").upsert(
      {
        user_id: userId,
        installation_id: id,
        setup_action: setupAction || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,installation_id" },
    );
    if (error) throw error;

    // Also upsert into the unified provider_connections table
    let accountName: string | undefined;
    try {
      const octokit = await getInstallationOctokit(id);
      const { data: installation } = await octokit.rest.apps.getInstallation({
        installation_id: id,
      });
      accountName = (installation.account as { login?: string; slug?: string; name?: string })?.login
        || (installation.account as { slug?: string })?.slug
        || (installation.account as { name?: string })?.name;
    } catch {
      // Non-fatal — we still have the installation ID
    }

    await upsertConnection(userId, "github", {
      connectionMethod: "app_installation",
      status: "connected",
      externalAccountId: String(id),
      externalAccountName: accountName,
      grantedScopes: ["repo", "metadata", "contents"],
    });

    await logAudit(userId, "github", "connected", undefined, {
      installationId: id,
      accountName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.redirect(
      `${request.nextUrl.origin}${REDIRECT_BASE}?error=${encodeURIComponent(message)}`,
    );
  }

  return NextResponse.redirect(
    `${request.nextUrl.origin}${REDIRECT_BASE}?installed=${id}&connected=1`,
  );
}
