import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const installationId = searchParams.get("installation_id");
  const setupAction = searchParams.get("setup_action");
  const state = searchParams.get("state");

  // In production, validate the state parameter against the user session to
  // prevent cross-site installation attacks.
  if (!installationId) {
    return NextResponse.redirect(
      `${request.nextUrl.origin}/studio/github?error=missing_installation`,
    );
  }

  const id = parseInt(installationId, 10);
  if (Number.isNaN(id)) {
    return NextResponse.redirect(
      `${request.nextUrl.origin}/studio/github?error=invalid_installation`,
    );
  }

  // Store the installation reference for the user. Tokens are never stored;
  // short-lived installation tokens are generated on demand.
  try {
    const { error } = await supabaseAdmin.from("github_installations").upsert(
      {
        user_id: userId,
        installation_id: id,
        setup_action: setupAction || null,
        state: state || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,installation_id" },
    );
    if (error) throw error;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database error";
    return NextResponse.redirect(
      `${request.nextUrl.origin}/studio/github?error=${encodeURIComponent(message)}`,
    );
  }

  return NextResponse.redirect(
    `${request.nextUrl.origin}/studio/github?installed=${id}`,
  );
}
