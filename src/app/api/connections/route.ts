import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin, getSupabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/connections
 * Returns connection overview for the dashboard Connection Health widget.
 * Bridges the buildIntegrationStatus data into the ConnectionOverview shape
 * that CommandCenter.tsx expects.
 */

interface ConnectionOverview {
  provider: string;
  label: string;
  category: string;
  status: string;
  externalAccountName: string | null;
  lastSyncedAt: string | null;
  lastErrorMessage: string | null;
  isConnected: boolean;
  connectUrl?: string;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const overview: ConnectionOverview[] = [];

  // GitHub
  if (getSupabaseAdmin()) {
    const { data: installations } = await supabaseAdmin
      .from("github_installations")
      .select("installation_id, created_at")
      .eq("user_id", userId);

    const ghConnected = (installations ?? []).length > 0;
    overview.push({
      provider: "github",
      label: "GitHub",
      category: "Development",
      status: ghConnected ? "connected" : "disconnected",
      externalAccountName: ghConnected ? `${(installations ?? []).length} installation(s)` : null,
      lastSyncedAt: installations?.[0]?.created_at ?? null,
      lastErrorMessage: null,
      isConnected: ghConnected,
      connectUrl: "/studio/github",
    });

    // Vercel
    const { data: projects } = await supabaseAdmin
      .from("projects")
      .select("id, repository_full_name, connected_at")
      .eq("user_id", userId)
      .limit(1);

    const vercelConnected = (projects ?? []).length > 0;
    overview.push({
      provider: "vercel",
      label: "Vercel",
      category: "Deployment",
      status: vercelConnected ? "connected" : "disconnected",
      externalAccountName: vercelConnected ? (projects ?? [])[0]?.repository_full_name ?? null : null,
      lastSyncedAt: projects?.[0]?.connected_at ?? null,
      lastErrorMessage: null,
      isConnected: vercelConnected,
      connectUrl: "/settings/connections",
    });

    // Supabase
    overview.push({
      provider: "supabase",
      label: "Supabase",
      category: "Database",
      status: "connected",
      externalAccountName: "Database ready",
      lastSyncedAt: new Date().toISOString(),
      lastErrorMessage: null,
      isConnected: true,
      connectUrl: "/settings/connections",
    });
  } else {
    overview.push({
      provider: "supabase",
      label: "Supabase",
      category: "Database",
      status: "disconnected",
      externalAccountName: null,
      lastSyncedAt: null,
      lastErrorMessage: "Not configured",
      isConnected: false,
      connectUrl: "/settings/connections",
    });
  }

  // AI providers (env-based, no DB check needed)
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  overview.push({
    provider: "gemini",
    label: "Gemini",
    category: "AI",
    status: geminiKey ? "connected" : "disconnected",
    externalAccountName: geminiKey ? "gemini-2.5-flash" : null,
    lastSyncedAt: null,
    lastErrorMessage: geminiKey ? null : "GEMINI_API_KEY not set",
    isConnected: !!geminiKey,
    connectUrl: "/settings/connections",
  });

  const openrouterKey = process.env.OPENROUTER_API_KEY;
  overview.push({
    provider: "openrouter",
    label: "OpenRouter",
    category: "AI",
    status: openrouterKey ? "connected" : "disconnected",
    externalAccountName: openrouterKey ? "openrouter/free" : null,
    lastSyncedAt: null,
    lastErrorMessage: openrouterKey ? null : "OPENROUTER_API_KEY not set",
    isConnected: !!openrouterKey,
    connectUrl: "/settings/connections",
  });

  // Stripe
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  overview.push({
    provider: "stripe",
    label: "Stripe",
    category: "Payments",
    status: stripeKey ? "connected" : "disconnected",
    externalAccountName: stripeKey ? "Live mode" : null,
    lastSyncedAt: null,
    lastErrorMessage: stripeKey ? null : "STRIPE_SECRET_KEY not set",
    isConnected: !!stripeKey,
    connectUrl: "/settings/connections",
  });

  // Meta Developer (Facebook/Instagram)
  const metaKey = process.env.META_APP_SECRET;
  overview.push({
    provider: "meta",
    label: "Meta Developer",
    category: "Publishing",
    status: metaKey ? "connected" : "disconnected",
    externalAccountName: metaKey ? "Connected" : null,
    lastSyncedAt: null,
    lastErrorMessage: metaKey ? null : "Not configured",
    isConnected: !!metaKey,
    connectUrl: "/settings/connections",
  });

  // Terminal server
  const terminalUrl = process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
  overview.push({
    provider: "terminal",
    label: "Terminal Server",
    category: "Development",
    status: terminalUrl ? "connected" : "disconnected",
    externalAccountName: terminalUrl ? "Railway" : null,
    lastSyncedAt: null,
    lastErrorMessage: terminalUrl ? null : "NEXT_PUBLIC_TERMINAL_WS_URL not set",
    isConnected: !!terminalUrl,
    connectUrl: "/settings/connections",
  });

  // Voice (Inworld)
  const inworldKey = process.env.INWORLD_API_KEY;
  overview.push({
    provider: "voice",
    label: "Voice (Inworld)",
    category: "AI",
    status: inworldKey ? "connected" : "disconnected",
    externalAccountName: inworldKey ? "Inworld" : null,
    lastSyncedAt: null,
    lastErrorMessage: inworldKey ? null : "INWORLD_API_KEY not set",
    isConnected: !!inworldKey,
    connectUrl: "/settings/connections",
  });

  return NextResponse.json({ overview });
}

export const dynamic = "force-dynamic";
