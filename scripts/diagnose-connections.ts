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

function checkEnv(keys: string[]): { present: boolean; missing: string[] } {
  const missing = keys.filter((k) => {
    const v = process.env[k];
    return !v || v.length < 5 || v.includes("your-") || v.includes("placeholder");
  });
  return { present: missing.length === 0, missing };
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

  for (const [id, envKeys] of Object.entries(INTEGRATION_ENV_REQUIREMENTS)) {
    const { present, missing } = checkEnv(envKeys);
    const label = id.charAt(0).toUpperCase() + id.slice(1);

    if (present) {
      printResult(`${label} platform key present`, "PASS");
      passCount++;

      // Run health test
      const health = await testHealth(id);
      if (health.ok === true) {
        printResult(`${label} provider responded`, "PASS");
        passCount++;
      } else if (health.ok === false) {
        printResult(`${label} provider responded`, "FAIL", health.detail);
        failCount++;
      } else {
        printResult(`${label} provider responded`, "WARN", health.detail);
        warnCount++;
      }
    } else {
      const isOptional = ["groq", "openai", "anthropic", "vercel", "r2", "stripe"].includes(id);
      if (isOptional) {
        printResult(`${label} platform key present`, "WARN", `Missing: ${missing.join(", ")} (optional)`);
        warnCount++;
      } else {
        printResult(`${label} platform key present`, "FAIL", `Missing: ${missing.join(", ")}`);
        failCount++;
      }
    }

    // Special checks
    if (id === "stripe" && present) {
      const webhook = process.env.STRIPE_WEBHOOK_SECRET;
      if (webhook) {
        printResult("Stripe webhook configured", "PASS");
        passCount++;
      } else {
        printResult("Stripe webhook configured", "WARN", "STRIPE_WEBHOOK_SECRET not set");
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

  // WebSocket URL
  const wsUrl = process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
  if (wsUrl) {
    printResult("Terminal WebSocket URL configured", "PASS");
    passCount++;
  } else {
    printResult("Terminal WebSocket URL configured", "FAIL", "NEXT_PUBLIC_TERMINAL_WS_URL not set");
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
