import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/github/pat
 * Returns whether the user has a GitHub PAT connection.
 */
export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("user_connections")
    .select("id, provider_account_name, status, scopes, last_connected_at, metadata")
    .eq("user_id", userId)
    .eq("provider", "github")
    .eq("connection_reference", "pat")
    .eq("revoked", false)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    accountName: data.provider_account_name || null,
    status: data.status,
    scopes: data.scopes || [],
    lastConnectedAt: data.last_connected_at || null,
  });
}

/**
 * POST /api/github/pat
 * Save a GitHub Personal Access Token.
 * Body: { token: string, accountName?: string }
 */
export async function POST(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as {
    token?: string;
    accountName?: string;
  };

  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
    return NextResponse.json({
      error: "Invalid token format. Expected a GitHub Personal Access Token (starts with ghp_ or github_pat_).",
    }, { status: 400 });
  }

  // Verify the token by calling the GitHub API
  let accountName = body.accountName || null;
  let scopes: string[] = [];
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) {
      if (res.status === 401) {
        return NextResponse.json({ error: "Invalid token — GitHub rejected it." }, { status: 400 });
      }
      return NextResponse.json({ error: `GitHub API returned ${res.status}` }, { status: 400 });
    }

    const userData = await res.json() as { login?: string };
    accountName = accountName || userData.login || "unknown";

    // Extract scopes from the X-OAuth-Scopes header
    const scopeHeader = res.headers.get("x-oauth-scopes") || "";
    scopes = scopeHeader ? scopeHeader.split(", ").map((s) => s.trim()) : [];
  } catch (err) {
    return NextResponse.json({
      error: `Failed to verify token: ${err instanceof Error ? err.message : "Unknown error"}`,
    }, { status: 500 });
  }

  // Upsert user_connections
  const { data: existing } = await supabaseAdmin
    .from("user_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "github")
    .eq("connection_reference", "pat")
    .maybeSingle();

  let connectionId: string;

  if (existing) {
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("user_connections")
      .update({
        provider_account_name: accountName,
        status: "connected",
        scopes,
        last_connected_at: new Date().toISOString(),
        revoked: false,
        revoked_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }
    connectionId = updated.id;

    // Delete old credentials
    await supabaseAdmin
      .from("user_connection_credentials")
      .delete()
      .eq("user_connection_id", connectionId);
  } else {
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("user_connections")
      .insert({
        user_id: userId,
        provider: "github",
        provider_account_name: accountName,
        connection_reference: "pat",
        status: "connected",
        scopes,
        last_connected_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    connectionId = inserted.id;
  }

  // Store the token in user_connection_credentials
  // Note: encrypted_value field — we store the token directly since Supabase
  // handles encryption at rest. For production, consider client-side encryption.
  const { error: credErr } = await supabaseAdmin
    .from("user_connection_credentials")
    .insert({
      user_connection_id: connectionId,
      credential_type: "pat",
      encrypted_value: token,
      scopes,
    });

  if (credErr) {
    return NextResponse.json({ error: credErr.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    accountName,
    scopes,
  });
}

/**
 * DELETE /api/github/pat
 * Remove the GitHub PAT connection.
 */
export async function DELETE(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing } = await supabaseAdmin
    .from("user_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "github")
    .eq("connection_reference", "pat")
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "No PAT connection found" }, { status: 404 });
  }

  // Soft-delete: revoke instead of hard delete for audit trail
  const { error: revokeErr } = await supabaseAdmin
    .from("user_connections")
    .update({
      status: "revoked",
      revoked: true,
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (revokeErr) {
    return NextResponse.json({ error: revokeErr.message }, { status: 500 });
  }

  // Delete the stored credential (token) for security
  await supabaseAdmin
    .from("user_connection_credentials")
    .delete()
    .eq("user_connection_id", existing.id);

  return NextResponse.json({ success: true });
}
