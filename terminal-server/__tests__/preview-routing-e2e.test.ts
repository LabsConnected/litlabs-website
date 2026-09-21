/**
 * End-to-end routing-chain regression test for the
 * "Preview ready" + bare "Cannot GET /" incident.
 *
 * The proxy-parity suite proves the gateway leg against an injected
 * status snapshot. This file proves the WHOLE chain with real
 * processes and the real runtime store:
 *
 *   workspace → spawned dev-server process → assigned port
 *     → bound-port adoption → preview gateway → iframe response
 *
 * Scenario (the production defect):
 *   - PreviewManager assigns port P to the workspace.
 *   - A FOREIGN process (this test — outside the child's process tree)
 *     squats P and answers every request with Express's "Cannot GET /".
 *   - The spawned dev server actually binds a different port (what
 *     `next dev` does on EADDRINUSE — auto-increment) and announces it
 *     on stdout.
 *
 * Required behavior:
 *   - The runtime record adopts the port the process actually bound —
 *     it must NOT stay pointed at the squatter.
 *   - "ready" is declared only after the workspace's own app answers
 *     GET / — the squatter's open socket/404 never counts.
 *   - GET /preview/:workspaceId/ through the real proxy handler returns
 *     the same application response as a direct GET on the adopted
 *     port — while a direct GET on the originally assigned port still
 *     returns the squatter's "Cannot GET /" (proof the defect input
 *     exists but is no longer routed).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

vi.mock("../workspace/WorkspaceManager", () => ({
  getWorkspace: vi.fn(),
}));

const { getWorkspace } = await import("../workspace/WorkspaceManager");
const mockedGetWorkspace = vi.mocked(getWorkspace);

import {
  startPreview,
  stopPreview,
  getPreviewStatus,
  verifyPreviewHealth,
} from "../preview/PreviewManager";
import { registerPreviewProxyRoute } from "../preview/proxy";

const WORKSPACE_ID = "ws_routing_e2e";
const USER_ID = "u_routing";
const TOKEN = "e2e-preview-token";

const APP_MARKER = "workspace-app-on-adopted-port";

/**
 * Dev-server fixture the spawned child runs. It deliberately does NOT
 * bind the port it was given (simulating a squatted assigned port) —
 * it binds an OS-assigned port instead, then announces the real bound
 * port exactly the way `next dev` announces an auto-increment.
 *
 * The ~1.2s bind delay is deliberate: it lands the child's bound-port
 * announcement AFTER the health probe has already seen the squatter's
 * 404 on the assigned port but inside the probe's post-404 grace
 * window — the exact boot-time race that previously misattributed a
 * foreign "Cannot GET /" to the workspace's app.
 */
const DEV_SERVER_FIXTURE = `
const http = require("http");
const assigned = Number(process.argv[2]);
const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!DOCTYPE html><html><body><h1>${APP_MARKER}</h1></body></html>");
});
setTimeout(() => {
  server.listen(0, "0.0.0.0", () => {
    const bound = server.address().port;
    // Next.js EADDRINUSE announcement — what adoptBoundPort parses.
    console.log("Port " + assigned + " is in use, trying " + bound + " instead.");
  });
}, 1200);
setInterval(() => {}, 1000); // stay alive
`;

function squatterCannotGet(): Server {
  return createServer((_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Cannot GET /");
  });
}

async function waitForStatus(workspaceId: string, want: string, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getPreviewStatus(workspaceId).status === want) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for status "${want}" — got "${getPreviewStatus(workspaceId).status}"`);
}

describe("preview routing chain — workspace → process → port → gateway → iframe", () => {
  let tmpRoot: string;
  let squatter: Server;
  let assignedPort: number;
  let gateway: express.Application;

  beforeAll(() => {
    process.env.PREVIEW_ACCESS_TOKEN = TOKEN;
    tmpRoot = mkdtempSync(join(tmpdir(), "preview-routing-"));
    writeFileSync(join(tmpRoot, "dev-server.js"), DEV_SERVER_FIXTURE);
    mockedGetWorkspace.mockReturnValue({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      projectId: "p_routing",
      root: tmpRoot,
      branch: "main",
      commitSha: "e2e",
      ready: true,
    } as any);
  });

  afterAll(async () => {
    stopPreview(WORKSPACE_ID);
    if (squatter) {
      await new Promise<void>((resolve) => squatter.close(() => resolve()));
    }
    delete process.env.PREVIEW_ACCESS_TOKEN;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("routes GET / to the workspace's actual process, not the squatter on the assigned port", async () => {
    // Spawn the real preview. packageManager "npx" skips PM resolution
    // and dependency install — the child runs the fixture directly.
    const runtime = await startPreview({
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      framework: "node",
      command: "node dev-server.js $PORT",
      packageManager: "npx",
    });
    assignedPort = runtime.port;

    // A foreign process squats the assigned port — the post-restart /
    // orphan scenario. Bound by THIS test process, not the child tree.
    squatter = squatterCannotGet();
    await new Promise<void>((resolve, reject) => {
      squatter.once("error", reject);
      squatter.listen(assignedPort, "0.0.0.0", () => resolve());
    });

    // Readiness must come from the workspace's own app — which bound a
    // different port — not the squatter's open socket.
    await waitForStatus(WORKSPACE_ID, "ready");

    const status = getPreviewStatus(WORKSPACE_ID);
    // The runtime record adopted the port the process actually bound.
    expect(status.port).not.toBe(assignedPort);
    const adoptedPort = status.port!;

    // Direct GET on the ORIGINALLY ASSIGNED port still returns the
    // squatter's Express 404 — the defect input is real and present.
    const staleDirect = await fetch(`http://127.0.0.1:${assignedPort}/`);
    expect(staleDirect.status).toBe(404);
    expect(await staleDirect.text()).toBe("Cannot GET /");

    // Direct GET on the ADOPTED port returns the workspace's app.
    const direct = await fetch(`http://127.0.0.1:${adoptedPort}/`);
    expect(direct.status).toBe(200);
    expect(await direct.text()).toContain(APP_MARKER);

    // The live health check agrees — the runtime's port is the app's.
    expect(await verifyPreviewHealth(WORKSPACE_ID)).toBe(true);

    // GET / through the REAL proxy handler (default deps → the real
    // runtime store) returns the same application response — the
    // iframe never sees the squatter's "Cannot GET /".
    gateway = express();
    registerPreviewProxyRoute(gateway);
    const proxied = await request(gateway).get(`/preview/${WORKSPACE_ID}/?token=${TOKEN}`);

    expect(proxied.status).toBe(direct.status);
    expect(proxied.text).toContain(APP_MARKER);
    expect(proxied.text).not.toContain("Cannot GET /");

    // An asset-path request reaches the same upstream port — the
    // gateway is anchored to the adopted port, not the assignment.
    const proxiedAsset = await request(gateway).get(
      `/preview/${WORKSPACE_ID}/anything?token=${TOKEN}`,
    );
    expect(proxiedAsset.status).toBe(200);
    expect(proxiedAsset.text).toContain(APP_MARKER);
  }, 30000);
});
