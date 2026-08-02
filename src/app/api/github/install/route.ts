import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { createInstallState } from "@/lib/github-install-state";

const APP_SLUG = process.env.GITHUB_APP_SLUG;

export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!APP_SLUG) {
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://litlabs.net";
    return NextResponse.redirect(
      `${base}/settings?tab=integrations&error=${encodeURIComponent("GitHub App is not configured")}`,
    );
  }

  let state: string;
  try {
    state = createInstallState(userId);
  } catch {
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://litlabs.net";
    return NextResponse.redirect(
      `${base}/settings?tab=integrations&error=${encodeURIComponent("Server state signing is not configured")}`,
    );
  }

  const redirectUrl = `https://github.com/apps/${APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
  return NextResponse.redirect(redirectUrl);
}
