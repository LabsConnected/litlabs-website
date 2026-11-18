import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { createNetlifyClient, NetlifyApiError } from "@/lib/deployments/netlify-client";

export const dynamic = "force-dynamic";

/**
 * Netlify personal-access-token connection — mirrors /api/github/pat.
 *
 * GET    → whether the user has a Netlify connection (never the token).
 * POST   → verify the token against the Netlify API, then store it in
 *          user_connection_credentials (the shared credential store;
 *          service-role access only). The token is never echoed back.
 * DELETE → revoke the connection and delete the stored credential.
 */

export async function GET(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ connected: false });
  }

  const { data, error } = await supabaseAdmin
    .from("user_connections")
    .select("id, provider_account_name, status, last_connected_at")
    .eq("user_id", userId)
    .eq("provider", "netlify")
    .eq("connection_reference", "api_token")
    .eq("revoked", false)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: data.status === "connected",
    accountName: data.provider_account_name || null,
    status: data.status,
    lastConnectedAt: data.last_connected_at || null,
  });
}

export async function POST(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Connection storage is unavailable." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as { token?: string };
  const token = body.token?.trim();
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  // Verify the token by calling the Netlify API — an unverified token is
  // never stored.
  let accountName: string | null = null;
  try {
    const user = await createNetlifyClient({ token }).getCurrentUser();
    accountName = user.fullName || user.email || user.slug || "Netlify account";
  } catch (err) {
    if (err instanceof NetlifyApiError && (err.status === 401 || err.status === 403)) {
      return NextResponse.json(
        { error: "Invalid token — Netlify rejected it." },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        error: `Failed to verify token: ${err instanceof Error ? err.message : "Unknown error"}`,
      },
      { status: 500 },
    );
  }

  // Upsert user_connections
  const { data: existing } = await supabaseAdmin
    .from("user_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "netlify")
    .eq("connection_reference", "api_token")
    .maybeSingle();

  let connectionId: string;

  if (existing) {
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("user_connections")
      .update({
        provider_account_name: accountName,
        status: "connected",
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

    // Delete old credentials before storing the new one.
    await supabaseAdmin
      .from("user_connection_credentials")
      .delete()
      .eq("user_connection_id", connectionId);
  } else {
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("user_connections")
      .insert({
        user_id: userId,
        provider: "netlify",
        provider_account_name: accountName,
        connection_reference: "api_token",
        status: "connected",
        scopes: [],
        last_connected_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
    connectionId = inserted.id;
  }

  // Store the token in the shared credential store (same treatment as the
  // GitHub PAT: encrypted_value column, service-role-only table).
  const { error: credErr } = await supabaseAdmin
    .from("user_connection_credentials")
    .insert({
      user_connection_id: connectionId,
      credential_type: "api_token",
      encrypted_value: token,
      scopes: [],
    });

  if (credErr) {
    return NextResponse.json({ error: credErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, accountName });
}

export async function DELETE(request: NextRequest) {
  const { userId } = await auth(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "No Netlify connection found" }, { status: 404 });
  }

  const { data: existing } = await supabaseAdmin
    .from("user_connections")
    .select("id")
    .eq("user_id", userId)
    .eq("provider", "netlify")
    .eq("connection_reference", "api_token")
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "No Netlify connection found" }, { status: 404 });
  }

  // Soft-delete: revoke instead of hard delete for audit trail (PAT parity).
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

  // Delete the stored credential (token) for security.
  await supabaseAdmin
    .from("user_connection_credentials")
    .delete()
    .eq("user_connection_id", existing.id);

  return NextResponse.json({ success: true });
}
