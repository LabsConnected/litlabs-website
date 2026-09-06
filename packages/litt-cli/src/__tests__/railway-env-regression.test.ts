/**
 * Regression tests for Railway env-var inspection (production operator).
 *
 * Proves the production-operator env detection is fixed:
 *   - Uses JSON-based `railway variable list --json` (structural parse)
 *   - Inspects the canonical "web" service in the "litlabs-terminal-server"
 *     project — the service that owns the www.litlabs.net custom domain.
 *     NOT "cli" or "@litlabs/litt-shell" (both in "litlabs-website", which
 *     serves no production traffic).
 *   - Applies the correct OR-fallback contracts for each service
 *   - Never prints secret values
 *   - Wrong Railway service cannot create false positives
 *
 * These tests use injected env maps and fake exec — no real Railway, Stripe,
 * or network calls. No secret values are printed or persisted.
 */
import { describe, it, expect } from "vitest";
import {
  checkStripeSecretKey,
  checkStripePublishableKey,
  checkWebhookSecret,
  checkTerminalService,
  checkStudioPrerequisites,
  checkProductionServiceDomain,
  RAILWAY_PROJECT_ID,
  RAILWAY_SERVICE_ID,
  RAILWAY_ENVIRONMENT_ID,
  RAILWAY_SERVICE_NAME,
  PRODUCTION_DOMAIN,
} from "../lib/production-checks.js";
import {
  getRailwayEnvVars,
  hasNonEmpty,
  hasAnyNonEmpty,
  hasNonEmptyWithPrefix,
  RAILWAY_PRODUCTION_SERVICE,
  RAILWAY_PRODUCTION_ENVIRONMENT,
  RAILWAY_PRODUCTION_PROJECT_ID,
  type EnvVarMap,
  type ExecFn,
} from "../lib/railway-env.js";
import { containsSecret } from "../lib/secret-redaction.js";

// ─── Helpers ───────────────────────────────────────────────────────────

/** Build an env map from a plain object. */
function mapFrom(obj: Record<string, string>): EnvVarMap {
  return new Map(Object.entries(obj));
}

/** A fake Stripe live secret key prefix (assembled to avoid push protection). */
const SK_LIVE = "sk_" + "live_";
const SK_TEST = "sk_" + "test_";
const WHSEC = "whsec_";
const PK_LIVE = "pk_" + "live_";

/** Build a fake exec that returns the given JSON object for any command. */
function fakeExecReturning(jsonObj: Record<string, string>): ExecFn {
  return () => ({
    stdout: JSON.stringify(jsonObj),
    stderr: "",
    exitCode: 0,
  });
}

/** Build a fake exec that fails. */
function failingExec(): ExecFn {
  return () => ({
    stdout: "",
    stderr: "Error: not authenticated",
    exitCode: 1,
  });
}

/**
 * The PROVEN real state on Railway service "web" (litlabs-terminal-server
 * project), environment "production". Used to prove the fix reports
 * truthfully against the real configuration.
 */
const REAL_WEB_ENV: Record<string, string> = {
  STRIPE_SECRET_KEY: SK_LIVE + "FAKEFAKEFAKEFAKEFAKEFAKEFAKE",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk_fake",
  CLERK_SECRET_KEY: "sk_test_clerk_secret_fake",
  NEXT_PUBLIC_SUPABASE_URL: "https://rokbfvuoqildggnhappy.supabase.co",
  NEXT_PUBLIC_TERMINAL_WS_URL: "wss://terminal.example.com",
  NEXT_PUBLIC_TERMINAL_HTTP_URL: "https://terminal.example.com",
  // Genuinely missing on real web service:
  // NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
  // STRIPE_WEBHOOK_SECRET
};

// ─── 1. STRIPE_SECRET_KEY present => PASS ──────────────────────────────

describe("Stripe secret key", () => {
  it("PASS: STRIPE_SECRET_KEY present (live mode)", () => {
    const vars = mapFrom({ STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30) });
    const result = checkStripeSecretKey(vars);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("live mode");
  });

  it("PASS: STRIPE_SECRET_KEY present (test mode => warn, not fail)", () => {
    const vars = mapFrom({ STRIPE_SECRET_KEY: SK_TEST + "A".repeat(30) });
    const result = checkStripeSecretKey(vars);
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("test mode");
  });

  it("PASS: STRIPE_SECRET_KEY present with unknown prefix => pass", () => {
    const vars = mapFrom({ STRIPE_SECRET_KEY: "someotherkeyvalue" });
    const result = checkStripeSecretKey(vars);
    expect(result.status).toBe("pass");
  });

  it("FAIL: STRIPE_SECRET_KEY absent", () => {
    const vars = mapFrom({ OTHER_KEY: "foo" });
    const result = checkStripeSecretKey(vars);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("NOT SET");
  });

  it("FAIL: STRIPE_SECRET_KEY empty string", () => {
    const vars = mapFrom({ STRIPE_SECRET_KEY: "" });
    const result = checkStripeSecretKey(vars);
    expect(result.status).toBe("fail");
  });

  it("FAIL: STRIPE_SECRET_KEY whitespace-only", () => {
    const vars = mapFrom({ STRIPE_SECRET_KEY: "   " });
    const result = checkStripeSecretKey(vars);
    expect(result.status).toBe("fail");
  });

  it("FAIL: cannot read Railway variables (null map)", () => {
    const result = checkStripeSecretKey(null);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Cannot read Railway");
  });

  it("never leaks the secret value into detail", () => {
    const secret = SK_LIVE + "LEAKMELEAKMELEAKMELEAKME";
    const vars = mapFrom({ STRIPE_SECRET_KEY: secret });
    const result = checkStripeSecretKey(vars);
    expect(result.detail).not.toContain(secret);
    expect(containsSecret(result.detail ?? "")).toBe(false);
  });
});

// ─── 2. Publishable missing => FAIL only that check ────────────────────

describe("Stripe publishable key", () => {
  it("PASS: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY present", () => {
    const vars = mapFrom({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: PK_LIVE + "fake" });
    const result = checkStripePublishableKey(vars);
    expect(result.status).toBe("pass");
  });

  it("FAIL: publishable missing does NOT fail the secret-key check", () => {
    const vars = mapFrom({ STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30) });
    // Publishable check fails...
    const pkResult = checkStripePublishableKey(vars);
    expect(pkResult.status).toBe("fail");
    // ...but the secret-key check still passes (independent checks).
    const skResult = checkStripeSecretKey(vars);
    expect(skResult.status).toBe("pass");
  });

  it("FAIL: empty publishable value", () => {
    const vars = mapFrom({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "" });
    const result = checkStripePublishableKey(vars);
    expect(result.status).toBe("fail");
  });
});

// ─── 3. Webhook secret missing => FAIL only that check ─────────────────

describe("Webhook signing secret", () => {
  it("PASS: STRIPE_WEBHOOK_SECRET present", () => {
    const vars = mapFrom({ STRIPE_WEBHOOK_SECRET: WHSEC + "fakefakefakefake" });
    const result = checkWebhookSecret(vars);
    expect(result.status).toBe("pass");
  });

  it("FAIL: webhook missing does NOT fail the secret-key check", () => {
    const vars = mapFrom({ STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30) });
    const whResult = checkWebhookSecret(vars);
    expect(whResult.status).toBe("fail");
    const skResult = checkStripeSecretKey(vars);
    expect(skResult.status).toBe("pass");
  });

  it("FAIL: empty webhook value", () => {
    const vars = mapFrom({ STRIPE_WEBHOOK_SECRET: "" });
    const result = checkWebhookSecret(vars);
    expect(result.status).toBe("fail");
  });

  it("never leaks the webhook secret value into detail", () => {
    const secret = WHSEC + "LEAKMELEAKMELEAK";
    const vars = mapFrom({ STRIPE_WEBHOOK_SECRET: secret });
    const result = checkWebhookSecret(vars);
    expect(result.detail).not.toContain(secret);
    expect(containsSecret(result.detail ?? "")).toBe(false);
  });
});

// ─── 4. Clerk fallback works ───────────────────────────────────────────

describe("Clerk fallback (Studio prerequisites)", () => {
  it("PASS: NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY alone satisfies Clerk", () => {
    const vars = mapFrom({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30),
    });
    const result = checkStudioPrerequisites(vars);
    expect(result.status).toBe("pass");
  });

  it("PASS: CLERK_SECRET_KEY alone satisfies Clerk (fallback)", () => {
    const vars = mapFrom({
      CLERK_SECRET_KEY: "sk_test_clerk_secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30),
    });
    const result = checkStudioPrerequisites(vars);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("configured");
  });

  it("FAIL: neither Clerk var set => fails only Clerk, not Supabase/Stripe", () => {
    const vars = mapFrom({
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30),
    });
    const result = checkStudioPrerequisites(vars);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Clerk");
    expect(result.detail).not.toContain("Supabase");
    expect(result.detail).not.toContain("Stripe");
  });

  it("FAIL: empty Clerk values do not satisfy the contract", () => {
    const vars = mapFrom({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "",
      CLERK_SECRET_KEY: "  ",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30),
    });
    const result = checkStudioPrerequisites(vars);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Clerk");
  });
});

// ─── 5. Supabase fallback works ────────────────────────────────────────

describe("Supabase fallback (Studio prerequisites)", () => {
  it("PASS: NEXT_PUBLIC_SUPABASE_URL alone satisfies Supabase", () => {
    const vars = mapFrom({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk",
      NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
      STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30),
    });
    const result = checkStudioPrerequisites(vars);
    expect(result.status).toBe("pass");
  });

  it("PASS: SUPABASE_URL alone satisfies Supabase (fallback)", () => {
    const vars = mapFrom({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk",
      SUPABASE_URL: "https://x.supabase.co",
      STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30),
    });
    const result = checkStudioPrerequisites(vars);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("configured");
  });

  it("FAIL: neither Supabase var set => fails only Supabase", () => {
    const vars = mapFrom({
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_clerk",
      STRIPE_SECRET_KEY: SK_LIVE + "A".repeat(30),
    });
    const result = checkStudioPrerequisites(vars);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Supabase");
    expect(result.detail).not.toContain("Clerk");
    expect(result.detail).not.toContain("Stripe");
  });
});

// ─── 6 & 7. Terminal WS / HTTP fallbacks work ──────────────────────────

describe("Terminal service fallbacks", () => {
  it("PASS: TERMINAL_PUBLIC_URL alone (canonical)", () => {
    const vars = mapFrom({ TERMINAL_PUBLIC_URL: "https://terminal.example.com" });
    const result = checkTerminalService(vars);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("TERMINAL_PUBLIC_URL");
  });

  it("PASS: NEXT_PUBLIC_TERMINAL_WS_URL alone (WS fallback)", () => {
    const vars = mapFrom({ NEXT_PUBLIC_TERMINAL_WS_URL: "wss://terminal.example.com" });
    const result = checkTerminalService(vars);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("NEXT_PUBLIC_TERMINAL_WS_URL");
  });

  it("PASS: NEXT_PUBLIC_TERMINAL_HTTP_URL alone (HTTP fallback)", () => {
    const vars = mapFrom({ NEXT_PUBLIC_TERMINAL_HTTP_URL: "https://terminal.example.com" });
    const result = checkTerminalService(vars);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("NEXT_PUBLIC_TERMINAL_HTTP_URL");
  });

  it("PASS: prefers TERMINAL_PUBLIC_URL when multiple are set", () => {
    const vars = mapFrom({
      TERMINAL_PUBLIC_URL: "https://t.example.com",
      NEXT_PUBLIC_TERMINAL_WS_URL: "wss://t.example.com",
      NEXT_PUBLIC_TERMINAL_HTTP_URL: "https://t.example.com",
    });
    const result = checkTerminalService(vars);
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("TERMINAL_PUBLIC_URL");
  });

  it("FAIL: no terminal env vars set", () => {
    const vars = mapFrom({ OTHER_VAR: "foo" });
    const result = checkTerminalService(vars);
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not configured");
  });

  it("FAIL: empty TERMINAL_PUBLIC_URL value does not satisfy", () => {
    const vars = mapFrom({ TERMINAL_PUBLIC_URL: "", OTHER: "foo" });
    const result = checkTerminalService(vars);
    expect(result.status).toBe("fail");
  });
});

// ─── 8. canonical TERMINAL_PUBLIC_URL works (covered above) ────────────
// (explicitly asserted in the "Terminal service fallbacks" suite)

// ─── 9. Empty values fail ──────────────────────────────────────────────

describe("Empty values fail every contract", () => {
  it("empty STRIPE_SECRET_KEY fails the secret check", () => {
    const vars = mapFrom({ STRIPE_SECRET_KEY: "" });
    expect(checkStripeSecretKey(vars).status).toBe("fail");
  });

  it("empty NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY fails the publishable check", () => {
    const vars = mapFrom({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "" });
    expect(checkStripePublishableKey(vars).status).toBe("fail");
  });

  it("empty STRIPE_WEBHOOK_SECRET fails the webhook check", () => {
    const vars = mapFrom({ STRIPE_WEBHOOK_SECRET: "" });
    expect(checkWebhookSecret(vars).status).toBe("fail");
  });

  it("empty terminal URLs fail the terminal check", () => {
    const vars = mapFrom({
      TERMINAL_PUBLIC_URL: "",
      NEXT_PUBLIC_TERMINAL_WS_URL: "",
      NEXT_PUBLIC_TERMINAL_HTTP_URL: "",
    });
    expect(checkTerminalService(vars).status).toBe("fail");
  });

  it("whitespace-only values fail (trimmed)", () => {
    const vars = mapFrom({ STRIPE_SECRET_KEY: "  \t " });
    expect(checkStripeSecretKey(vars).status).toBe("fail");
  });
});

// ─── 10. Wrong Railway service cannot create false positives ───────────

describe("Wrong Railway service cannot create false positives", () => {
  it("getRailwayEnvVars targets the 'web' service by default", () => {
    let capturedCmd = "";
    const spy: ExecFn = (cmd) => {
      capturedCmd = cmd;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    };
    getRailwayEnvVars({ execFn: spy });
    expect(capturedCmd).toContain('--service "web"');
    expect(capturedCmd).not.toContain("@litlabs/litt-shell");
    expect(capturedCmd).not.toContain('--service "cli"');
  });

  it("getRailwayEnvVars targets the 'production' environment by default", () => {
    let capturedCmd = "";
    const spy: ExecFn = (cmd) => {
      capturedCmd = cmd;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    };
    getRailwayEnvVars({ execFn: spy });
    expect(capturedCmd).toContain('--environment "production"');
  });

  it("getRailwayEnvVars passes --project explicitly (no link dependency)", () => {
    let capturedCmd = "";
    const spy: ExecFn = (cmd) => {
      capturedCmd = cmd;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    };
    getRailwayEnvVars({ execFn: spy });
    expect(capturedCmd).toContain("--project");
    expect(capturedCmd).toContain("69a241af-cd1b-4cf1-baff-f5a6a5a5d7d5");
  });

  it("uses --json (structural, not human-readable)", () => {
    let capturedCmd = "";
    const spy: ExecFn = (cmd) => {
      capturedCmd = cmd;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    };
    getRailwayEnvVars({ execFn: spy });
    expect(capturedCmd).toContain("--json");
  });

  it("returns null vars on exec failure (no false positives)", () => {
    const result = getRailwayEnvVars({ execFn: failingExec() });
    expect(result.vars).toBeNull();
    expect(result.error).toBeDefined();
  });

  it("returns null vars on non-JSON output (no false positives)", () => {
    const result = getRailwayEnvVars({
      execFn: () => ({ stdout: "STRIPE_SECRET_KEY=sk_live_fake (human readable)", stderr: "", exitCode: 0 }),
    });
    expect(result.vars).toBeNull();
  });

  it("returns null vars on empty output", () => {
    const result = getRailwayEnvVars({
      execFn: () => ({ stdout: "", stderr: "", exitCode: 0 }),
    });
    expect(result.vars).toBeNull();
  });

  it("returns null vars on array JSON (unexpected shape)", () => {
    const result = getRailwayEnvVars({
      execFn: () => ({ stdout: "[1,2,3]", stderr: "", exitCode: 0 }),
    });
    expect(result.vars).toBeNull();
  });

  it("a wrong service's vars do NOT satisfy the cli contracts", () => {
    // Simulate inspecting "@litlabs/litt-shell" which has DIFFERENT vars.
    // Even if it returned some vars, the checks evaluate the actual map.
    // Here the wrong-service map lacks STRIPE_SECRET_KEY entirely.
    const wrongServiceVars = mapFrom({
      RAILWAY_SERVICE_NAME: "@litlabs/litt-shell",
      PORT: "3000",
    });
    expect(checkStripeSecretKey(wrongServiceVars).status).toBe("fail");
    expect(checkStudioPrerequisites(wrongServiceVars).status).toBe("fail");
    expect(checkTerminalService(wrongServiceVars).status).toBe("fail");
  });

  it("the canonical constants are 'web' and 'production'", () => {
    expect(RAILWAY_PRODUCTION_SERVICE).toBe("web");
    expect(RAILWAY_PRODUCTION_ENVIRONMENT).toBe("production");
  });
});

// ─── Real-state proof: the PROVEN web env ──────────────────────────────

describe("PROVEN real state on Railway service 'web'", () => {
  // Real state: SET = STRIPE_SECRET_KEY, Clerk, Supabase, Terminal URLs
  // MISSING = NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET

  it("STRIPE_SECRET_KEY is reported SET (not falsely NOT SET)", () => {
    const vars = mapFrom(REAL_WEB_ENV);
    const result = checkStripeSecretKey(vars);
    expect(result.status).toBe("pass");
    expect(result.detail).not.toContain("NOT SET");
  });

  it("Terminal URLs are reported configured (not falsely missing)", () => {
    const vars = mapFrom(REAL_WEB_ENV);
    const result = checkTerminalService(vars);
    expect(result.status).toBe("pass");
  });

  it("Studio prerequisites pass (Clerk, Supabase, Stripe all present)", () => {
    const vars = mapFrom(REAL_WEB_ENV);
    const result = checkStudioPrerequisites(vars);
    expect(result.status).toBe("pass");
  });

  it("publishable key is genuinely FAIL (truly missing)", () => {
    const vars = mapFrom(REAL_WEB_ENV);
    const result = checkStripePublishableKey(vars);
    expect(result.status).toBe("fail");
  });

  it("webhook secret is genuinely FAIL (truly missing)", () => {
    const vars = mapFrom(REAL_WEB_ENV);
    const result = checkWebhookSecret(vars);
    expect(result.status).toBe("fail");
  });

  it("end-to-end via fake exec: getRailwayEnvVars + checks report truthfully", () => {
    const result = getRailwayEnvVars({ execFn: fakeExecReturning(REAL_WEB_ENV) });
    expect(result.vars).not.toBeNull();
    expect(result.service).toBe("web");
    expect(checkStripeSecretKey(result.vars).status).toBe("pass");
    expect(checkTerminalService(result.vars).status).toBe("pass");
    expect(checkStudioPrerequisites(result.vars).status).toBe("pass");
    expect(checkStripePublishableKey(result.vars).status).toBe("fail");
    expect(checkWebhookSecret(result.vars).status).toBe("fail");
  });
});

// ─── Secret safety: no secret values in any check output ───────────────

describe("No secret values leak from any check", () => {
  it("all check details are secret-free across the real web env", () => {
    const vars = mapFrom(REAL_WEB_ENV);
    const results = [
      checkStripeSecretKey(vars),
      checkStripePublishableKey(vars),
      checkWebhookSecret(vars),
      checkTerminalService(vars),
      checkStudioPrerequisites(vars),
    ];
    for (const r of results) {
      expect(containsSecret(r.detail ?? "")).toBe(false);
    }
  });
});

// ─── Unit tests for the railway-env helpers ────────────────────────────

describe("railway-env helpers", () => {
  it("hasNonEmpty: true for non-empty, false for empty/missing/null map", () => {
    const vars = mapFrom({ A: "x", B: "" });
    expect(hasNonEmpty(vars, "A")).toBe(true);
    expect(hasNonEmpty(vars, "B")).toBe(false);
    expect(hasNonEmpty(vars, "MISSING")).toBe(false);
    expect(hasNonEmpty(null, "A")).toBe(false);
  });

  it("hasAnyNonEmpty: returns first matching key or null", () => {
    const vars = mapFrom({ B: "y", A: "" });
    expect(hasAnyNonEmpty(vars, ["A", "B"])).toBe("B");
    expect(hasAnyNonEmpty(vars, ["A", "MISSING"])).toBeNull();
    expect(hasAnyNonEmpty(null, ["A"])).toBeNull();
  });

  it("hasNonEmptyWithPrefix: checks value prefix without leaking it", () => {
    const vars = mapFrom({ KEY: SK_LIVE + "xyz" });
    expect(hasNonEmptyWithPrefix(vars, "KEY", "sk_live_")).toBe(true);
    expect(hasNonEmptyWithPrefix(vars, "KEY", "sk_test_")).toBe(false);
    expect(hasNonEmptyWithPrefix(vars, "MISSING", "sk_live_")).toBe(false);
  });
});

// ─── Production authority: targets the www.litlabs.net service ─────────
//
// This is the regression that has now been wrong twice. The original code
// inspected "@litlabs/litt-shell". That was corrected to "cli" — still
// wrong. Both live in the "litlabs-website" project, which despite its
// name serves no production traffic. Production is the "web" service in
// the "litlabs-terminal-server" project, which owns www.litlabs.net.
//
// These tests prove the production doctor targets THAT service, by:
//   1. Asserting the canonical constants point at web / terminal-server.
//   2. Asserting getRailwayEnvVars inspects web, not cli.
//   3. Asserting checkProductionServiceDomain passes when web owns the
//      domain and fails when a different service (cli) is inspected.
//   4. Asserting the domain-ownership command targets the web service IDs.

describe("Production authority: targets the www.litlabs.net service", () => {
  // The OLD, wrong values that must NEVER be the production target again.
  const OLD_CLI_SERVICE_ID = "f71b9a86-cd1e-4c5a-ba00-b4efc0b6e119";
  const OLD_LITLABS_WEBSITE_PROJECT_ID = "3d5b8abe-088c-4a6c-9b34-7054829247c9";
  const OLD_LITLABS_WEBSITE_ENV_ID = "56de816e-3904-4b35-9dde-031303a6d5cb";

  it("canonical service is 'web', NOT 'cli' or '@litlabs/litt-shell'", () => {
    expect(RAILWAY_PRODUCTION_SERVICE).toBe("web");
    expect(RAILWAY_PRODUCTION_SERVICE).not.toBe("cli");
    expect(RAILWAY_PRODUCTION_SERVICE).not.toBe("@litlabs/litt-shell");
    expect(RAILWAY_SERVICE_NAME).toBe("web");
  });

  it("canonical project is litlabs-terminal-server, NOT litlabs-website", () => {
    expect(RAILWAY_PRODUCTION_PROJECT_ID).toBe(RAILWAY_PROJECT_ID);
    expect(RAILWAY_PROJECT_ID).not.toBe(OLD_LITLABS_WEBSITE_PROJECT_ID);
    // The terminal-server project ID, confirmed via Railway MCP.
    expect(RAILWAY_PROJECT_ID).toBe("69a241af-cd1b-4cf1-baff-f5a6a5a5d7d5");
  });

  it("canonical service/environment IDs are the web/production ones", () => {
    expect(RAILWAY_SERVICE_ID).toBe("a8a05220-e5ed-48f6-969d-1f82957341de");
    expect(RAILWAY_SERVICE_ID).not.toBe(OLD_CLI_SERVICE_ID);
    expect(RAILWAY_ENVIRONMENT_ID).toBe("41f9b3f4-c783-4288-a6d3-077b4e55858f");
    expect(RAILWAY_ENVIRONMENT_ID).not.toBe(OLD_LITLABS_WEBSITE_ENV_ID);
  });

  it("PRODUCTION_DOMAIN is www.litlabs.net", () => {
    expect(PRODUCTION_DOMAIN).toBe("https://www.litlabs.net");
  });

  it("getRailwayEnvVars inspects the web service, not cli", () => {
    let capturedCmd = "";
    const spy: ExecFn = (cmd) => {
      capturedCmd = cmd;
      return { stdout: "{}", stderr: "", exitCode: 0 };
    };
    getRailwayEnvVars({ execFn: spy });
    expect(capturedCmd).toContain('--service "web"');
    expect(capturedCmd).not.toContain('--service "cli"');
    expect(capturedCmd).not.toContain(OLD_CLI_SERVICE_ID);
    expect(capturedCmd).toContain(RAILWAY_PRODUCTION_PROJECT_ID);
    expect(capturedCmd).not.toContain(OLD_LITLABS_WEBSITE_PROJECT_ID);
  });

  // --- checkProductionServiceDomain: the runtime domain-ownership assertion ---

  /** Real `railway domain list --json` output for the web service (production). */
  const WEB_DOMAINS_JSON = JSON.stringify({
    domains: [
      {
        id: "36f604ba-01ae-4c7c-b7d1-c95d585be4f2",
        domain: "web-production-d3a22.up.railway.app",
        type: "service",
        targetPort: null,
        syncStatus: "ACTIVE",
        createdAt: "2026-08-19T17:01:35.678+00:00",
        updatedAt: "2026-08-19T17:01:35.952+00:00",
      },
      {
        id: "e395e71d-dceb-4277-adb2-94015d2d7b39",
        domain: "www.litlabs.net",
        type: "custom",
        targetPort: null,
        syncStatus: "ACTIVE",
        createdAt: "2026-08-19T19:10:57.606+00:00",
        updatedAt: "2026-08-19T19:21:19.169+00:00",
      },
    ],
  });

  it("checkProductionServiceDomain PASSES when web owns www.litlabs.net (custom/ACTIVE)", () => {
    const result = checkProductionServiceDomain(
      () => ({ stdout: WEB_DOMAINS_JSON, stderr: "", exitCode: 0 }),
    );
    expect(result.status).toBe("pass");
    expect(result.detail).toContain("www.litlabs.net");
    expect(result.detail).toContain("web");
  });

  it("checkProductionServiceDomain targets the web service IDs in the command", () => {
    let capturedCmd = "";
    const spy: ExecFn = (cmd) => {
      capturedCmd = cmd;
      return { stdout: WEB_DOMAINS_JSON, stderr: "", exitCode: 0 };
    };
    checkProductionServiceDomain(spy);
    expect(capturedCmd).toContain('--service "web"');
    expect(capturedCmd).toContain(RAILWAY_ENVIRONMENT_ID);
    expect(capturedCmd).toContain(RAILWAY_PROJECT_ID);
    expect(capturedCmd).not.toContain(OLD_CLI_SERVICE_ID);
    expect(capturedCmd).not.toContain(OLD_LITLABS_WEBSITE_PROJECT_ID);
    expect(capturedCmd).toContain("--json");
  });

  it("checkProductionServiceDomain FAILS when the domain is on a different service (cli)", () => {
    // Simulate the OLD wrong state: the cli service's domain list does NOT
    // contain www.litlabs.net. The check must fail, proving the doctor
    // would have caught the old misconfiguration.
    const cliDomainsJson = JSON.stringify({
      domains: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          domain: "cli-production.up.railway.app",
          type: "service",
          syncStatus: "ACTIVE",
        },
      ],
    });
    const result = checkProductionServiceDomain(
      () => ({ stdout: cliDomainsJson, stderr: "", exitCode: 0 }),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("www.litlabs.net");
    expect(result.detail).toContain("not found");
  });

  it("checkProductionServiceDomain FAILS when domain exists but is not custom/ACTIVE", () => {
    const degradedJson = JSON.stringify({
      domains: [
        {
          id: "e395e71d-dceb-4277-adb2-94015d2d7b39",
          domain: "www.litlabs.net",
          type: "service",
          syncStatus: "PENDING",
        },
      ],
    });
    const result = checkProductionServiceDomain(
      () => ({ stdout: degradedJson, stderr: "", exitCode: 0 }),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("type=service");
    expect(result.detail).toContain("sync=PENDING");
  });

  it("checkProductionServiceDomain FAILS when railway command fails", () => {
    const result = checkProductionServiceDomain(
      () => ({ stdout: "", stderr: "Error: not authenticated", exitCode: 1 }),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Cannot list");
  });

  it("checkProductionServiceDomain FAILS on unparseable output", () => {
    const result = checkProductionServiceDomain(
      () => ({ stdout: "not json at all", stderr: "", exitCode: 0 }),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("Cannot parse");
  });

  it("checkProductionServiceDomain FAILS on empty domains array", () => {
    const result = checkProductionServiceDomain(
      () => ({ stdout: JSON.stringify({ domains: [] }), stderr: "", exitCode: 0 }),
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("not found");
  });

  it("checkProductionServiceDomain never leaks secret values", () => {
    const result = checkProductionServiceDomain(
      () => ({ stdout: WEB_DOMAINS_JSON, stderr: "", exitCode: 0 }),
    );
    expect(containsSecret(result.detail ?? "")).toBe(false);
    expect(containsSecret(result.fix ?? "")).toBe(false);
  });
});
