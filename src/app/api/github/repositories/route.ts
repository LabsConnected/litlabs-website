import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getInstallationOctokit } from "@/lib/github-app";
import { sanitizeProviderError } from "@/lib/provider-error";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const installationId = request.nextUrl.searchParams.get("installation_id");
  if (!installationId) {
    return NextResponse.json(
      { error: "Missing installation_id" },
      { status: 400 },
    );
  }

  const id = parseInt(installationId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: "Invalid installation_id" }, { status: 400 });
  }

  // Verify the installation belongs to the authenticated user before listing repos.
  const { data: rows, error } = await supabaseAdmin
    .from("github_installations")
    .select("installation_id")
    .eq("user_id", userId)
    .eq("installation_id", id)
    .single();
  if (error || !rows) {
    return NextResponse.json({ error: "Installation not found" }, { status: 404 });
  }

  try {
    const octokit = await getInstallationOctokit(id);
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation();
    const repositories = (data.repositories || []).map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      owner: r.owner?.login,
      defaultBranch: r.default_branch,
      private: r.private,
      htmlUrl: r.html_url,
    }));
    return NextResponse.json({ repositories });
  } catch (err) {
    console.error("[api/github/repositories] error:", err);
    const { status, error: message } = sanitizeProviderError(err);
    return NextResponse.json({ error: message }, { status: status === 429 ? 429 : 502 });
  }
}
