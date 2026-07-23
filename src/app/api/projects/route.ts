import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ projects: data || [] });
  } catch {
    return NextResponse.json({ projects: [] }, { status: 200 });
  }
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    github_installation_id,
    repository_id,
    owner,
    repository,
    default_branch = "main",
    working_branch,
    repository_full_name,
    repository_html_url,
    repository_private = false,
  } = body;

  if (!github_installation_id || !repository_id || !owner || !repository || !working_branch) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Verify the user owns this installation.
  const { data: inst, error: instError } = await supabaseAdmin
    .from("github_installations")
    .select("installation_id")
    .eq("user_id", userId)
    .eq("installation_id", github_installation_id)
    .single();
  if (instError || !inst) {
    return NextResponse.json({ error: "Installation not found" }, { status: 404 });
  }

  // Verify the repository is accessible through this installation.
  try {
    const { getInstallationOctokit } = await import("@/lib/github-app");
    const octokit = await getInstallationOctokit(github_installation_id);
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo: repository });
    if (repoData.id !== repository_id) {
      return NextResponse.json({ error: "Repository ID mismatch" }, { status: 400 });
    }
  } catch {
    return NextResponse.json(
      { error: "Repository not accessible through this installation" },
      { status: 403 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("projects")
    .insert({
      user_id: userId,
      github_installation_id,
      repository_id,
      owner,
      repository,
      default_branch,
      working_branch,
      selected_branch: working_branch,
      repository_full_name: repository_full_name || `${owner}/${repository}`,
      repository_html_url: repository_html_url || null,
      repository_private: repository_private,
      status: "offline",
      connection_status: "disconnected",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ project: data });
}
