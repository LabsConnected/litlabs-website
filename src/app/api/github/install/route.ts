import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const APP_ID = process.env.GITHUB_APP_ID;
const SETUP_URL = process.env.GITHUB_APP_SETUP_URL;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (SETUP_URL) {
    return NextResponse.redirect(SETUP_URL);
  }

  if (!APP_ID) {
    const base = process.env.NEXT_PUBLIC_APP_URL || "https://litlabs.net";
    return NextResponse.redirect(
      `${base}/settings?tab=integrations&error=${encodeURIComponent("GitHub App is not configured")}`,
    );
  }

  // Generic GitHub App installation URL. Configure a state param and callback
  // URL in the GitHub App settings (e.g. https://litlabs.net/api/github/callback).
  const redirectUrl = `https://github.com/apps/${APP_ID}/installations/new?state=${encodeURIComponent(userId)}`;
  return NextResponse.redirect(redirectUrl);
}
