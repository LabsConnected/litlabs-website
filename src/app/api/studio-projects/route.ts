import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getInstallationOctokit } from "@/lib/github-app";
import {
  createBlankProject,
  createGithubProject,
  listProjects,
  PROJECT_TEMPLATES,
} from "@/lib/projects/project-repository";
import { supabaseAdmin } from "@/lib/supabase";
import { provisionWorkspaceForProject } from "@/lib/studio/workspace-recovery";
import { getProject } from "@/lib/projects/project-repository";
import type { ProjectTemplateId } from "@/lib/projects/types";
import { validateProjectName } from "@/lib/projects/project-name";

/**
 * GET /api/studio-projects
 * List all canonical projects for the authenticated user.
 * Returns both studio_projects and legacy-only projects.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await listProjects(userId);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/studio-projects
 * Create a new canonical project.
 *
 * Body for managed (LiTT-owned) project:
 *   { sourceType: "blank" | "managed", name: string, templateId: "blank-static" | "nextjs" | "react-vite" }
 *   Managed projects provision their durable workspace at create time.
 *
 * Body for GitHub project:
 *   { sourceType: "github", name: string, slug?: string,
 *     githubInstallationId: number, githubRepositoryId: number,
 *     githubOwner: string, githubRepo: string, githubFullName: string,
 *     githubDefaultBranch?: string, githubBranch?: string }
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const sourceType = body.sourceType;
  const name = typeof body.name === "string" ? body.name.trim() : "";

  const nameError = validateProjectName(name);
  if (nameError) {
    return NextResponse.json(
      { error: nameError },
      { status: 400 },
    );
  }

  try {
    // "managed" is the domain name for LiTT-owned source; the stored
    // source_type remains "blank" — the domain layer unifies them.
    if (sourceType === "blank" || sourceType === "managed") {
      const templateId = body.templateId as ProjectTemplateId;
      if (!templateId || !PROJECT_TEMPLATES[templateId]) {
        return NextResponse.json(
          { error: `Invalid templateId. Valid: ${Object.keys(PROJECT_TEMPLATES).join(", ")}` },
          { status: 400 },
        );
      }

      const project = await createBlankProject({
        userId,
        name,
        templateId,
        accessMode: body.accessMode === "shared" ? "shared" : "private",
      });

      // Provision durable source at create time — a managed project must
      // not wait for Preview auto-start to get its workspace, Git repo
      // and branch. provisionWorkspaceForProject is idempotent (atomic
      // provisioning lock + adoption-first prepare), so a concurrent
      // first-open cannot create a duplicate workspace. A failure leaves
      // workspace_status=failed on the row and first-open retries it —
      // the project itself was still created, so return it truthfully.
      try {
        await provisionWorkspaceForProject(project.id, userId);
      } catch (provisionErr) {
        console.error(
          `[studio-projects] create-time provisioning failed for ${project.id}:`,
          provisionErr instanceof Error ? provisionErr.message : provisionErr,
        );
      }
      const refreshed = await getProject(project.id, userId);
      return NextResponse.json({ project: refreshed ?? project }, { status: 201 });
    }

    if (sourceType === "github") {
      const githubInstallationId = Number(body.githubInstallationId);
      const githubRepositoryId = Number(body.githubRepositoryId);
      const githubOwner = body.githubOwner as string;
      const githubRepo = body.githubRepo as string;
      const githubFullName = body.githubFullName as string;

      if (!githubInstallationId || !githubRepositoryId || !githubOwner || !githubRepo || !githubFullName) {
        return NextResponse.json(
          { error: "Missing required GitHub fields" },
          { status: 400 },
        );
      }

      const { data: installation, error: installationError } = await supabaseAdmin
        .from("github_installations")
        .select("installation_id")
        .eq("user_id", userId)
        .eq("installation_id", githubInstallationId)
        .single();
      if (installationError || !installation) {
        return NextResponse.json({ error: "Installation not found" }, { status: 404 });
      }

      let verifiedOwner = githubOwner;
      let verifiedRepo = githubRepo;
      let verifiedFullName = githubFullName;
      let verifiedDefaultBranch = (body.githubDefaultBranch as string) || "main";
      try {
        const octokit = await getInstallationOctokit(githubInstallationId);
        const { data: repository } = await octokit.rest.repos.get({
          owner: githubOwner,
          repo: githubRepo,
        });
        if (repository.id !== githubRepositoryId) {
          return NextResponse.json({ error: "Repository ID mismatch" }, { status: 400 });
        }
        verifiedOwner = repository.owner.login;
        verifiedRepo = repository.name;
        verifiedFullName = repository.full_name;
        verifiedDefaultBranch = repository.default_branch;
      } catch {
        return NextResponse.json(
          { error: "Repository not accessible through this installation" },
          { status: 403 },
        );
      }

      const project = await createGithubProject({
        userId,
        name,
        slug: (body.slug as string) || verifiedRepo,
        githubInstallationId,
        githubRepositoryId,
        githubOwner: verifiedOwner,
        githubRepo: verifiedRepo,
        githubFullName: verifiedFullName,
        githubDefaultBranch: verifiedDefaultBranch,
        githubBranch: (body.githubBranch as string) || verifiedDefaultBranch,
        accessMode: body.accessMode === "shared" ? "shared" : "private",
      });
      return NextResponse.json({ project }, { status: 201 });
    }

    return NextResponse.json(
      { error: `sourceType must be "blank", "managed" or "github"` },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
