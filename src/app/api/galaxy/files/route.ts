import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getAppOctokit, getInstallationOctokit } from "@/lib/github-app";

/**
 * GET /api/galaxy/files
 *
 * Aggregates the user's GitHub repos + local projects into a single
 * payload that the FileGalaxy component renders as an interactive
 * galaxy map. Each GitHub installation becomes a "star system" with
 * repos orbiting it as planets. Local projects are shown as a
 * separate "Local Drive" system.
 */

interface GalaxyItem {
  id: string;
  label: string;
  type: "system" | "repo" | "project" | "folder";
  system: string;
  parent?: string;
  meta?: {
    language?: string;
    stars?: number;
    private?: boolean;
    branch?: string;
    status?: string;
    url?: string;
    updated?: string;
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const items: GalaxyItem[] = [];
  const systems: Array<{ id: string; label: string; type: "system" | "project"; color: string }> = [];

  // 1. Fetch GitHub installations
  try {
    const { data: installations } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id")
      .eq("user_id", userId);

    if (installations && installations.length > 0 && process.env.GITHUB_APP_ID) {
      const app = await getAppOctokit();

      for (const inst of installations) {
        const id = inst.installation_id;
        try {
          const { data: instData } = await app.rest.apps.getInstallation({
            installation_id: id,
          });
          const account = instData.account as { login?: string } | null;
          const accountName = account?.login || `Installation ${id}`;

          const systemId = `gh-${id}`;
          systems.push({
            id: systemId,
            label: accountName,
            type: "system",
            color: "#a78bfa",
          });
          items.push({
            id: systemId,
            label: accountName,
            type: "system",
            system: systemId,
            meta: { url: instData.html_url },
          });

          // Fetch repos for this installation
          try {
            const octokit = await getInstallationOctokit(id);
            const { data: repoData } =
              await octokit.rest.apps.listReposAccessibleToInstallation({
                per_page: 100,
              });

            for (const repo of repoData.repositories || []) {
              items.push({
                id: `repo-${repo.id}`,
                label: repo.name,
                type: "repo",
                system: systemId,
                parent: systemId,
                meta: {
                  language: repo.language || undefined,
                  stars: repo.stargazers_count || 0,
                  private: repo.private,
                  branch: repo.default_branch,
                  url: repo.html_url || undefined,
                  updated: repo.updated_at || undefined,
                },
              });
            }
          } catch {
            // repos fetch failed — still show the system
          }
        } catch {
          // installation fetch failed — skip
        }
      }
    }
  } catch {
    // GitHub not configured — continue
  }

  // 2. Fetch local projects from DB
  try {
    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (projects && projects.length > 0) {
      const localSystemId = "local-drive";
      const hasLocal = systems.some((s) => s.id === localSystemId);
      if (!hasLocal) {
        systems.push({
          id: localSystemId,
          label: "Local Projects",
          type: "project",
          color: "#22d3ee",
        });
        items.push({
          id: localSystemId,
          label: "Local Projects",
          type: "system",
          system: localSystemId,
        });
      }

      for (const p of projects) {
        items.push({
          id: `proj-${p.id}`,
          label: p.repository || p.owner || "Untitled",
          type: "project",
          system: localSystemId,
          parent: localSystemId,
          meta: {
            branch: p.working_branch || p.default_branch,
            status: p.status,
            updated: p.updated_at,
          },
        });
      }
    }
  } catch {
    // projects fetch failed — continue
  }

  // 3. Always include a "LiTT Core" system so the map isn't empty
  if (items.length === 0) {
    systems.push({
      id: "core",
      label: "LiTT Core",
      type: "system",
      color: "#22d3ee",
    });
    items.push({
      id: "core",
      label: "LiTT Core",
      type: "system",
      system: "core",
    });
  }

  return NextResponse.json({
    systems,
    items,
    count: items.length,
  });
}
