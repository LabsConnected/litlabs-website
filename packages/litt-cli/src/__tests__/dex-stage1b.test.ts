/**
 * Dex Stage 1B — agent HTTP listener security tests.
 *
 * Real loopback server, real requests. Exercises every rejection layer:
 * Host allowlist (DNS rebinding), browser-header rejection, token
 * verification, method/body restrictions, rate limit, verb allowlist
 * (shot/mutations absent by construction), and sentinel shutdown.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, openSync, readFileSync, writeFileSync, utimesSync, unlinkSync, closeSync } from "node:fs";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startDexAgent, type DexAgent } from "../lib/dex/agent.js";
import { loadOrCreateToken, verifyToken, ownerOnlyAclSpec, DexTokenError } from "../lib/dex/auth-token.js";
import { requestStop, isStopRequested } from "../lib/dex/kill-switch.js";
import { waitAuditIdle } from "../lib/dex/audit.js";
import type { execFileSync } from "node:child_process";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const RACE_FIXTURE = join(__dirname, "fixtures", "dex-race-child.ts");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll `cond` every 25ms until truthy or `timeoutMs` elapses. */
async function waitFor(cond: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(25);
  }
  if (cond()) return;
  throw new Error(`Timed out after ${timeoutMs}ms waiting for: ${label}`);
}

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
  // Let the async audit drain settle before the tmp home disappears —
  // otherwise a pending write fails and poisons the warn-once flags.
  await waitAuditIdle().catch(() => {});
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

  it("token file AND its parent dir are owner-restricted (real icacls)", async () => {
    if (process.platform !== "win32") return;
    const { execFileSync } = await import("node:child_process");
    for (const p of [join(tmp, "dex"), join(tmp, "dex", "agent-token")]) {
      const out = execFileSync("icacls.exe", [p]).toString();
      expect(out).not.toMatch(/Everyone:\(F\)|BUILTIN\\Users:\(F\)|Users:\(F\)/);
      // Owner-only: every ACE line must grant the current user — a stale
      // explicit grant to any other principal would appear here.
      const aces = out.split(/\r?\n/).filter((l) => l.includes(":("));
      expect(aces.length).toBeGreaterThan(0);
      for (const ace of aces) {
        expect(ace).toContain(`${process.env.USERNAME}:(`);
      }
    }
  });
});

describe("N1 — token ACL: atomic owner-only replace, fail closed", () => {
  it("script applies the complete DACL in one write — no permissive intermediate", () => {
    const { cmd, argv, env } = ownerOnlyAclSpec("C:\\dex", "C:\\dex\\agent-token", "BOX\\tester");
    expect(cmd).toBe("powershell.exe");
    expect(argv.slice(0, 5)).toEqual(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"]);
    const script = argv[5]!;
    // The replace is atomic per path: the new DACL is built on an
    // in-memory object — drop inherited rules, purge every ACE, add
    // owner:F — and only ONE SetAccessControl writes it back. No staged
    // icacls sequence → NO window where inherited/broad access is live.
    expect(script).toContain("SetAccessRuleProtection($true,$false)");
    expect(script).toContain("RemoveAccessRule");
    expect(script).toContain("AddAccessRule");
    expect(script).toContain("SetAccessControl");
    expect(script).not.toMatch(/\/reset|\/inheritance|icacls/i);
    // Values travel via env — never interpolated into the script text.
    expect(script).not.toContain("C:\\dex");
    expect(script).not.toContain("BOX\\tester");
    expect(env.LITT_DEX_ACL_DIR).toBe("C:\\dex");
    expect(env.LITT_DEX_ACL_FILE).toBe("C:\\dex\\agent-token");
    expect(env.LITT_DEX_ACL_USER).toBe("BOX\\tester");
  });

  it("hardens the parent dir before create AND dir+file after (structured execFile)", () => {
    // Fresh home → the create path (beforeEach already minted one in tmp).
    const home = join(tmp, "fresh-home");
    process.env.LITT_STATE_HOME = home;
    try {
      const calls: Array<{ cmd: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
      const spy = ((cmd: string, args: string[], opts: { env?: NodeJS.ProcessEnv }) => {
        calls.push({ cmd, args, env: opts?.env ?? {} });
        return Buffer.from("");
      }) as unknown as typeof execFileSync;
      const token = loadOrCreateToken({ platform: "win32", execFile: spy, user: "BOX\\tester" });
      expect(token.length).toBeGreaterThanOrEqual(32);
      // Two passes: (1) before wx-create — dir hardened first so the token
      // is born under owner-only inheritance; (2) after — dir + file.
      expect(calls.length).toBe(2);
      for (const call of calls) {
        expect(call.cmd).toBe("powershell.exe");
        expect(call.env.LITT_DEX_ACL_DIR).toBe(join(home, "dex"));
        expect(call.env.LITT_DEX_ACL_FILE).toBe(join(home, "dex", "agent-token"));
        expect(call.env.LITT_DEX_ACL_USER).toBe("BOX\\tester");
      }
    } finally {
      process.env.LITT_STATE_HOME = tmp;
    }
  });

  it("fails closed when the ACL cannot be applied", () => {
    const throwing = (() => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    }) as unknown as typeof execFileSync;
    expect(() => loadOrCreateToken({ platform: "win32", execFile: throwing })).toThrow(DexTokenError);
  });

  it("fails closed on chmod failure too (non-Windows path)", () => {
    const badChmod = () => {
      throw Object.assign(new Error("denied"), { code: "EPERM" });
    };
    expect(() => loadOrCreateToken({ platform: "linux", chmod: badChmod })).toThrow(DexTokenError);
  });

  it("posix path: dir 0700 before create, file 0600 after", () => {
    const seen: Array<[string, number]> = [];
    const chmod = (p: string, mode: number) => {
      seen.push([p, mode]);
    };
    loadOrCreateToken({ platform: "linux", chmod });
    const dir = join(tmp, "dex");
    const file = join(dir, "agent-token");
    expect(seen[0]).toEqual([dir, 0o700]); // dir hardened BEFORE create
    expect(seen).toContainEqual([file, 0o600]);
  });
});

describe("R2 — concurrent token creation", () => {
  it("a fresh unusable remnant fails closed — never unlinked mid-write", () => {
    const file = join(tmp, "dex", "agent-token");
    writeFileSync(file, "corrupt", "utf-8"); // too short to be a token
    // mtime is fresh — a slow winner could own this file; refuse.
    expect(() => loadOrCreateToken({ platform: "linux" })).toThrow(DexTokenError);
    expect(readFileSync(file, "utf-8")).toBe("corrupt"); // untouched
  });

  it("a stale remnant is reclaimed exactly once", () => {
    const file = join(tmp, "dex", "agent-token");
    writeFileSync(file, "corrupt", "utf-8");
    const old = new Date(Date.now() - 60_000);
    utimesSync(file, old, old); // dead create from a minute ago
    const token = loadOrCreateToken({ platform: "linux" });
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(file, "utf-8")).toBe(token);
  });

  const pkgRoot = join(__dirname, "..", "..");
  const spawnTokenChild = (home: string, outFile: string, holdMs = 0): ChildProcess =>
    spawn(process.execPath, ["--import", "tsx", RACE_FIXTURE, "token", "t", outFile], {
      cwd: pkgRoot,
      env: {
        ...process.env,
        LITT_STATE_HOME: home,
        LITT_DEX_TOKEN_CREATE_HOLD_MS: String(holdMs),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

  it("two racing processes converge on ONE persisted token", async () => {
    const home = join(tmp, "dex-race");
    const outA = join(tmp, "tok-a.out");
    const outB = join(tmp, "tok-b.out");
    const tokenFile = join(home, "dex", "agent-token");

    // A creates the file then holds the write open — B is spawned only
    // once the (still empty) token file provably exists, so B lands in
    // the EEXIST branch and must wait for A's write.
    const a = spawnTokenChild(home, outA, 2000);
    await waitFor(() => existsSync(tokenFile), 30_000, "A to create the token file");
    const b = spawnTokenChild(home, outB);
    let aErr = "";
    let bErr = "";
    a.stderr?.on("data", (d) => (aErr += d));
    b.stderr?.on("data", (d) => (bErr += d));
    const [aCode, bCode] = await Promise.all([
      new Promise<number>((r) => a.on("exit", (c) => r(c ?? -1))),
      new Promise<number>((r) => b.on("exit", (c) => r(c ?? -1))),
    ]);
    expect(aCode, `child A failed: ${aErr}`).toBe(0);
    expect(bCode, `child B failed: ${bErr}`).toBe(0);
    await waitFor(() => existsSync(outA) && existsSync(outB), 10_000, "both token outputs");

    const tokA = readFileSync(outA, "utf-8");
    const tokB = readFileSync(outB, "utf-8");
    const onDisk = readFileSync(tokenFile, "utf-8");
    expect(tokA).toBe(onDisk);
    expect(tokB).toBe(onDisk); // loser adopted the winner's token
    expect(aErr).not.toContain(onDisk); // token never leaks to stdio
    expect(bErr).not.toContain(onDisk);
  }, 60_000);
});

describe("R3 — transport timeouts", () => {
  it("destroys a connection whose headers never complete", async () => {
    const url = new URL(agent.url);
    const sock = net.connect({ host: url.hostname, port: Number(url.port) });
    await new Promise((r) => sock.on("connect", r));
    // Incomplete header block — no terminating CRLF. The per-request
    // timeout inside the handler can never see this; on Node 22 a stalled
    // partial header block also escapes headersTimeout — the server-level
    // socket-inactivity timeout (6s) is what destroys the socket.
    sock.write(`GET /ram HTTP/1.1\r\nHost: 127.0.0.1:${url.port}\r\nX-Partial:`);
    const t0 = Date.now();
    await new Promise<void>((r) => sock.once("close", () => r()));
    expect(Date.now() - t0).toBeLessThan(9_000);
    // Listener stays healthy afterward.
    expect((await authed("/ram")).status).toBe(200);
  }, 20_000);
});

describe("R4 — audit rotation under cross-process writers", () => {
  const dexDir = () => join(tmp, "dex");
  const auditFile = () => join(dexDir(), "audit.jsonl");
  const lockFile = () => `${auditFile()}.lock`;

  it("a held lock blocks a peer for a bounded wait, then fails honestly", async () => {
    const { auditWithLock } = await import("../lib/dex/audit.js");
    const fd = openSync(lockFile(), "wx");
    closeSync(fd);
    const t0 = Date.now();
    expect(() => auditWithLock(auditFile(), () => "never", { waitMs: 300, pollMs: 10 })).toThrow();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3_000);
    expect(existsSync(lockFile())).toBe(true); // peer's lock untouched
  });

  it("reclaims an abandoned (stale) lock left by a dead holder", async () => {
    const { auditWithLock } = await import("../lib/dex/audit.js");
    const fd = openSync(lockFile(), "wx");
    closeSync(fd);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockFile(), old, old); // pretend a holder died a minute ago
    const result = auditWithLock(auditFile(), () => "ran", { waitMs: 5_000, staleMs: 30_000, pollMs: 10 });
    expect(result).toBe("ran");
    expect(existsSync(lockFile())).toBe(false); // released on exit
  });

  it("two racing processes preserve record integrity through rotations", async () => {
    const home = join(tmp, "audit-race");
    const outA = join(tmp, "audit-a.out");
    const outB = join(tmp, "audit-b.out");
    const file = join(home, "dex", "audit.jsonl");
    const lock = `${file}.lock`;
    const pkgRoot = join(__dirname, "..", "..");
    const spawnAuditChild = (tag: string, outFile: string, holdMs = 0): ChildProcess =>
      spawn(process.execPath, ["--import", "tsx", RACE_FIXTURE, "audit", tag, outFile, "25"], {
        cwd: pkgRoot,
        env: { ...process.env, LITT_STATE_HOME: home, LITT_DEX_AUDIT_LOCK_HOLD_MS: String(holdMs) },
        stdio: ["ignore", "pipe", "pipe"],
      });

    const a = spawnAuditChild("rA", outA, 300);
    await waitFor(() => existsSync(lock), 30_000, "A to take the audit lock");
    const b = spawnAuditChild("rB", outB);
    let aErr = "";
    let bErr = "";
    a.stderr?.on("data", (d) => (aErr += d));
    b.stderr?.on("data", (d) => (bErr += d));
    const [aCode, bCode] = await Promise.all([
      new Promise<number>((r) => a.on("exit", (c) => r(c ?? -1))),
      new Promise<number>((r) => b.on("exit", (c) => r(c ?? -1))),
    ]);
    expect(aCode, `child A failed: ${aErr}`).toBe(0);
    expect(bCode, `child B failed: ${bErr}`).toBe(0);
    await waitFor(() => existsSync(outA) && existsSync(outB), 10_000, "both audit outputs");

    // Integrity: every surviving line across live + rotated backups is a
    // complete race record — a half-seen rotation would leave torn JSON,
    // foreign prefixes, or a duplicated live file.
    const dir = join(home, "dex");
    const files = (await fs.readdir(dir)).filter((f) => f.startsWith("audit.jsonl"));
    expect(files.length).toBeLessThanOrEqual(4); // live + ≤3 backups
    let records = 0;
    for (const f of files) {
      for (const line of (await fs.readFile(join(dir, f), "utf-8")).trim().split("\n")) {
        if (!line) continue;
        const rec = JSON.parse(line); // throws on a torn line
        expect(rec.verb).toBe("race");
        expect(rec.detail).toMatch(/^r[AB]-\d+$/);
        records++;
      }
    }
    expect(records).toBeGreaterThan(0);
    expect(records).toBeLessThanOrEqual(50);
    expect(existsSync(lock)).toBe(false); // no lock leaked
  }, 60_000);
});

describe("N2 — nonblocking audit for the long-lived agent", () => {
  const lockFile = () => join(tmp, "dex", "audit.jsonl.lock");
  const pkgRoot = join(__dirname, "..", "..");

  it("request path stays responsive while a peer holds the audit lock", async () => {
    const out = join(tmp, "held.out");
    const child = spawn(process.execPath, ["--import", "tsx", RACE_FIXTURE, "holdlock", "h", out], {
      cwd: pkgRoot,
      env: { ...process.env, LITT_STATE_HOME: tmp, LITT_DEX_AUDIT_LOCK_HOLD_MS: "1500" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let childErr = "";
    child.stderr?.on("data", (d) => (childErr += d));
    await waitFor(() => existsSync(out), 20_000, "child to hold the audit lock");
    const t0 = Date.now();
    const r1 = await authed("/ram");
    const r2 = await authed("/status");
    const elapsed = Date.now() - t0;
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // The lock was still held — the loop stayed free (records queued,
    // not waited-on). A blocking audit would stall ≥ the remaining hold.
    expect(elapsed).toBeLessThan(1_300);
    const code = await new Promise<number>((r) => child.on("exit", (c) => r(c ?? -1)));
    expect(code, `holdlock child failed: ${childErr}`).toBe(0);
    // Queued records actually landed once the lock freed.
    await waitAuditIdle();
    expect(readFileSync(join(tmp, "dex", "audit.jsonl"), "utf-8")).toContain("http:GET /ram");
  }, 30_000);

  it("emergency stop never waits on the audit lock", async () => {
    // Fresh lock held by THIS process — a live holder, not reclaimable.
    const fd = openSync(lockFile(), "wx", 0o600);
    const t0 = Date.now();
    requestStop();
    await agent.ready; // halt path never touches the lock synchronously
    const elapsed = Date.now() - t0;
    // sentinel poll 500ms + slack — a blocking audit would add ~2s.
    expect(elapsed).toBeLessThan(2_000);
    closeSync(fd); // close BEFORE unlink — required on Windows
    unlinkSync(lockFile());
    await waitAuditIdle();
  }, 15_000);

  it("queued records land FIFO once the lock frees", async () => {
    const { auditSoon } = await import("../lib/dex/audit.js");
    await waitAuditIdle(); // settle records from startup
    auditSoon({ verb: "q", ok: true, ms: 0, detail: "q-a" });
    auditSoon({ verb: "q", ok: true, ms: 0, detail: "q-b" });
    auditSoon({ verb: "q", ok: true, ms: 0, detail: "q-c" });
    await waitAuditIdle();
    const text = readFileSync(join(tmp, "dex", "audit.jsonl"), "utf-8");
    expect(text.indexOf("q-a")).toBeGreaterThanOrEqual(0);
    expect(text.indexOf("q-a")).toBeLessThan(text.indexOf("q-b"));
    expect(text.indexOf("q-b")).toBeLessThan(text.indexOf("q-c"));
  });

  it("a record that outlives its bounded wait is dropped and reported once", async () => {
    const { auditSoon } = await import("../lib/dex/audit.js");
    await waitAuditIdle();
    const fd = openSync(lockFile(), "wx", 0o600); // held fresh past both waits
    const warns: string[] = [];
    auditSoon({ verb: "q", ok: true, ms: 0, detail: "q1" }, { onWarn: (m) => warns.push(m) });
    auditSoon({ verb: "q", ok: true, ms: 0, detail: "q2" }, { onWarn: (m) => warns.push(m) });
    const t0 = Date.now();
    await waitAuditIdle(); // each record exhausts its ~2s bound then drops
    expect(Date.now() - t0).toBeGreaterThanOrEqual(3_500);
    expect(warns.length).toBe(1); // warn-once, not per record
    expect(warns[0]).toContain("dropped");
    expect(warns[0]).not.toMatch(/[A-Za-z]:\\|\/tmp\//); // sanitized: errno only, no paths
    closeSync(fd);
    unlinkSync(lockFile());
    await waitAuditIdle();
  }, 20_000);
});
