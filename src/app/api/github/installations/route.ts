import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getAppOctokit } from "@/lib/github-app";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_PRIVATE_KEY) {
    return NextResponse.json(
      { error: "GitHub App is not configured" },
      { status: 503 },
    );
  }

  try {
    const { data: rows, error } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id")
      .eq("user_id", userId);
    if (error) throw error;

    const installationIds = (rows || []).map((r: { installation_id: number }) => r.installation_id);
    if (installationIds.length === 0) {
      return NextResponse.json({ installations: [] });
    }

    const app = await getAppOctokit();
    const installations = await Promise.all(
      installationIds.map(async (id: number) => {
        try {
          const { data } = await app.rest.apps.getInstallation({ installation_id: id });
          const account = data.account as { login?: string } | null;
          return {
            id: data.id,
            account: account?.login || null,
            repositorySelection: data.repository_selection,
            repositoriesUrl: data.repositories_url,
          };
        } catch {
          return null;
        }
      }),
    );

    return NextResponse.json({
      installations: installations.filter(Boolean),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "GitHub error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
