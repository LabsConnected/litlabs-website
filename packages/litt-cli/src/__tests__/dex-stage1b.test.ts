/**
 * Dex Stage 1B — agent HTTP listener security tests.
 *
 * Real loopback server, real requests. Exercises every rejection layer:
 * Host allowlist (DNS rebinding), browser-header rejection, token
 * verification, method/body restrictions, rate limit, verb allowlist
 * (shot/mutations absent by construction), and sentinel shutdown.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";
import { startDexAgent, type DexAgent } from "../lib/dex/agent.js";
import { loadOrCreateToken, verifyToken } from "../lib/dex/auth-token.js";
import { requestStop, isStopRequested } from "../lib/dex/kill-switch.js";

let tmp: string;
let prev: string | undefined;
let agent: DexAgent;
let token: string;

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${agent!.url}${path}`, { headers });

const authed = (path: string, headers: Record<string, string> = {}) =>
  get(path, { authorization: `Bearer ${token}`, ...headers });

/** Raw HTTP for forbidden-header probes — fetch() cannot set Host or a
 * GET content-length (Fetch-forbidden headers are silently dropped), so
 * DNS-rebind and body-attacks must go through node:http. */
const rawGet = (path: string, headers: Record<string, string>, method = "GET") =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const url = new URL(agent!.url);
    const req = http.request(
      { hostname: url.hostname, port: url.port, path, method, headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "litt-dex1b-"));
  prev = process.env.LITT_STATE_HOME;
  process.env.LITT_STATE_HOME = tmp;
  agent = await startDexAgent();
  token = loadOrCreateToken();
});

afterEach(async () => {
  await agent?.stop().catch(() => {});
  if (prev === undefined) delete process.env.LITT_STATE_HOME;
  else process.env.LITT_STATE_HOME = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("token", () => {
  it("verifies timing-safely; rejects missing/malformed", () => {
    expect(verifyToken(token, token)).toBe(true);
    expect(verifyToken(undefined, token)).toBe(false);
    expect(verifyToken("wrong", token)).toBe(false);
    expect(verifyToken("x".repeat(1000), token)).toBe(false);
    expect(verifyToken(token.slice(0, -1) + "0", token)).toBe(false);
  });
});

describe("listener rejection layers", () => {
  it("401 without/with wrong token; does not leak the verb result", async () => {
    const r1 = await get("/ram");
    expect(r1.status).toBe(401);
    const r2 = await get("/ram", { authorization: "Bearer wrong" });
    expect(r2.status).toBe(401);
  });

  it("403 on Host not in the allowlist — defeats DNS rebinding", async () => {
    // Even with a correct token, an attacker-controlled Host fails.
    const r = await rawGet("/ram", { host: "evil.attacker.com", authorization: `Bearer ${token}` });
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).ok).toBe(false);
  });

  it("403 on browser-originated headers (Origin, Sec-Fetch-*)", async () => {
    expect((await authed("/ram", { origin: "https://evil.example" })).status).toBe(403);
    expect((await authed("/ram", { "sec-fetch-site": "cross-site" })).status).toBe(403);
  });

  it("405 on non-GET; 413 on body-bearing requests", async () => {
    const r = await fetch(`${agent.url}/ram`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.status).toBe(405);
    const r2 = await rawGet("/ram", {
      authorization: `Bearer ${token}`,
      "content-length": "500",
    });
    expect(r2.status).toBe(413);
  });

  it("404 on non-allowlisted paths — shot and mutations are unreachable", async () => {
    expect((await authed("/shot")).status).toBe(404);
    expect((await authed("/stop")).status).toBe(404);
    expect((await authed("/exec?cmd=whoami")).status).toBe(404);
    expect((await authed("/../etc/passwd")).status).toBe(404);
  });

  it("serves real data on allowed verbs", async () => {
    const r = await authed("/ram");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.data.memory.totalMb).toBeGreaterThan(0);
    const s = await authed("/status");
    const sb = await s.json();
    expect(sb.data.agent.rssMb).toBeGreaterThan(0);
  });

  it("rate-limits after 30 requests/minute per source", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 32; i++) {
      lastStatus = (await authed("/cpu")).status;
    }
    expect(lastStatus).toBe(429);
  }, 30_000);

  it("binds loopback only", () => {
    expect(agent.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

describe("emergency stop", () => {
  it("STOP sentinel halts: request gets 503 then agent shuts down", async () => {
    expect(isStopRequested()).toBe(false);
    requestStop();
    const r = await authed("/ram");
    expect(r.status).toBe(503);
    // Per-request sentinel check triggered the halt path.
    await agent.ready;
  });

  it("sentinel is also observed between requests (interval poll)", async () => {
    requestStop();
    await agent.ready; // resolves via the 500ms poll without any request
    expect(isStopRequested()).toBe(true);
  });

  it("halts even with a stalled in-flight request (closeAllConnections)", async () => {
    // A wedged request must not stall the emergency stop: send a partial
    // request (no terminating CRLF) so the connection stays open, then
    // request stop — the agent force-closes it and resolves.
    const url = new URL(agent.url);
    const sock = net.connect({ host: url.hostname, port: Number(url.port) });
    await new Promise((r) => sock.on("connect", r));
    sock.write(`GET /ram HTTP/1.1\r\nHost: 127.0.0.1:${url.port}\r\nAuthorization: Bearer ${token}\r\n`);
    await new Promise((r) => setTimeout(r, 100));
    requestStop();
    await agent.ready; // would hang forever without closeAllConnections
    sock.destroy();
  }, 15_000);
});

describe("audit rotation & token hygiene", () => {
  it("rotates at the byte cap, keeps bounded backups, newest survives", async () => {
    const { rotateAuditIfNeeded } = await import("../lib/dex/audit.js");
    const path = join(tmp, "audit.jsonl");
    for (let cycle = 0; cycle < 4; cycle++) {
      await fs.writeFile(path, `v${cycle}:` + "x".repeat(200));
      rotateAuditIfNeeded(path, 100, 3);
    }
    // The last rotate moved v3 into a backup; the next append starts a
    // fresh live file — exactly what audit() does.
    await fs.appendFile(path, "v4-new");
    const files = (await fs.readdir(tmp)).filter((f) => f.startsWith("audit.jsonl")).sort();
    expect(files.length).toBeLessThanOrEqual(4); // live + ≤3 backups
    expect(await fs.readFile(path, "utf-8")).toBe("v4-new");
    // v3 survived rotation into a backup slot.
    expect(await fs.readFile(`${path}.1`, "utf-8")).toContain("v3");
  });

  it("token never appears in audit.jsonl or agent.json", async () => {
    await authed("/ram");
    const auditText = await fs.readFile(join(tmp, "dex", "audit.jsonl"), "utf-8").catch(() => "");
    const agentJson = await fs.readFile(join(tmp, "dex", "agent.json"), "utf-8");
    expect(auditText).not.toContain(token);
    expect(agentJson).not.toContain(token);
    expect(auditText).not.toContain("Bearer");
  });

  it("token file is owner-restricted (icacls shows no broad grants)", async () => {
    if (process.platform !== "win32") return;
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("icacls.exe", [join(tmp, "dex", "agent-token")]).toString();
    expect(out).not.toMatch(/Everyone:\(F\)|BUILTIN\\Users:\(F\)|Users:\(F\)/);
  });
});
