import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createBlankProject,
  createGithubProject,
  listProjects,
  PROJECT_TEMPLATES,
} from "@/lib/projects/project-repository";
import type { ProjectTemplateId } from "@/lib/projects/types";

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
 * Body for blank project:
 *   { sourceType: "blank", name: string, templateId: "blank-static" | "nextjs" | "react-vite" }
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

  if (!name || name.length < 2) {
    return NextResponse.json(
      { error: "Project name must be at least 2 characters" },
      { status: 400 },
    );
  }

  try {
    if (sourceType === "blank") {
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
      return NextResponse.json({ project }, { status: 201 });
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

      const project = await createGithubProject({
        userId,
        name,
        slug: (body.slug as string) || githubRepo,
        githubInstallationId,
        githubRepositoryId,
        githubOwner,
        githubRepo,
        githubFullName,
        githubDefaultBranch: (body.githubDefaultBranch as string) || "main",
        githubBranch: (body.githubBranch as string) || "main",
        accessMode: body.accessMode === "shared" ? "shared" : "private",
      });
      return NextResponse.json({ project }, { status: 201 });
    }

    return NextResponse.json(
      { error: `sourceType must be "blank" or "github"` },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
