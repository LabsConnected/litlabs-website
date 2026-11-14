/**
 * Sandbox preview branch (Phase 2 lifecycle, design note §5).
 *
 * Proves end to end with the fake provider: startPreview runs the dev
 * server INSIDE the workspace's sandbox on the fixed port; the public
 * status/log shapes are byte-identical to the host path (port +
 * status only — the provider origin and traffic token NEVER appear);
 * health verification probes through the private upstream; the proxy
 * forwards to the provider origin with the traffic-access header
 * while its responses, headers and logs never carry the provider
 * host or token; and a user the gate does not cover falls through to
 * the host path exactly as before.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FakeSandboxProvider } from "../sandbox/testing/fake-providers";
import { SandboxExecGate } from "../sandbox/exec-router";
import { SandboxWorkspaceExecutor } from "../sandbox/workspace-executor";
import { SANDBOX_PREVIEW_PORT, SANDBOX_TRAFFIC_TOKEN_HEADER } from "../preview/sandbox-runtime";
import {
  startPreview,
  stopPreviewAndWait,
  verifyPreviewHealth,
  getPreviewStatus,
  getPreviewUpstream,
  registerSandboxPreviewSupport,
} from "../preview/PreviewManager";
import { registerPreviewProxyRoute } from "../preview/proxy";
import { upsertWorkspaceDescriptor } from "../workspace/WorkspaceManager";
import { useTrustedLocalEnv } from "./helpers/trusted-local-env";

useTrustedLocalEnv();

const OWNER = "user_owner_preview";
const OTHER = "user_other_preview";
const PREVIEW_TOKEN = ["test", "preview", "token"].join("-");

let volumeParent: string;
let provider: FakeSandboxProvider;
let executor: SandboxWorkspaceExecutor;
let workspaceId: string;

function openGate(p: FakeSandboxProvider): SandboxExecGate {
  return new SandboxExecGate({
    providerEnabled: true,
    routingEnabled: true,
    isOwner: (userId) => userId === OWNER,
    isVerified: () => true,
    templateId: "fake-template",
    provider: p,
  });
}

async function prepareSandboxWorkspace(): Promise<void> {
  const ws = await executor.prepareRepoWorkspace({
    userId: OWNER,
    projectId: "proj-preview",
    installationId: 7,
    owner: "acme",
    repo: "site",
    branch: "main",
    workspaceRoot: volumeParent,
    githubToken: ["test", "scoped", "token", "0003"].join("-"),
  });
  workspaceId = ws.workspaceId;
}

function stubFetchOk() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("<html>app</html>", { status: 200, headers: { "content-type": "text/html" } })),
  );
}

async function waitForStatus(status: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getPreviewStatus(workspaceId)?.status === status) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`preview never reached status ${status}; now ${getPreviewStatus(workspaceId)?.status}`);
}

beforeEach(async () => {
  volumeParent = mkdtempSync(join(tmpdir(), "litt-preview-sbx-"));
  provider = new FakeSandboxProvider({
    cloneFiles: {
      "package.json": JSON.stringify({ name: "app", scripts: { dev: "node server.js" } }),
      "server.js": "console.log('app');\n",
    },
  });
  executor = new SandboxWorkspaceExecutor({
    provider,
    gate: openGate(provider),
    templateId: "fake-template",
    log: () => {},
  });
  registerSandboxPreviewSupport({ executor, provider });
  await prepareSandboxWorkspace();
});

afterEach(async () => {
  await stopPreviewAndWait(workspaceId).catch(() => {});
  registerSandboxPreviewSupport(null);
  vi.unstubAllGlobals();
  rmSync(volumeParent, { recursive: true, force: true });
});

describe("sandbox preview branch", () => {
  it("starts the dev server in the sandbox and exposes only port + status", async () => {
    stubFetchOk();
    const runtime = await startPreview({
      workspaceId,
      userId: OWNER,
      framework: "custom",
      command: "node server.js --port $PORT",
      packageManager: "npx",
    });
    expect(runtime.upstream?.kind).toBe("sandbox");
    expect(runtime.port).toBe(SANDBOX_PREVIEW_PORT);
    await waitForStatus("ready");

    const status = getPreviewStatus(workspaceId)!;
    expect(Object.keys(status).sort()).toEqual(
      ["command", "error", "errorCode", "framework", "lastHealthCheck", "logs", "port", "startedAt", "status"].sort(),
    );
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("fake-preview");
    expect(serialized).not.toContain("fake-traffic");
    expect(serialized).not.toContain(".invalid");

    const upstream = getPreviewUpstream(workspaceId);
    expect(upstream?.kind).toBe("sandbox");
  });

  it("verifyPreviewHealth probes through the upstream and extends the session", async () => {
    stubFetchOk();
    await startPreview({
      workspaceId, userId: OWNER, framework: "custom",
      command: "node server.js --port $PORT", packageManager: "npx",
    });
    await waitForStatus("ready");
    const sandboxId = getPreviewUpstream(workspaceId)!.kind === "sandbox"
      ? (getPreviewUpstream(workspaceId) as { sandboxId: string }).sandboxId
      : "";
    await expect(verifyPreviewHealth(workspaceId)).resolves.toBe(true);
    expect(provider.timeoutExtensionsFor(sandboxId).length).toBeGreaterThan(0);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(verifyPreviewHealth(workspaceId)).resolves.toBe(false);
    expect(getPreviewStatus(workspaceId)?.errorCode).toBe("preview_root_route_missing");
  });

  it("stop flips the runtime and kills the in-sandbox process group", async () => {
    stubFetchOk();
    await startPreview({
      workspaceId, userId: OWNER, framework: "custom",
      command: "node server.js --port $PORT", packageManager: "npx",
    });
    await waitForStatus("ready");
    await stopPreviewAndWait(workspaceId);
    expect(getPreviewStatus(workspaceId)?.status).toBe("stopped");
  });

  it("a user outside the gate falls through to the host path (no sandbox upstream)", async () => {
    const root = join(volumeParent, OTHER, "proj-host");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "h", scripts: { dev: "node -e \"\"" } }));
    upsertWorkspaceDescriptor({
      workspaceId: "ws-proj-hostfall",
      userId: OTHER,
      projectId: "proj-host",
      root,
      branch: "main",
      commitSha: "",
      ready: true,
    });
    const runtime = await startPreview({
      workspaceId: "ws-proj-hostfall",
      userId: OTHER,
      framework: "custom",
      command: "node -e \"process.exit(0)\"",
      packageManager: "npx",
    });
    expect(runtime.upstream?.kind).not.toBe("sandbox");
    await stopPreviewAndWait("ws-proj-hostfall").catch(() => {});
  });
});

describe("proxy with a sandbox upstream", () => {
  it("forwards to the provider origin with the traffic header and never leaks either", async () => {
    process.env.PREVIEW_ACCESS_TOKEN = PREVIEW_TOKEN;
    const fetched: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
        fetched.push({ url: String(url), headers: init?.headers ?? {} });
        return new Response("<html><body>app</body></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }),
    );
    const origin = "https://fake-preview-sbx-9-3000.invalid";
    const extend = vi.fn(async () => true);
    const app = express();
    registerPreviewProxyRoute(app, {
      getPreviewStatus: () => ({
        status: "ready",
        port: SANDBOX_PREVIEW_PORT,
        framework: "custom",
        command: "node server.js",
        startedAt: Date.now(),
        lastHealthCheck: Date.now(),
        error: null,
        errorCode: null,
        logs: [],
      }),
      getPreviewUpstream: () => ({
        kind: "sandbox",
        sandboxId: "fake-sbx-9",
        origin,
        headers: { [SANDBOX_TRAFFIC_TOKEN_HEADER]: "fake-traffic-fake-sbx-9" },
      }),
      extendSandboxTimeout: extend,
      markPreviewRootRouteMissing: () => true,
      markPreviewBackendUnreachable: () => true,
    });

    const res = await request(app).get(`/preview/ws-proj-preview/?token=${PREVIEW_TOKEN}`);
    expect(res.status).toBe(200);
    expect(fetched).toHaveLength(1);
    // The preview-scoped token is stripped before the request leaves
    // for the provider origin — the traffic header is the only
    // credential the provider sees.
    expect(fetched[0].url).toBe(`${origin}/`);
    expect(fetched[0].url).not.toContain(PREVIEW_TOKEN);
    expect(fetched[0].headers[SANDBOX_TRAFFIC_TOKEN_HEADER]).toBe("fake-traffic-fake-sbx-9");
    expect(fetched[0].headers.host).toBe("fake-preview-sbx-9-3000.invalid");
    // The browser-visible response carries neither the origin nor the token.
    expect(res.text).not.toContain("fake-preview");
    expect(res.text).not.toContain("fake-traffic");
    expect(JSON.stringify(res.headers)).not.toContain("fake-traffic");
    expect(extend).toHaveBeenCalled();
    delete process.env.PREVIEW_ACCESS_TOKEN;
  });

  it("re-homes absolute redirects off the provider origin back inside the mount", async () => {
    process.env.PREVIEW_ACCESS_TOKEN = PREVIEW_TOKEN;
    const origin = "https://fake-preview-sbx-9-3000.invalid";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("", { status: 302, headers: { location: `${origin}/about` } }),
      ),
    );
    const app = express();
    registerPreviewProxyRoute(app, {
      getPreviewStatus: () => ({
        status: "ready",
        port: SANDBOX_PREVIEW_PORT,
        framework: "custom",
        command: "node server.js",
        startedAt: Date.now(),
        lastHealthCheck: Date.now(),
        error: null,
        errorCode: null,
        logs: [],
      }),
      getPreviewUpstream: () => ({
        kind: "sandbox",
        sandboxId: "fake-sbx-9",
        origin,
        headers: { [SANDBOX_TRAFFIC_TOKEN_HEADER]: "fake-traffic-fake-sbx-9" },
      }),
      markPreviewRootRouteMissing: () => true,
      markPreviewBackendUnreachable: () => true,
    });
    const res = await request(app).get(`/preview/ws-proj-preview/?token=${PREVIEW_TOKEN}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("/preview/ws-proj-preview/about");
    expect(res.headers.location).not.toContain("fake-preview");
    delete process.env.PREVIEW_ACCESS_TOKEN;
  });
});
