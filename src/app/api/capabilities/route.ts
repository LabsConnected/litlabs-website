import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import type { CapabilitySummary, CapabilityStatus } from "@/lib/capabilities/types";

export const runtime = "nodejs";

async function handler() {
  const { userId } = await auth().catch(() => ({ userId: null }));

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

  // Check GitHub installation status from the database
  let repoStatus: CapabilityStatus = "not_configured";
  let repoAccountName: string | undefined;
  let projectId: string | undefined;
  let projectName: string | undefined;
  let defaultBranch: string | undefined;
  if (userId) {
    try {
      const { data: installations } = await supabaseAdmin
        .from("github_installations")
        .select("installation_id")
        .eq("user_id", userId);

      if (installations && installations.length > 0) {
        // Check if any projects are linked. The connection flow writes to the
        // `projects` table (see /api/projects POST and /api/github/connection-state),
        // so that is the source of truth here — not integration_projects.
        const { data: projects } = await supabaseAdmin
          .from("projects")
          .select("id, name, repository_full_name, default_branch, connection_status")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(1);

        if (projects && projects.length > 0) {
          repoStatus = "ready";
          repoAccountName = projects[0].repository_full_name;
          projectId = projects[0].id;
          projectName = projects[0].name;
          defaultBranch = projects[0].default_branch ?? undefined;
        } else {
          // GitHub installed but no repository selected
          repoStatus = "unavailable";
        }
      }
    } catch {
      // Database error — leave as not_configured
    }
  }

  capabilities.capabilities.push({
    id: "repository",
    name: "Repository",
    status: repoStatus,
    accountName: repoAccountName,
    projectId,
    projectName,
    defaultBranch,
    lastVerifiedAt: new Date().toISOString(),
  });

  capabilities.capabilities.push({
    id: "runtime.sandbox",
    name: "Workspace",
    status: repoStatus === "ready" ? "ready" : "not_configured",
    lastVerifiedAt: new Date().toISOString(),
  });

  return NextResponse.json(capabilities);
}

export const GET = handler;
