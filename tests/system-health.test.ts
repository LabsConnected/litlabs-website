import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveGitHub,
  resolveVercel,
  resolveSupabaseProject,
  resolveWorkspaceConnections,
  resolvePlatformServices,
  buildHealthSummary,
  probeGemini,
  probeOpenRouter,
  _clearAiHealthCache,
} from "@/lib/system-health";

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

const emptyData = {
  accounts: [],
  projects: [],
  legacyProjects: [],
  installations: [],
};

const now = () => new Date().toISOString();

/* ------------------------------------------------------------------ */
/*  GitHub resolution — all canonical sources                          */
/* ------------------------------------------------------------------ */

describe("resolveGitHub", () => {
  it("shows Connected when an active integration_project has a repository", () => {
    const gh = resolveGitHub({
      ...emptyData,
      projects: [
        {
          repository_full_name: "LabsConnected/litlabs-website",
          repository_html_url: "https://github.com/LabsConnected/litlabs-website",
          vercel_project_id: null,
          vercel_deployment_url: null,
          vercel_production_url: null,
          vercel_status: null,
          sync_status: "synced",
          sync_error: null,
        },
      ],
    });
    expect(gh.state).toBe("connected");
    expect(gh.detail).toBe("LabsConnected/litlabs-website");
    expect(gh.label).toBe("GitHub Repository");
  });

  it("shows Connected when a legacy project has a repository", () => {
    const gh = resolveGitHub({
      ...emptyData,
      legacyProjects: [
        { repository_full_name: "LabsConnected/litlabs-website", connection_status: "connected" },
      ],
    });
    expect(gh.state).toBe("connected");
    expect(gh.detail).toBe("LabsConnected/litlabs-website");
  });

  it("shows Authorized when a GitHub installation exists but no repo is selected", () => {
    const gh = resolveGitHub({
      ...emptyData,
      installations: [{ installation_id: 123, created_at: now() }],
    });
    expect(gh.state).toBe("authorized");
    expect(gh.detail).toContain("no repository selected");
  });

  it("shows Reconnect required when the account row has an error", () => {
    const gh = resolveGitHub({
      ...emptyData,
      accounts: [
        { provider: "github", provider_account_id: "1", provider_account_name: "octocat", status: "error", last_connected_at: null, last_error: "Token revoked" },
      ],
    });
    expect(gh.state).toBe("reconnect_required");
    expect(gh.detail).toBe("Token revoked");
  });

  it("shows Not connected when nothing exists", () => {
    const gh = resolveGitHub(emptyData);
    expect(gh.state).toBe("not_connected");
    expect(gh.detail).toBe("Not connected");
  });

  it("does NOT falsely report Not configured when a repo is actively connected", () => {
    // This is the core regression: accounts may be empty but projects has a repo.
    const gh = resolveGitHub({
      accounts: [], // no integration_accounts row
      projects: [
        {
          repository_full_name: "LabsConnected/litlabs-website",
          repository_html_url: null,
          vercel_project_id: null,
          vercel_deployment_url: null,
          vercel_production_url: null,
          vercel_status: null,
          sync_status: "synced",
          sync_error: null,
        },
      ],
      legacyProjects: [],
      installations: [],
    });
    expect(gh.state).toBe("connected");
    expect(gh.detail).toBe("LabsConnected/litlabs-website");
  });
});

/* ------------------------------------------------------------------ */
/*  Vercel resolution                                                  */
/* ------------------------------------------------------------------ */

describe("resolveVercel", () => {
  it("shows Live when a project is linked and deployment is ready", () => {
    const v = resolveVercel({
      ...emptyData,
      projects: [
        {
          repository_full_name: null,
          repository_html_url: null,
          vercel_project_id: "prj_123",
          vercel_deployment_url: "https://deploy.vercel.app",
          vercel_production_url: "https://litlabs-website.vercel.app",
          vercel_status: "ready",
          sync_status: "synced",
          sync_error: null,
        },
      ],
    });
    expect(v.state).toBe("live");
    expect(v.detail).toBe("https://litlabs-website.vercel.app");
  });

  it("shows Linked when a project is linked but no live deployment", () => {
    const v = resolveVercel({
      ...emptyData,
      projects: [
        {
          repository_full_name: null,
          repository_html_url: null,
          vercel_project_id: "prj_123",
          vercel_deployment_url: null,
          vercel_production_url: null,
          vercel_status: null,
          sync_status: "synced",
          sync_error: null,
        },
      ],
    });
    expect(v.state).toBe("linked");
  });

  it("shows Authorized when an account exists but no project is linked", () => {
    const v = resolveVercel({
      ...emptyData,
      accounts: [
        { provider: "vercel", provider_account_id: "1", provider_account_name: "my-team", status: "connected", last_connected_at: null, last_error: null },
      ],
    });
    expect(v.state).toBe("authorized");
  });

  it("shows Not connected when nothing exists", () => {
    const v = resolveVercel(emptyData);
    expect(v.state).toBe("not_connected");
  });
});

/* ------------------------------------------------------------------ */
/*  Supabase labeling                                                  */
/* ------------------------------------------------------------------ */

describe("resolveSupabaseProject", () => {
  it("is labeled 'Supabase Project Integration' — not just 'Supabase'", () => {
    const s = resolveSupabaseProject(emptyData);
    expect(s.label).toBe("Supabase Project Integration");
    expect(s.state).toBe("not_connected");
    expect(s.detail).toContain("Optional");
  });

  it("shows Connected when a supabase account exists", () => {
    const s = resolveSupabaseProject({
      ...emptyData,
      accounts: [
        { provider: "supabase", provider_account_id: "1", provider_account_name: "my-project", status: "connected", last_connected_at: null, last_error: null },
      ],
    });
    expect(s.state).toBe("connected");
    expect(s.detail).toBe("my-project");
  });

  it("does not imply the platform database is offline when not linked", () => {
    const s = resolveSupabaseProject(emptyData);
    // The detail must NOT say "Not configured" — that confused users about
    // the platform DB. It should say "Optional · Not linked".
    expect(s.detail).not.toContain("Not configured");
    expect(s.detail).toContain("Not linked");
  });
});

/* ------------------------------------------------------------------ */
/*  Workspace connections as a group                                   */
/* ------------------------------------------------------------------ */

describe("resolveWorkspaceConnections", () => {
  it("returns exactly 3 connections in order: GitHub, Vercel, Supabase", () => {
    const ws = resolveWorkspaceConnections(emptyData);
    expect(ws).toHaveLength(3);
    expect(ws[0].id).toBe("github");
    expect(ws[1].id).toBe("vercel");
    expect(ws[2].id).toBe("supabase_project");
  });
});

/* ------------------------------------------------------------------ */
/*  Platform services                                                  */
/* ------------------------------------------------------------------ */

describe("resolvePlatformServices", () => {
  it("returns platform services with safe detail for normal users", () => {
    const services = resolvePlatformServices(false);
    const ids = services.map((s) => s.id);
    expect(ids).toContain("website");
    expect(ids).toContain("auth");
    expect(ids).toContain("database");
    expect(ids).toContain("terminal");
    expect(ids).toContain("stripe");

    // Terminal detail for non-owner should not expose hostnames
    const terminal = services.find((s) => s.id === "terminal")!;
    if (terminal.state === "operational") {
      expect(terminal.detail).toBe("Operational");
    }
  });

  it("does not expose API keys or secrets in detail", () => {
    const services = resolvePlatformServices(true);
    for (const s of services) {
      expect(s.detail).not.toMatch(/sk_|AIza|service_role|secret/i);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Summary wording                                                    */
/* ------------------------------------------------------------------ */

describe("buildHealthSummary", () => {
  it("says Platform operational when everything is fine", () => {
    const summary = buildHealthSummary(
      [{ id: "github", label: "GitHub", category: "Workspace", state: "connected", detail: "ok", lastChecked: now() }],
      [{ id: "gemini", label: "Gemini", category: "AI", state: "healthy", detail: "ok", model: "gemini-2.5-flash", latencyMs: 42, lastChecked: now() }],
      [{ id: "auth", label: "Authentication", category: "Platform", state: "operational", detail: "ok", lastChecked: now() }],
    );
    expect(summary.headline).toContain("Platform operational");
    expect(summary.platformDegraded).toBe(false);
  });

  it("counts optional integrations needing setup", () => {
    const summary = buildHealthSummary(
      [
        { id: "github", label: "GitHub", category: "Workspace", state: "connected", detail: "ok", lastChecked: now() },
        { id: "vercel", label: "Vercel", category: "Workspace", state: "not_connected", detail: "no", lastChecked: now() },
        { id: "supabase_project", label: "Supabase", category: "Workspace", state: "not_connected", detail: "no", lastChecked: now() },
      ],
      [],
      [{ id: "auth", label: "Authentication", category: "Platform", state: "operational", detail: "ok", lastChecked: now() }],
    );
    expect(summary.optionalPending).toBe(2);
    expect(summary.headline).toContain("2 optional integrations need setup");
  });

  it("says Platform degraded when a critical service is down", () => {
    const summary = buildHealthSummary(
      [],
      [],
      [
        { id: "auth", label: "Authentication", category: "Platform", state: "operational", detail: "ok", lastChecked: now() },
        { id: "database", label: "Database", category: "Platform", state: "disconnected", detail: "down", lastChecked: now() },
      ],
    );
    expect(summary.platformDegraded).toBe(true);
    expect(summary.headline).toContain("Platform degraded");
    expect(summary.headline).toContain("Database");
  });

  it("does not mark the entire platform offline when only Terminal is down", () => {
    const summary = buildHealthSummary(
      [],
      [],
      [
        { id: "auth", label: "Authentication", category: "Platform", state: "operational", detail: "ok", lastChecked: now() },
        { id: "database", label: "Database", category: "Platform", state: "operational", detail: "ok", lastChecked: now() },
        { id: "terminal", label: "Terminal", category: "Platform", state: "disconnected", detail: "down", lastChecked: now() },
      ],
    );
    expect(summary.platformDegraded).toBe(false);
    expect(summary.headline).toContain("Terminal needs attention");
  });

  it("never produces a '2/5 services connected' score", () => {
    const summary = buildHealthSummary(
      [
        { id: "github", label: "GitHub", category: "Workspace", state: "connected", detail: "ok", lastChecked: now() },
        { id: "vercel", label: "Vercel", category: "Workspace", state: "not_connected", detail: "no", lastChecked: now() },
      ],
      [{ id: "gemini", label: "Gemini", category: "AI", state: "healthy", detail: "ok", model: "g", latencyMs: 1, lastChecked: now() }],
      [{ id: "auth", label: "Authentication", category: "Platform", state: "operational", detail: "ok", lastChecked: now() }],
    );
    expect(summary.headline).not.toMatch(/\d+\/\d+ services connected/);
  });
});

/* ------------------------------------------------------------------ */
/*  AI provider probes                                                 */
/* ------------------------------------------------------------------ */

describe("probeGemini", () => {
  const savedKey = process.env.GEMINI_API_KEY;
  const savedGoogleKey = process.env.GOOGLE_API_KEY;

  beforeEach(() => {
    _clearAiHealthCache();
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });

  afterEach(() => {
    if (savedKey !== undefined) process.env.GEMINI_API_KEY = savedKey;
    if (savedGoogleKey !== undefined) process.env.GOOGLE_API_KEY = savedGoogleKey;
  });

  it("returns missing when no key is set", async () => {
    const result = await probeGemini();
    expect(result.state).toBe("missing");
    expect(result.detail).toBe("API key required");
  });

  it("returns unauthorized when the provider rejects the key", async () => {
    process.env.GEMINI_API_KEY = "bad-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "invalid key" }),
    }) as unknown as typeof fetch;
    const result = await probeGemini();
    expect(result.state).toBe("unauthorized");
  });

  it("returns healthy with latency when the probe succeeds", async () => {
    process.env.GEMINI_API_KEY = "good-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "a" }] } }] }),
    }) as unknown as typeof fetch;
    const result = await probeGemini();
    expect(result.state).toBe("healthy");
    expect(result.latencyMs).not.toBeNull();
    expect(result.detail).toMatch(/ms/);
  });
});

describe("probeOpenRouter", () => {
  const savedKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    _clearAiHealthCache();
    delete process.env.OPENROUTER_API_KEY;
  });

  afterEach(() => {
    if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
  });

  it("returns missing when no key is set", async () => {
    const result = await probeOpenRouter();
    expect(result.state).toBe("missing");
  });

  it("returns healthy with latency and 'Fallback routing enabled' detail", async () => {
    process.env.OPENROUTER_API_KEY = "good-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "a" } }] }),
    }) as unknown as typeof fetch;
    const result = await probeOpenRouter();
    expect(result.state).toBe("healthy");
    expect(result.detail).toContain("Fallback routing enabled");
    expect(result.latencyMs).not.toBeNull();
  });
});
