import { NextResponse } from "next/server";
import { requireDatabaseUser, DatabaseUserError } from "@/lib/require-database-user";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GitHubRepository {
  id: number;
  full_name: string;
  default_branch: string;
  permissions: { read: boolean; write: boolean; admin: boolean };
}

interface GitHubReconcileResult {
  installationFound: boolean;
  installationId?: number;
  repositories: GitHubRepository[];
  selectedRepository?: string;
  repairPerformed: boolean;
  errors: Array<{ stage: string; message: string }>;
}

/**
 * POST /api/integrations/github/reconcile
 *
 * Reconciles GitHub installations for the authenticated user:
 * 1. Reads authenticated user
 * 2. Resolves database user
 * 3. Lists GitHub installations from the database
 * 4. Finds authorized repositories via GitHub API (if App credentials configured)
 * 5. Upserts installation metadata
 * 6. Upserts repository records
 * 7. Preserves existing project mappings
 * 8. Returns available repositories
 */
export async function POST() {
  const errors: Array<{ stage: string; message: string }> = [];

  // 1 & 2: Resolve user
  let databaseUserId: string;
  try {
    const user = await requireDatabaseUser();
    databaseUserId = user.databaseUserId;
  } catch (err) {
    if (err instanceof DatabaseUserError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === "AUTH_REQUIRED" ? 401 : 500 },
      );
    }
    return NextResponse.json({ error: "User resolution failed" }, { status: 500 });
  }

  // 3: List GitHub installations from database
  const { data: dbInstallations, error: instError } = await supabaseAdmin
    .from("github_installations")
    .select("installation_id, setup_action, updated_at")
    .eq("user_id", databaseUserId);

  if (instError) {
    errors.push({ stage: "installation_lookup", message: instError.message });
  }

  const installations = dbInstallations || [];

  if (installations.length === 0) {
    const result: GitHubReconcileResult = {
      installationFound: false,
      repositories: [],
      repairPerformed: false,
      errors,
    };
    return NextResponse.json(result);
  }

  // 4: Try to fetch repositories via GitHub App API
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKey) {
    // GitHub App not configured — return what we know from the database
    const result: GitHubReconcileResult = {
      installationFound: true,
      installationId: installations[0].installation_id,
      repositories: [],
      repairPerformed: false,
      errors: [
        ...errors,
        {
          stage: "github_app_config",
          message: "GITHUB_APP_ID or GITHUB_PRIVATE_KEY not set. Cannot fetch repositories via GitHub API.",
        },
      ],
    };
    return NextResponse.json(result);
  }

  // 5: Fetch repositories via GitHub App installation token
  const installationId = installations[0].installation_id;

  try {
    // Dynamically import to avoid loading @octokit/auth-app if not needed
    const { createAppAuth } = await import("@octokit/auth-app");
    const { Octokit } = await import("@octokit/rest");

    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey: privateKey.replace(/\\n/g, "\n"),
        installationId,
      },
    });

    const reposResponse = await octokit.request("GET /installation/repositories");
    const repos: GitHubRepository[] = reposResponse.data.repositories.map((r: {
      id: number;
      full_name: string;
      default_branch: string;
      permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
    }) => ({
      id: r.id,
      full_name: r.full_name,
      default_branch: r.default_branch,
      permissions: {
        read: r.permissions?.pull ?? false,
        write: r.permissions?.push ?? false,
        admin: r.permissions?.admin ?? false,
      },
    }));

    // 6: Upsert repository records into integration_projects
    for (const repo of repos) {
      const { data: existing } = await supabaseAdmin
        .from("integration_projects")
        .select("id")
        .eq("user_id", databaseUserId)
        .eq("repository_id", repo.id)
        .single();

      if (!existing) {
        await supabaseAdmin.from("integration_projects").insert({
          user_id: databaseUserId,
          provider: "github",
          repository_id: repo.id,
          repository_full_name: repo.full_name,
          sync_status: "pending",
        });
      }
    }

    // 7: Check for selected repository (existing project mapping)
    const { data: projects } = await supabaseAdmin
      .from("integration_projects")
      .select("repository_full_name")
      .eq("user_id", databaseUserId)
      .not("repository_full_name", "is", null)
      .limit(1);

    const result: GitHubReconcileResult = {
      installationFound: true,
      installationId,
      repositories: repos,
      selectedRepository: projects?.[0]?.repository_full_name,
      repairPerformed: repos.length > 0,
      errors,
    };

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub API error";
    errors.push({ stage: "github_api", message });

    const result: GitHubReconcileResult = {
      installationFound: true,
      installationId,
      repositories: [],
      repairPerformed: false,
      errors,
    };
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  }
}
