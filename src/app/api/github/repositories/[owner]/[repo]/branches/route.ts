import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getInstallationOctokit } from "@/lib/github-app";

/**
 * GET /api/github/repositories/[owner]/[repo]/branches?installation_id=123
 * List branches for a repository accessible to the given installation.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> },
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const installationId = request.nextUrl.searchParams.get("installation_id");
  if (!installationId) {
    return NextResponse.json({ error: "Missing installation_id" }, { status: 400 });
  }

  const id = parseInt(installationId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid installation_id" }, { status: 400 });
  }

  // Verify the installation belongs to the user
  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { data: inst, error: instError } = await sb
    .from("github_installations")
    .select("installation_id")
    .eq("user_id", userId)
    .eq("installation_id", id)
    .single();
  if (instError || !inst) {
    return NextResponse.json({ error: "Installation not found" }, { status: 404 });
  }

  try {
    const { owner, repo } = await params;
    const octokit = await getInstallationOctokit(id);
    const { data } = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });

    const branches = data.map((b) => ({
      name: b.name,
      commitSha: b.commit?.sha ?? null,
      protected: b.protected ?? false,
    }));

    return NextResponse.json({ branches });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list branches";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
