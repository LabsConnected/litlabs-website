import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/studio/projects
 * List all GitHub-backed studio projects for the authenticated user.
 */
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ projects: [] });

  try {
    const { data, error } = await sb
      .from("studio_projects")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ projects: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to load projects";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/studio/projects
 * Create a new studio project. Can be GitHub-backed or empty.
 *
 * Body for GitHub import:
 *   { github_installation_id, repository_id, owner, repository, full_name, default_branch, branch }
 *
 * Body for empty project:
 *   { name, slug }
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  try {
    const body = await request.json();

    // GitHub-backed project
    if (body.github_installation_id && body.repository_id) {
      const {
        github_installation_id,
        repository_id,
        owner,
        repository,
        full_name,
        default_branch = "main",
        branch,
      } = body;

      if (!owner || !repository) {
        return NextResponse.json({ error: "Missing owner or repository" }, { status: 400 });
      }

      // Verify the user owns this installation
      const { data: inst, error: instError } = await sb
        .from("github_installations")
        .select("installation_id")
        .eq("user_id", userId)
        .eq("installation_id", github_installation_id)
        .single();
      if (instError || !inst) {
        return NextResponse.json({ error: "Installation not found" }, { status: 404 });
      }

      const slug = repository.toLowerCase().replace(/[^a-z0-9-]/g, "-");

      const { data, error } = await sb
        .from("studio_projects")
        .upsert(
          {
            user_id: userId,
            name: repository,
            slug,
            github_installation_id,
            github_repository_id: repository_id,
            github_owner: owner,
            github_repo: repository,
            github_full_name: full_name || `${owner}/${repository}`,
            github_default_branch: default_branch,
            github_branch: branch || default_branch,
            scan_status: "pending",
          },
          { onConflict: "user_id,github_repository_id" },
        )
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ project: data });
    }

    // Empty project
    if (body.name && body.slug) {
      const { data, error } = await sb
        .from("studio_projects")
        .insert({
          user_id: userId,
          name: body.name,
          slug: body.slug,
          scan_status: "pending",
        })
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ project: data });
    }

    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/studio/projects
 * Delete a project by id.
 * Body: { id }
 */
export async function DELETE(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = supabaseAdmin;
  if (!sb) return NextResponse.json({ deleted: false });

  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const { error } = await sb
      .from("studio_projects")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete project";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
