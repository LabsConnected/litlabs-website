import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getAppOctokit } from "@/lib/github-app";
import type { HealthCheck, ServiceStatus, StudioHealthResponse } from "@/lib/health/types";

export const runtime = "nodejs";
export const maxDuration = 30;

const OFFLINE_THRESHOLD_MS = 90_000;
const TERMINAL_SERVER_URL =
  process.env.TERMINAL_SERVER_URL ||
  process.env.NEXT_PUBLIC_TERMINAL_URL ||
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL?.replace(/^wss:/, "https:").replace(/^ws:/, "http:") ||
  "";

async function checkClerk(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return { name: "clerk", status: "misconfigured", message: "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY missing" };
  }
  if (!process.env.CLERK_SECRET_KEY) {
    return { name: "clerk", status: "misconfigured", message: "CLERK_SECRET_KEY missing" };
  }
  const isDevKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.startsWith("pk_test_");
  return {
    name: "clerk",
    status: "healthy",
    message: isDevKey ? "Using development keys (pk_test_)" : "Production keys configured",
    latencyMs: Date.now() - start,
  };
}

async function checkGitHub(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_PRIVATE_KEY) {
    return { name: "github", status: "misconfigured", message: "GITHUB_APP_ID or GITHUB_PRIVATE_KEY missing" };
  }
  try {
    const octokit = await getAppOctokit();
    await octokit.rest.apps.getAuthenticated();
    return { name: "github", status: "healthy", message: "GitHub App authenticated", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "github", status: "offline", message: err instanceof Error ? err.message : "GitHub auth failed", latencyMs: Date.now() - start };
  }
}

async function checkSupabase(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { name: "supabase", status: "misconfigured", message: "Supabase URL or service role key missing" };
  }
  if (!supabaseAdmin) {
    return { name: "supabase", status: "offline", message: "Supabase admin client not initialized" };
  }
  try {
    const { error } = await supabaseAdmin.from("github_installations").select("id", { count: "exact", head: true });
    if (error) throw error;
    return { name: "supabase", status: "healthy", message: "Database reachable", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "supabase", status: "offline", message: err instanceof Error ? err.message : "Supabase check failed", latencyMs: Date.now() - start };
  }
}

async function checkTerminalServer(): Promise<HealthCheck> {
  const start = Date.now();
  if (!TERMINAL_SERVER_URL) {
    return { name: "terminal-server", status: "misconfigured", message: "TERMINAL_SERVER_URL not configured" };
  }
  if (!process.env.TERMINAL_AUTH_SECRET || process.env.TERMINAL_AUTH_SECRET.length < 32) {
    return { name: "terminal-server", status: "misconfigured", message: "TERMINAL_AUTH_SECRET missing or too short" };
  }
  try {
    const res = await fetch(`${TERMINAL_SERVER_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const dockerOk = data.docker === true;
    return {
      name: "terminal-server",
      status: dockerOk ? "healthy" : "degraded",
      message: dockerOk ? "Terminal server online, Docker available" : "Terminal server online, Docker not available",
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      name: "terminal-server",
      status: "offline",
      message: err instanceof Error ? err.message : "Terminal server unreachable",
      latencyMs: Date.now() - start,
    };
  }
}

async function checkVercel(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.VERCEL_TOKEN) {
    return { name: "vercel", status: "misconfigured", message: "VERCEL_TOKEN missing" };
  }
  try {
    const res = await fetch("https://api.vercel.com/v9/user", {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Vercel API ${res.status}`);
    return { name: "vercel", status: "healthy", message: "Vercel token valid", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "vercel", status: "offline", message: err instanceof Error ? err.message : "Vercel check failed", latencyMs: Date.now() - start };
  }
}

async function checkStripe(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.STRIPE_SECRET_KEY) {
    return { name: "stripe", status: "misconfigured", message: "STRIPE_SECRET_KEY missing" };
  }
  try {
    const res = await fetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) throw new Error(`Stripe API ${res.status}`);
    return { name: "stripe", status: "healthy", message: "Stripe key valid", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "stripe", status: "offline", message: err instanceof Error ? err.message : "Stripe check failed", latencyMs: Date.now() - start };
  }
}

async function checkOpenRouter(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.OPENROUTER_API_KEY) {
    return { name: "openrouter", status: "misconfigured", message: "OPENROUTER_API_KEY missing" };
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    if (!res.ok) throw new Error(`OpenRouter API ${res.status}`);
    return { name: "openrouter", status: "healthy", message: "OpenRouter key valid", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "openrouter", status: "offline", message: err instanceof Error ? err.message : "OpenRouter check failed", latencyMs: Date.now() - start };
  }
}

async function checkN8n(): Promise<HealthCheck> {
  const start = Date.now();
  const url = process.env.N8N_WEBHOOK_URL || process.env.N8N_BASE_URL;
  if (!url) {
    return { name: "n8n", status: "misconfigured", message: "N8N_WEBHOOK_URL or N8N_BASE_URL missing" };
  }
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok && res.status !== 405) throw new Error(`n8n HTTP ${res.status}`);
    return { name: "n8n", status: "healthy", message: "n8n reachable", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "n8n", status: "offline", message: err instanceof Error ? err.message : "n8n check failed", latencyMs: Date.now() - start };
  }
}

async function checkWorker(): Promise<HealthCheck> {
  if (!supabaseAdmin) {
    return { name: "worker", status: "offline", message: "Supabase admin client not initialized" };
  }
  try {
    const { data, error } = await supabaseAdmin
      .from("worker_heartbeats")
      .select("worker_id, status, last_seen_at")
      .order("last_seen_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    if (!data || data.length === 0) {
      return { name: "worker", status: "offline", message: "No worker heartbeats found" };
    }
    const row = data[0];
    const lastSeen = new Date(row.last_seen_at).getTime();
    const stale = Date.now() - lastSeen > OFFLINE_THRESHOLD_MS;
    if (stale) {
      return { name: "worker", status: "offline", message: `Last seen ${Math.round((Date.now() - lastSeen) / 1000)}s ago` };
    }
    const reported = row.status as ServiceStatus;
    return {
      name: "worker",
      status: reported === "healthy" ? "healthy" : reported,
      message: reported === "healthy" ? "Worker online" : `Worker reports ${reported}`,
    };
  } catch (err) {
    return { name: "worker", status: "offline", message: err instanceof Error ? err.message : "Worker check failed" };
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks = await Promise.all([
    checkClerk(),
    checkGitHub(),
    checkSupabase(),
    checkTerminalServer(),
    checkVercel(),
    checkStripe(),
    checkOpenRouter(),
    checkN8n(),
    checkWorker(),
  ]);

  const overall: ServiceStatus = checks.some((c) => c.status === "offline")
    ? "offline"
    : checks.some((c) => c.status === "misconfigured")
      ? "misconfigured"
      : checks.some((c) => c.status === "degraded")
        ? "degraded"
        : "healthy";

  const response: StudioHealthResponse = {
    status: overall,
    ready: overall === "healthy",
    checks,
    timestamp: new Date().toISOString(),
  };

  const statusCode = response.ready ? 200 : 503;
  return NextResponse.json(response, { status: statusCode });
}
