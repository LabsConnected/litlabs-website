/**
 * Station Control Bridge — preview station: static projects + error truth.
 *
 * Regression coverage for ART-20261111-070 §1/§3 (production run aa70559b):
 * - A STATIC project's preview.inspect / preview.screenshot must resolve
 *   the served static preview URL (the capability-token URL the app
 *   preview route mints) and must NEVER call preview.start — the dev
 *   server start is host-execution and is refused on the hosted service,
 *   while the static preview is file-served and needs no host execution.
 * - When preview.start fails BY VALUE (registry envelope ok, inner tool
 *   result success:false — e.g. the terminal server's 503
 *   HOST_EXECUTION_DISABLED refusal), the surfaced error must be the real
 *   inner failure verbatim, not "did not return a workspaceId".
 *
 * The tool registry and the project repository are mocked; the REAL
 * delegateToTool / station modules / preview-token / asset-manifest code
 * runs, so the minted token is genuine and verifiable.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/* ── Tool registry: mocked at the execute boundary ─────────────────── */
type ExecuteResult = { ok: true; result: unknown } | { ok: false; error: string };

const mocks = vi.hoisted(() => ({
  calls: [] as Array<{ toolId: string; inputs: Record<string, unknown> }>,
  handlers: new Map<string, ExecuteResult | ((inputs: Record<string, unknown>) => ExecuteResult)>(),
  execute: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("@/lib/litt-intelligence/tool-registry", () => ({
  toolRegistry: {
    execute: mocks.execute,
    register: vi.fn(),
    get: vi.fn(() => undefined),
  },
}));

vi.mock("@/lib/projects/project-repository", () => ({
  getProject: mocks.getProject,
}));

/* ── Real station modules (register on import) ─────────────────────── */
import "../browser";
import "../preview";

import { getStationAction } from "../../registry";
import type { StationExecutionContext, StationResult } from "../../types";
import { verifyPreviewToken } from "@/lib/projects/preview-token";
import { SITE_URL } from "@/lib/siteConfig";

process.env.TERMINAL_AUTH_SECRET =
  process.env.TERMINAL_AUTH_SECRET ?? "test-terminal-auth-secret-0123456789abcdef";

const INDEX_HTML = [
  "<!doctype html><html><head>",
  '<link rel="stylesheet" href="styles.css">',
  "</head><body>",
  "<h1>The LiTT Food Court</h1>",
  '<img src="assets/images/hero.jpeg" alt="Food stalls">',
  "</body></html>",
].join("\n");

const DEFAULT_RESULTS: Record<string, ExecuteResult> = {
  "browser.start_session": {
    ok: true,
    result: { ok: true, session: { id: "sess_1" }, reused: false },
  },
  "preview.start": {
    ok: true,
    result: { workspaceId: "ws_1", status: "ready", port: 3100, framework: "nextjs" },
  },
  "preview.stop": {
    ok: true,
    result: { success: true, workspaceId: "ws_1", status: "stopped" },
  },
  "browser.snapshot": {
    ok: true,
    result: {
      success: true,
      data: {
        url: "http://localhost:3100/",
        textContent: "Hello world",
        accessibility: { role: "RootWebArea", name: "" },
      },
    },
  },
  "browser.screenshot": {
    ok: true,
    result: {
      success: true,
      data: { screenshot: "data:image/png;base64,AAA" },
      screenshotUrl: "data:image/png;base64,AAA",
    },
  },
  "files.read": {
    ok: true,
    result: { success: false, error: "not mocked per-path" },
  },
};

/** files.read handler: serves the static workspace's files by path. */
function staticFilesRead(inputs: Record<string, unknown>): ExecuteResult {
  const path = inputs.path as string;
  if (path === "index.html") {
    return { ok: true, result: { success: true, path, size: INDEX_HTML.length, content: INDEX_HTML } };
  }
  return { ok: true, result: { success: true, path, size: 8, content: "/* file */" } };
}

function armExecute() {
  mocks.execute.mockImplementation(
    async (id: string, inputs: Record<string, unknown>): Promise<ExecuteResult> => {
      mocks.calls.push({ toolId: id, inputs });
      const handler = mocks.handlers.get(id) ?? DEFAULT_RESULTS[id];
      if (typeof handler === "function") return handler(inputs);
      return handler ?? { ok: true, result: { success: true } };
    },
  );
}

function makeCtx(overrides: Partial<StationExecutionContext> = {}): StationExecutionContext {
  return {
    projectId: "proj_1",
    conversationId: "conv_1",
    userId: "user_1",
    permissions: {
      files: "allow",
      terminal: "allow",
      browser: "allow",
      git: "allow",
      create: "allow",
      preview: "allow",
      deploy: "allow",
      production: "allow",
      payments: "deny",
      externalPost: "deny",
      secrets: "deny",
    },
    emitEvent: () => {},
    navigateToStation: () => {},
    reportLiveState: () => {},
    transport: {},
    actionContext: { userId: "user_1", projectId: "proj_1", actionRunId: "run_1" },
    ...overrides,
  };
}

function action(id: string) {
  const a = getStationAction(id);
  if (!a) throw new Error(`station action ${id} not registered`);
  return a;
}

async function run(id: string, args: unknown, ctx?: StationExecutionContext): Promise<StationResult> {
  return (await action(id).execute(args as never, ctx ?? makeCtx())) as StationResult;
}

function callsFor(toolId: string) {
  return mocks.calls.filter((c) => c.toolId === toolId);
}

function staticProject() {
  mocks.getProject.mockResolvedValue({
    id: "proj_1",
    framework: "static",
    workspaceId: "ws_static",
  });
  mocks.handlers.set("files.read", staticFilesRead);
}

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.handlers.clear();
  mocks.execute.mockClear();
  mocks.getProject.mockReset();
  mocks.getProject.mockResolvedValue(null);
  armExecute();
});

describe("preview station — static projects", () => {
  it("preview.inspect resolves the served static URL and never calls preview.start", async () => {
    staticProject();
    const res = await run("preview.inspect", {});
    expect(res.success).toBe(true);
    expect(callsFor("preview.start")).toHaveLength(0);

    const url = (res as { url?: string }).url ?? "";
    expect(url.startsWith(`${SITE_URL}/api/preview/proj_1/t/`)).toBe(true);
    expect(url.endsWith("/index.html")).toBe(true);

    // The token in the URL is a genuine preview capability token carrying
    // the verified asset closure — the same token the app route mints.
    const token = url.split("/t/")[1]?.replace(/\/index\.html$/, "") ?? "";
    const verified = verifyPreviewToken(token);
    expect(verified.projectId).toBe("proj_1");
    expect(verified.workspaceId).toBe("ws_static");
    expect(verified.assets).toContain("index.html");
    expect(verified.assets).toContain("assets/images/hero.jpeg");
    // Stylesheets are embedded at serve time, so the manifest deliberately
    // never authorizes the stylesheet file itself (preview-asset-manifest).
    expect(verified.assets).not.toContain("styles.css");

    // The browser navigated to the static URL and its text came back.
    const nav = callsFor("browser.navigate");
    expect(nav).toHaveLength(1);
    expect(nav[0].inputs).toMatchObject({ sessionId: "sess_1", url });
    expect((res as { textContent?: string }).textContent).toBe("Hello world");
  });

  it("preview.screenshot uses the served static URL and never calls preview.start", async () => {
    staticProject();
    const res = await run("preview.screenshot", {});
    expect(res.success).toBe(true);
    expect(callsFor("preview.start")).toHaveLength(0);
    expect(((res as { url?: string }).url ?? "").startsWith(`${SITE_URL}/api/preview/proj_1/t/`)).toBe(true);
    expect((res as { screenshot?: string }).screenshot).toBe("data:image/png;base64,AAA");
  });

  it("static project with no index.html fails honestly and never calls preview.start", async () => {
    mocks.getProject.mockResolvedValue({ id: "proj_1", framework: "static", workspaceId: "ws_static" });
    mocks.handlers.set("files.read", () => ({
      ok: true,
      result: { success: false, error: "File not found: index.html" },
    }));
    const res = await run("preview.inspect", {});
    expect(res.success).toBe(false);
    expect((res as { error?: string }).error).toMatch(/index\.html/);
    expect(callsFor("preview.start")).toHaveLength(0);
    expect(callsFor("browser.start_session")).toHaveLength(0);
  });

  it("static project still on the seeded welcome screen is not presented as ready", async () => {
    mocks.getProject.mockResolvedValue({ id: "proj_1", framework: "static", workspaceId: "ws_static" });
    mocks.handlers.set("files.read", (inputs) => ({
      ok: true,
      result: {
        success: true,
        path: inputs.path,
        content: "<html><!-- LITT-WELCOME-SCREEN --></html>",
      },
    }));
    const res = await run("preview.inspect", {});
    expect(res.success).toBe(false);
    expect(callsFor("preview.start")).toHaveLength(0);
    expect(callsFor("browser.start_session")).toHaveLength(0);
  });
});

describe("preview station — error truth", () => {
  const REFUSAL = "Preview start failed (503): {\"code\":\"HOST_EXECUTION_DISABLED\"}";

  it("an inner preview.start failure surfaces verbatim in preview.inspect, not as a missing workspaceId", async () => {
    mocks.handlers.set("preview.start", {
      ok: true,
      result: { success: false, error: REFUSAL },
    });
    const res = await run("preview.inspect", {});
    expect(res.success).toBe(false);
    expect((res as { error?: string }).error).toBe(REFUSAL);
    expect(callsFor("browser.start_session")).toHaveLength(0);
  });

  it("an inner preview.start failure surfaces verbatim in preview.launch", async () => {
    mocks.handlers.set("preview.start", {
      ok: true,
      result: { success: false, error: REFUSAL },
    });
    const res = await run("preview.launch", {});
    expect(res.success).toBe(false);
    expect((res as { error?: string }).error).toBe(REFUSAL);
  });

  it("an inner preview.start failure surfaces verbatim in preview.reload", async () => {
    mocks.handlers.set("preview.start", {
      ok: true,
      result: { success: false, error: REFUSAL },
    });
    const res = await run("preview.reload", {});
    expect(res.success).toBe(false);
    expect((res as { error?: string }).error).toContain(REFUSAL);
  });

  it("an unresolvable project falls through to the existing preview.start path", async () => {
    mocks.getProject.mockResolvedValue(null);
    const res = await run("preview.inspect", {});
    expect(res.success).toBe(true);
    expect(callsFor("preview.start")).toHaveLength(1);
    expect((res as { url?: string }).url).toBe("http://localhost:4001/preview/ws_1");
  });

  it("a project lookup failure falls through to the existing preview.start path", async () => {
    mocks.getProject.mockRejectedValue(new Error("db unavailable"));
    const res = await run("preview.inspect", {});
    expect(res.success).toBe(true);
    expect(callsFor("preview.start")).toHaveLength(1);
  });
});
