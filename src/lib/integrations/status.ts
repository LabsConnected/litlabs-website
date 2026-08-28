import { checkEnvVars, INTEGRATION_ENV_REQUIREMENTS, type IntegrationStatus, type IntegrationStatusResponse } from "./types";
import { getTerminalServerUrl } from "@/lib/terminal-url";

const HEALTH_CACHE_TTL_MS = 30_000;
const healthCache = new Map<string, { result: boolean | null; timestamp: number }>();

function getCachedHealth(id: string): boolean | null {
  const entry = healthCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > HEALTH_CACHE_TTL_MS) {
    healthCache.delete(id);
    return null;
  }
  return entry.result;
}

function setCachedHealth(id: string, result: boolean | null) {
  healthCache.set(id, { result, timestamp: Date.now() });
}

async function testGeminiHealth(): Promise<boolean | null> {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=1`,
      { signal: AbortSignal.timeout(5000) },
    );
    return res.ok;
  } catch {
    return null;
  }
}

async function testOpenRouterHealth(): Promise<boolean | null> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return null;
  }
}

async function testGroqHealth(): Promise<boolean | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return null;
  }
}

async function testSupabaseHealth(): Promise<boolean | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return null;
  }
}

async function testStripeHealth(): Promise<{ keyOk: boolean | null; webhookOk: boolean | null }> {
  const key = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!key) return { keyOk: false, webhookOk: !!webhookSecret };
  try {
    const res = await fetch("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    return { keyOk: res.ok, webhookOk: !!webhookSecret };
  } catch {
    return { keyOk: null, webhookOk: !!webhookSecret };
  }
}

async function testR2Health(): Promise<boolean | null> {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKey || !secretKey || !bucket) return false;
  return true;
}

async function testTerminalHealth(): Promise<{ serverReachable: boolean; url: string | null }> {
  const endpoint = getTerminalServerUrl();
  try {
    const res = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    return { serverReachable: res.ok, url: endpoint };
  } catch {
    return { serverReachable: false, url: endpoint };
  }
}

export async function buildIntegrationStatus(
  userId: string | null,
): Promise<IntegrationStatusResponse> {
  const now = new Date().toISOString();
  const integrations: IntegrationStatus[] = [];

  // ── Clerk ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.clerk);
    integrations.push({
      id: "clerk",
      displayName: "Clerk Auth",
      category: "required",
      platformConfigured: allPresent,
      userConnected: !!userId,
      workspaceReady: !!userId,
      state: allPresent && userId ? "ready" : allPresent ? "user_not_connected" : "platform_missing",
      details: allPresent ? (userId ? "Authenticated" : "Platform ready — sign in to connect") : "Missing env vars",
      lastVerifiedAt: now,
      actions: allPresent
        ? userId
          ? [{ id: "signout", label: "Sign out", type: "disconnect" }]
          : [{ id: "signin", label: "Sign in", type: "connect" }]
        : [{ id: "configure", label: "Configure", type: "configure" }],
    });
  }

  // ── Supabase ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.supabase);
    let health: boolean | null = null;
    if (allPresent) {
      const cached = getCachedHealth("supabase");
      if (cached !== null) {
        health = cached;
      } else {
        health = await testSupabaseHealth();
        setCachedHealth("supabase", health);
      }
    }
    const isReady = allPresent && health === true;
    integrations.push({
      id: "supabase",
      displayName: "Supabase",
      category: "required",
      platformConfigured: allPresent,
      userConnected: allPresent,
      workspaceReady: isReady,
      state: isReady
        ? "ready"
        : allPresent
          ? health === null
            ? "platform_configured"
            : "error"
          : "platform_missing",
      details: isReady
        ? "Database reachable"
        : allPresent
          ? health === false
            ? "Database unreachable"
            : "Configured — health not verified"
          : "Missing env vars",
      lastVerifiedAt: now,
      actions: isReady
        ? [{ id: "test", label: "Test", type: "test" }]
        : allPresent
          ? [{ id: "test", label: "Test connection", type: "test" }]
          : [{ id: "configure", label: "Configure", type: "configure" }],
    });
  }

  // ── GitHub ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.github);
    let userInstalled = false;
    let repoSelected = false;
    if (allPresent && userId) {
      try {
        const { supabaseAdmin } = await import("@/lib/supabase");
        const { data: installations } = await supabaseAdmin
          .from("github_installations")
          .select("installation_id")
          .eq("user_id", userId);
        userInstalled = !!(installations && installations.length > 0);
        if (userInstalled) {
          const { data: projects } = await supabaseAdmin
            .from("projects")
            .select("id, repository_full_name")
            .eq("user_id", userId)
            .limit(1);
          repoSelected = !!(projects && projects.length > 0);
        }
      } catch {
        // DB error — leave as not connected
      }
    }
    const isReady = allPresent && userInstalled && repoSelected;
    integrations.push({
      id: "github",
      displayName: "GitHub",
      category: "code",
      platformConfigured: allPresent,
      userConnected: userInstalled,
      workspaceReady: repoSelected,
      state: isReady
        ? "ready"
        : allPresent
          ? userInstalled
            ? repoSelected
              ? "ready"
              : "needs_setup"
            : "user_not_connected"
          : "platform_missing",
      details: isReady
        ? "Repository connected"
        : allPresent
          ? userInstalled
            ? "Installed — choose a repository"
            : "Platform ready — install GitHub App"
          : "Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY",
      lastVerifiedAt: now,
      actions: isReady
        ? [
            { id: "manage", label: "Manage", type: "open_settings" },
            { id: "disconnect", label: "Disconnect", type: "disconnect" },
          ]
        : allPresent
          ? userInstalled
            ? [{ id: "select_repo", label: "Choose repository", type: "select_repository" }]
            : [{ id: "install", label: "Install GitHub App", type: "connect" }]
          : [{ id: "configure", label: "Configure", type: "configure" }],
    });
  }

  // ── Vercel ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.vercel);
    integrations.push({
      id: "vercel",
      displayName: "Vercel",
      category: "optional",
      platformConfigured: allPresent,
      userConnected: allPresent,
      workspaceReady: allPresent,
      state: allPresent ? "ready" : "platform_missing",
      details: allPresent ? "Deploy token configured" : "Optional — not configured",
      lastVerifiedAt: now,
      actions: allPresent
        ? [{ id: "test", label: "Test", type: "test" }]
        : [{ id: "configure", label: "Configure", type: "configure" }],
    });
  }

  // ── R2 ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.r2);
    let health: boolean | null = null;
    if (allPresent) {
      const cached = getCachedHealth("r2");
      if (cached !== null) {
        health = cached;
      } else {
        health = await testR2Health();
        setCachedHealth("r2", health);
      }
    }
    const isReady = allPresent && health === true;
    integrations.push({
      id: "r2",
      displayName: "Cloudflare R2",
      category: "optional",
      platformConfigured: allPresent,
      userConnected: allPresent,
      workspaceReady: isReady,
      state: isReady ? "ready" : allPresent ? "platform_configured" : "platform_missing",
      details: isReady ? "Bucket access verified" : allPresent ? "Credentials present — verify bucket" : "Optional — not configured",
      lastVerifiedAt: now,
      actions: isReady
        ? [{ id: "test", label: "Test", type: "test" }]
        : allPresent
          ? [{ id: "test", label: "Test bucket", type: "test" }]
          : [{ id: "configure", label: "Configure", type: "configure" }],
    });
  }

  // ── Stripe ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.stripe);
    let keyOk: boolean | null = null;
    let webhookOk: boolean | null = null;
    if (allPresent) {
      const cached = getCachedHealth("stripe");
      if (cached !== null) {
        keyOk = cached;
        webhookOk = !!process.env.STRIPE_WEBHOOK_SECRET;
      } else {
        const result = await testStripeHealth();
        keyOk = result.keyOk;
        webhookOk = result.webhookOk;
        setCachedHealth("stripe", keyOk);
      }
    }
    const isReady = allPresent && keyOk === true;
    const hasWebhook = webhookOk === true;
    integrations.push({
      id: "stripe",
      displayName: "Stripe",
      category: "optional",
      platformConfigured: allPresent,
      userConnected: allPresent,
      workspaceReady: isReady && hasWebhook,
      state: isReady && hasWebhook
        ? "ready"
        : isReady
          ? "needs_setup"
          : allPresent
            ? "error"
            : "platform_missing",
      details: isReady && hasWebhook
        ? "Payments + webhook ready"
        : isReady
          ? "API key valid — webhook not configured"
          : allPresent
            ? "API key not verified"
            : "Optional — not configured",
      lastVerifiedAt: now,
      actions: isReady
        ? [{ id: "test", label: "Test", type: "test" }]
        : allPresent
          ? [{ id: "repair", label: "Repair", type: "repair" }]
          : [{ id: "configure", label: "Configure", type: "configure" }],
    });
  }

  // ── Gemini ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.gemini);
    let health: boolean | null = null;
    if (allPresent) {
      const cached = getCachedHealth("gemini");
      if (cached !== null) {
        health = cached;
      } else {
        health = await testGeminiHealth();
        setCachedHealth("gemini", health);
      }
    }
    const isReady = allPresent && health === true;
    integrations.push({
      id: "gemini",
      displayName: "Google AI Studio",
      category: "ai",
      platformConfigured: allPresent,
      userConnected: allPresent,
      workspaceReady: isReady,
      state: isReady ? "ready" : allPresent ? health === null ? "platform_configured" : "error" : "platform_missing",
      details: isReady ? "Gemini API available" : allPresent ? "Key present — health not verified" : "Not configured",
      lastVerifiedAt: now,
      actions: isReady
        ? [{ id: "test", label: "Test", type: "test" }, { id: "default", label: "Set default", type: "set_default" }]
        : allPresent
          ? [{ id: "test", label: "Test", type: "test" }]
          : [{ id: "add_key", label: "Add key", type: "add_key" }],
    });
  }

  // ── OpenRouter ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.openrouter);
    let health: boolean | null = null;
    if (allPresent) {
      const cached = getCachedHealth("openrouter");
      if (cached !== null) {
        health = cached;
      } else {
        health = await testOpenRouterHealth();
        setCachedHealth("openrouter", health);
      }
    }
    const isReady = allPresent && health === true;
    integrations.push({
      id: "openrouter",
      displayName: "OpenRouter",
      category: "ai",
      platformConfigured: allPresent,
      userConnected: allPresent,
      workspaceReady: isReady,
      state: isReady ? "ready" : allPresent ? health === null ? "platform_configured" : "error" : "platform_missing",
      details: isReady ? "Model list available" : allPresent ? "Key present — model route not verified" : "Not configured",
      lastVerifiedAt: now,
      actions: isReady
        ? [{ id: "test", label: "Test", type: "test" }]
        : allPresent
          ? [{ id: "test", label: "Test", type: "test" }]
          : [{ id: "add_key", label: "Add key", type: "add_key" }],
    });
  }

  // ── Groq ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.groq);
    let health: boolean | null = null;
    if (allPresent) {
      const cached = getCachedHealth("groq");
      if (cached !== null) {
        health = cached;
      } else {
        health = await testGroqHealth();
        setCachedHealth("groq", health);
      }
    }
    const isReady = allPresent && health === true;
    integrations.push({
      id: "groq",
      displayName: "Groq",
      category: "ai",
      platformConfigured: allPresent,
      userConnected: allPresent,
      workspaceReady: isReady,
      state: isReady ? "ready" : allPresent ? "platform_configured" : "platform_missing",
      details: isReady ? "Groq API available" : allPresent ? "Key present" : "Optional — not configured",
      lastVerifiedAt: now,
      actions: isReady
        ? [{ id: "test", label: "Test", type: "test" }]
        : allPresent
          ? [{ id: "test", label: "Test", type: "test" }]
          : [{ id: "add_key", label: "Add key", type: "add_key" }],
    });
  }

  // ── OpenAI (optional BYOK) ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.openai);
    integrations.push({
      id: "openai",
      displayName: "OpenAI",
      category: "optional",
      platformConfigured: allPresent,
      userConnected: allPresent,
      workspaceReady: allPresent,
      state: allPresent ? "ready" : "platform_missing",
      details: allPresent ? "Key present" : "Optional BYOK — not configured",
      lastVerifiedAt: now,
      actions: allPresent
        ? [{ id: "test", label: "Test", type: "test" }, { id: "remove_key", label: "Remove key", type: "remove_key" }]
        : [{ id: "add_key", label: "Add key", type: "add_key" }],
    });
  }

  // ── Anthropic (optional BYOK) ──
  {
    const { allPresent } = checkEnvVars(INTEGRATION_ENV_REQUIREMENTS.anthropic);
    integrations.push({
      id: "anthropic",
      displayName: "Anthropic",
      category: "optional",
      platformConfigured: allPresent,
      userConnected: allPresent,
      workspaceReady: allPresent,
      state: allPresent ? "ready" : "platform_missing",
      details: allPresent ? "Key present" : "Optional BYOK — not configured",
      lastVerifiedAt: now,
      actions: allPresent
        ? [{ id: "test", label: "Test", type: "test" }, { id: "remove_key", label: "Remove key", type: "remove_key" }]
        : [{ id: "add_key", label: "Add key", type: "add_key" }],
    });
  }

  // ── Terminal Runtime ──
  {
    const termHealth = await testTerminalHealth();
    const isReady = termHealth.serverReachable;
    integrations.push({
      id: "terminal",
      displayName: "Terminal Runtime",
      category: "runtime",
      platformConfigured: !!termHealth.url,
      userConnected: termHealth.serverReachable,
      workspaceReady: isReady,
      state: isReady
        ? "ready"
        : termHealth.url
          ? "error"
          : "platform_missing",
      details: isReady
        ? "Terminal server reachable"
        : termHealth.url
          ? "Server unreachable — start terminal:dev"
          : "NEXT_PUBLIC_TERMINAL_WS_URL not set",
      lastVerifiedAt: now,
      actions: isReady
        ? [{ id: "diagnostics", label: "Diagnostics", type: "run_diagnostics" }]
        : [{ id: "setup", label: "Open setup", type: "configure" }, { id: "retry", label: "Retry", type: "test" }],
    });
  }

  // Summary
  const platformReady = integrations.filter((i) => i.platformConfigured).length;
  const platformNeedsConfig = integrations.filter((i) => !i.platformConfigured && i.category !== "optional").length;
  const optional = integrations.filter((i) => i.category === "optional").length;
  const userConnected = integrations.filter((i) => i.userConnected).length;
  const userNotConnected = integrations.filter((i) => !i.userConnected).length;
  const workspaceReady = integrations.filter((i) => i.workspaceReady).length;

  return {
    integrations,
    summary: {
      platformReady,
      platformNeedsConfig,
      optional,
      userConnected,
      userNotConnected,
      workspaceReady,
    },
  };
}
