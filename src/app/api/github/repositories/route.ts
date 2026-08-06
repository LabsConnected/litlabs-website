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

  try {
    let octokit;
    let useApp = false;

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
      useApp = true;
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

    const repositories: Array<{
      id: number;
      fullName: string;
      name: string;
      owner: string | undefined;
      defaultBranch: string;
      private: boolean;
      htmlUrl: string;
    }> = [];

    if (useApp) {
      // GitHub App: use installation endpoint
      let page = 1;
      const perPage = 100;
      while (true) {
        const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
          per_page: perPage,
          page,
        });
        for (const r of data.repositories || []) {
          repositories.push({
            id: r.id,
            fullName: r.full_name,
            name: r.name,
            owner: r.owner?.login,
            defaultBranch: r.default_branch,
            private: r.private,
            htmlUrl: r.html_url,
          });
        }
        if ((data.repositories || []).length < perPage) break;
        page++;
        if (page > 20) break;
      }
    } else {
      // PAT: list repos for the authenticated user
      let page = 1;
      const perPage = 100;
      while (true) {
        const { data } = await octokit.rest.repos.listForAuthenticatedUser({
          per_page: perPage,
          page,
          sort: "updated",
          direction: "desc",
        });
        for (const r of data) {
          repositories.push({
            id: r.id,
            fullName: r.full_name,
            name: r.name,
            owner: r.owner?.login,
            defaultBranch: r.default_branch,
            private: r.private,
            htmlUrl: r.html_url,
          });
        }
        if (data.length < perPage) break;
        page++;
        if (page > 20) break;
      }
    }

    return NextResponse.json({ repositories, total: repositories.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
