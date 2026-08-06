import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getInstallationOctokit } from "@/lib/github-app";
import { getPATOctokit } from "@/lib/github-pat";

export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const installationId = request.nextUrl.searchParams.get("installation_id");
  const owner = request.nextUrl.searchParams.get("owner");
  const repo = request.nextUrl.searchParams.get("repo");

  if (!owner || !repo) {
    return NextResponse.json(
      { error: "Missing owner or repo" },
      { status: 400 },
    );
  }

  try {
    let octokit;

    if (installationId) {
      const id = parseInt(installationId, 10);
      if (Number.isNaN(id)) {
        return NextResponse.json({ error: "Invalid installation_id" }, { status: 400 });
      }

      // Verify the installation belongs to the authenticated user
      const { data: rows, error } = await supabaseAdmin
        .from("github_installations")
        .select("installation_id")
        .eq("user_id", userId)
        .eq("installation_id", id)
        .single();
      if (error || !rows) {
        return NextResponse.json({ error: "Installation not found" }, { status: 404 });
      }

      octokit = await getInstallationOctokit(id);
    } else {
      // Fall back to PAT
      const pat = await getPATOctokit(userId);
      if (!pat) {
        return NextResponse.json(
          { error: "No GitHub connection found. Install the GitHub App or connect a Personal Access Token." },
          { status: 404 },
        );
      }
      octokit = pat.octokit;
    }

    const { data } = await octokit.rest.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });
    const branches = data.map((b) => ({
      name: b.name,
      protected: b.protected ?? false,
      commitSha: b.commit?.sha ?? null,
    }));
    return NextResponse.json({ branches });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
