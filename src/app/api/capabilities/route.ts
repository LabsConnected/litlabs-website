import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveCurrentProject } from "@/lib/projects/resolve-current-project";
import type { CapabilitySummary, CapabilityStatus } from "@/lib/capabilities/types";

export const runtime = "nodejs";

async function handler(req: NextRequest) {
  const { userId } = await auth(req).catch(() => ({ userId: null }));

  const capabilities: CapabilitySummary = {
    capabilities: [
      {
        id: "auth",
        name: "Authentication",
        status: userId ? "ready" : "unavailable",
        lastVerifiedAt: new Date().toISOString(),
      },
    ],
    readiness: [],
  };

  // Resolve the user's current project via the shared helper.
  // This checks studio_projects first, then legacy projects.
  let repoStatus: CapabilityStatus = "not_configured";
  let githubInstalled = false;

  if (userId) {
    // Check if GitHub app is installed (separate from project resolution)
    try {
      const { data: installations, error: instErr } = await supabaseAdmin
        .from("github_installations")
        .select("installation_id")
        .eq("user_id", userId);

      if (instErr) {
        // Non-fatal capability probe error — leave githubInstalled as false
      }

      githubInstalled = !!(installations && installations.length > 0);
    } catch {
      // Non-fatal — leave githubInstalled as false
    }

    // Resolve the URL-selected project first, then use the shared fallback order.
    const explicitProjectId = req.nextUrl.searchParams.get("projectId");
    const project = await resolveCurrentProject({ userId, explicitProjectId });

    if (project) {
      // A blank Studio project is still a valid project even without GitHub
      repoStatus = project.repositoryFullName ? "ready" : "not_configured";

      capabilities.capabilities.push({
        id: "repository",
        name: "Repository",
        status: project.repositoryFullName ? "ready" : "not_configured",
        accountName: project.repositoryFullName ?? undefined,
        projectId: project.projectId,
        projectName: project.projectName,
        defaultBranch: project.defaultBranch ?? undefined,
        activeBranch: project.activeBranch ?? undefined,
        lastVerifiedAt: new Date().toISOString(),
      });

      // Separate project capability — readiness does not depend solely on repo
      capabilities.capabilities.push({
        id: "project",
        name: "Project",
        status: "ready",
        projectId: project.projectId,
        projectName: project.projectName,
        lastVerifiedAt: new Date().toISOString(),
      });

      capabilities.capabilities.push({
        id: "runtime.sandbox",
        name: "Workspace",
        status: project.workspaceStatus === "ready" ? "ready" : "not_configured",
        lastVerifiedAt: new Date().toISOString(),
      });
    } else {
      // No project found — GitHub may be installed but no project selected
      repoStatus = githubInstalled ? "unavailable" : "not_configured";

      capabilities.capabilities.push({
        id: "repository",
        name: "Repository",
        status: repoStatus,
        lastVerifiedAt: new Date().toISOString(),
      });

      capabilities.capabilities.push({
        id: "project",
        name: "Project",
        status: "not_configured",
        lastVerifiedAt: new Date().toISOString(),
      });

      capabilities.capabilities.push({
        id: "runtime.sandbox",
        name: "Workspace",
        status: "not_configured",
        lastVerifiedAt: new Date().toISOString(),
      });
    }
  } else {
    capabilities.capabilities.push({
      id: "repository",
      name: "Repository",
      status: "unavailable",
      lastVerifiedAt: new Date().toISOString(),
    });
    capabilities.capabilities.push({
      id: "project",
      name: "Project",
      status: "unavailable",
      lastVerifiedAt: new Date().toISOString(),
    });
    capabilities.capabilities.push({
      id: "runtime.sandbox",
      name: "Workspace",
      status: "unavailable",
      lastVerifiedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json(capabilities);
}

export const GET = handler;
