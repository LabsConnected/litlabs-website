import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getAppOctokit } from "@/lib/github-app";

export const runtime = "nodejs";

export type HealthCheck = {
  name: string;
  status: "ok" | "error" | "not_configured";
  message: string;
  latencyMs?: number;
};

export type StudioHealthResponse = {
  ok: boolean;
  checks: HealthCheck[];
  timestamp: string;
};

async function checkGitHub(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.GITHUB_APP_ID || !process.env.GITHUB_PRIVATE_KEY) {
    return { name: "github", status: "not_configured", message: "GITHUB_APP_ID or GITHUB_PRIVATE_KEY missing" };
  }
  try {
    const octokit = await getAppOctokit();
    await octokit.rest.apps.getAuthenticated();
    return { name: "github", status: "ok", message: "GitHub App authenticated", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "github", status: "error", message: err instanceof Error ? err.message : "GitHub auth failed", latencyMs: Date.now() - start };
  }
}

async function checkSupabase(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { name: "supabase", status: "not_configured", message: "Supabase URL or service role key missing" };
  }
  if (!supabaseAdmin) {
    return { name: "supabase", status: "error", message: "Supabase admin client not initialized" };
  }
  try {
    const { error } = await supabaseAdmin.from("github_installations").select("id", { count: "exact", head: true });
    if (error) throw error;
    return { name: "supabase", status: "ok", message: "Database reachable", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "supabase", status: "error", message: err instanceof Error ? err.message : "Supabase check failed", latencyMs: Date.now() - start };
  }
}

async function checkVercel(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.VERCEL_TOKEN) {
    return { name: "vercel", status: "not_configured", message: "VERCEL_TOKEN missing" };
  }
  try {
    const res = await fetch("https://api.vercel.com/v9/user", {
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    });
    if (!res.ok) throw new Error(`Vercel API ${res.status}`);
    return { name: "vercel", status: "ok", message: "Vercel token valid", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "vercel", status: "error", message: err instanceof Error ? err.message : "Vercel check failed", latencyMs: Date.now() - start };
  }
}

async function checkStripe(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.STRIPE_SECRET_KEY) {
    return { name: "stripe", status: "not_configured", message: "STRIPE_SECRET_KEY missing" };
  }
  try {
    const res = await fetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    if (!res.ok) throw new Error(`Stripe API ${res.status}`);
    return { name: "stripe", status: "ok", message: "Stripe key valid", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "stripe", status: "error", message: err instanceof Error ? err.message : "Stripe check failed", latencyMs: Date.now() - start };
  }
}

async function checkOpenRouter(): Promise<HealthCheck> {
  const start = Date.now();
  if (!process.env.OPENROUTER_API_KEY) {
    return { name: "openrouter", status: "not_configured", message: "OPENROUTER_API_KEY missing" };
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
    });
    if (!res.ok) throw new Error(`OpenRouter API ${res.status}`);
    return { name: "openrouter", status: "ok", message: "OpenRouter key valid", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "openrouter", status: "error", message: err instanceof Error ? err.message : "OpenRouter check failed", latencyMs: Date.now() - start };
  }
}

async function checkN8n(): Promise<HealthCheck> {
  const start = Date.now();
  const url = process.env.N8N_WEBHOOK_URL || process.env.N8N_BASE_URL;
  if (!url) {
    return { name: "n8n", status: "not_configured", message: "N8N_WEBHOOK_URL or N8N_BASE_URL missing" };
  }
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok && res.status !== 405) throw new Error(`n8n HTTP ${res.status}`);
    return { name: "n8n", status: "ok", message: "n8n reachable", latencyMs: Date.now() - start };
  } catch (err) {
    return { name: "n8n", status: "error", message: err instanceof Error ? err.message : "n8n check failed", latencyMs: Date.now() - start };
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks = await Promise.all([
    checkGitHub(),
    checkSupabase(),
    checkVercel(),
    checkStripe(),
    checkOpenRouter(),
    checkN8n(),
  ]);

  const ok = checks.every((c) => c.status === "ok" || c.status === "not_configured");
  const response: StudioHealthResponse = { ok, checks, timestamp: new Date().toISOString() };
  return NextResponse.json(response);
}
