#!/usr/bin/env tsx
/**
 * pnpm diagnose:connections
 *
 * Runs a full diagnostic of all integration environment variables and
 * provider health. Never prints secret values.
 */

const INTEGRATION_ENV_REQUIREMENTS: Record<string, string[]> = {
  clerk: ["NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "CLERK_SECRET_KEY"],
  supabase: ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  github: ["GITHUB_APP_ID", "GITHUB_PRIVATE_KEY"],
  vercel: ["VERCEL_TOKEN", "VERCEL_PROJECT_ID"],
  r2: ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"],
  stripe: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  gemini: ["GEMINI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  groq: ["GROQ_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
};

interface EnvStatus {
  key: string;
  local: boolean;
  preview: boolean;
  production: boolean;
}

async function fetchVercelEnvs(token: string, projectId: string): Promise<Record<string, string[]>> {
  try {
    const res = await fetch(`https://api.vercel.com/v9/projects/${projectId}/env`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return {};
    const data = await res.json();
    
    const envMap: Record<string, string[]> = {};
    for (const env of data.envs || []) {
       if (!envMap[env.key]) envMap[env.key] = [];
       envMap[env.key].push(...(env.target || []));
    }
    return envMap;
  } catch (err) {
    return {};
  }
}

function checkEnv(keys: string[], vercelEnvs: Record<string, string[]>): EnvStatus[] {
  return keys.map((k) => {
    const v = process.env[k];
    const local = Boolean(v && v.length >= 5 && !v.includes("your-") && !v.includes("placeholder"));
    
    const targets = vercelEnvs[k] || [];
    const preview = targets.includes("preview");
    const production = targets.includes("production");
    
    return { key: k, local, preview, production };
  });
}

function printResult(label: string, status: "PASS" | "FAIL" | "WARN", detail?: string) {
  const colors = { PASS: "\x1b[32m", FAIL: "\x1b[31m", WARN: "\x1b[33m" };
  const reset = "\x1b[0m";
  console.log(`[${colors[status]}${status}${reset}] ${label}${detail ? ` — ${detail}` : ""}`);
}

async function testHealth(
  id: string,
): Promise<{ ok: boolean | null; detail?: string }> {
  try {
    switch (id) {
      case "gemini": {
        const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        if (!key) return { ok: false, detail: "No key" };
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=1`,
          { signal: AbortSignal.timeout(5000) },
        );
        return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
      }
      case "openrouter": {
        const key = process.env.OPENROUTER_API_KEY;
        if (!key) return { ok: false, detail: "No key" };
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
      }
      case "groq": {
        const key = process.env.GROQ_API_KEY;
        if (!key) return { ok: false, detail: "No key" };
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
      }
      case "supabase": {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) return { ok: false, detail: "No URL or key" };
        const res = await fetch(`${url}/rest/v1/`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
      }
      case "stripe": {
        const key = process.env.STRIPE_SECRET_KEY;
        if (!key) return { ok: false, detail: "No key" };
        const res = await fetch("https://api.stripe.com/v1/account", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(5000),
        });
        return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
      }
      case "terminal": {
        const explicit = process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL;
        const ws = process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
        const endpoint = explicit
          ? explicit.replace(/\/$/, "")
          : ws?.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "") || "";
        if (!endpoint) return { ok: false, detail: "No terminal URL configured" };
        const res = await fetch(`${endpoint}/health`, {
          signal: AbortSignal.timeout(4000),
        });
        return { ok: res.ok, detail: res.ok ? undefined : `HTTP ${res.status}` };
      }
      default:
        return { ok: null, detail: "No health check implemented" };
    }
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : "Request failed" };
  }
}

async function main() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   LiTTree Connection Diagnostics             ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  let passCount = 0;
  let failCount = 0;
  let warnCount = 0;

  const vercelToken = process.env.VERCEL_TOKEN;
  const vercelProject = process.env.VERCEL_PROJECT_ID;
  let vercelEnvs: Record<string, string[]> = {};
  let vercelConnected = false;

  if (vercelToken && vercelProject) {
    vercelEnvs = await fetchVercelEnvs(vercelToken, vercelProject);
    vercelConnected = Object.keys(vercelEnvs).length > 0;
    if (vercelConnected) {
      printResult("Vercel API Connected", "PASS", "Fetched remote environments");
      passCount++;
    } else {
      printResult("Vercel API Connected", "WARN", "Failed to fetch remote environments or none configured");
      warnCount++;
    }
  } else {
    printResult("Vercel API", "WARN", "Skipping remote check (VERCEL_TOKEN or VERCEL_PROJECT_ID missing locally)");
    warnCount++;
  }

  for (const [id, envKeys] of Object.entries(INTEGRATION_ENV_REQUIREMENTS)) {
    const statuses = checkEnv(envKeys, vercelEnvs);
    const label = id.charAt(0).toUpperCase() + id.slice(1);
    const isOptional = ["groq", "openai", "anthropic", "vercel", "r2", "stripe"].includes(id);

    const missingLocally = statuses.filter((s) => !s.local).map((s) => s.key);
    
    // Local check
    if (missingLocally.length === 0) {
      printResult(`${label} platform key present locally`, "PASS");
      passCount++;

      // Run health test
      const health = await testHealth(id);
      if (health.ok === true) {
        printResult(`${label} provider responded`, "PASS");
        passCount++;
      } else if (health.ok === false) {
        const isAuthError = health.detail?.includes("401") || health.detail?.includes("403");
        const msg = isAuthError ? "Present but invalid (e.g. 401/403)" : "Configured but service unreachable";
        printResult(`${label} provider responded`, "FAIL", `${msg} — ${health.detail}`);
        failCount++;
      } else {
        printResult(`${label} provider responded`, "WARN", health.detail);
        warnCount++;
      }
    } else {
      if (isOptional) {
        printResult(`${label} platform key present locally`, "WARN", `Missing locally (.env.local): ${missingLocally.join(", ")} (optional)`);
        warnCount++;
      } else {
        printResult(`${label} platform key present locally`, "FAIL", `Missing locally (.env.local): ${missingLocally.join(", ")}`);
        failCount++;
      }
    }

    // Remote checks
    if (vercelConnected) {
      const missingPreview = statuses.filter((s) => !s.preview).map((s) => s.key);
      const missingProd = statuses.filter((s) => !s.production).map((s) => s.key);

      if (missingPreview.length > 0) {
        printResult(`${label} keys in Vercel Preview`, isOptional ? "WARN" : "FAIL", `Missing in Vercel Preview: ${missingPreview.join(", ")}`);
        if (isOptional) warnCount++; else failCount++;
      } else {
        printResult(`${label} keys in Vercel Preview`, "PASS");
        passCount++;
      }

      if (missingProd.length > 0) {
        printResult(`${label} keys in Vercel Production`, isOptional ? "WARN" : "FAIL", `Missing in Vercel Production: ${missingProd.join(", ")}`);
        if (isOptional) warnCount++; else failCount++;
      } else {
        printResult(`${label} keys in Vercel Production`, "PASS");
        passCount++;
      }
    }

    // Special checks (e.g., Stripe Webhook)
    if (id === "stripe" && missingLocally.length === 0) {
      const webhook = process.env.STRIPE_WEBHOOK_SECRET;
      if (webhook) {
        printResult("Stripe webhook configured locally", "PASS");
        passCount++;
      } else {
        printResult("Stripe webhook configured locally", "WARN", "STRIPE_WEBHOOK_SECRET not set in .env.local");
        warnCount++;
      }
    }
  }

  // Terminal check
  const termHealth = await testHealth("terminal");
  if (termHealth.ok === true) {
    printResult("Terminal server reachable", "PASS");
    passCount++;
  } else {
    printResult("Terminal server reachable", "FAIL", termHealth.detail);
    failCount++;
  }

  // WebSocket URL check
  const wsUrl = process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
  if (wsUrl) {
    if (wsUrl.includes("localhost")) {
      printResult("Terminal WebSocket URL configured locally", "WARN", `Using localhost URL: ${wsUrl} (ensure this is intentional)`);
      warnCount++;
    } else {
      printResult("Terminal WebSocket URL configured locally", "PASS");
      passCount++;
    }
  } else {
    printResult("Terminal WebSocket URL configured locally", "FAIL", "NEXT_PUBLIC_TERMINAL_WS_URL not set in .env.local");
    failCount++;
  }

  console.log(`\n${"─".repeat(50)}`);
  console.log(`Results: ${passCount} PASS, ${warnCount} WARN, ${failCount} FAIL\n`);

  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
