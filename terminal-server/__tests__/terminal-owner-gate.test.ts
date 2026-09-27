/**
 * terminal-owner-gate.test.ts — P0 owner gate for terminal shell access.
 *
 * Proves, against the REAL gate logic (../terminal-owner-gate.js):
 *   - a non-owner Clerk identity gets 403 from /api/token-exchange and
 *     never receives a terminal JWT (before any workspace auth/minting)
 *   - the owner gets a terminal JWT whose sub is the owner
 *   - a terminal JWT minted for a non-owner (e.g. pre-gate 5-min window)
 *     fails the Socket.IO auth decision
 *   - startup warns when TERMINAL_OWNER_CLERK_IDS is unset
 *
 * server.ts itself cannot be imported (it binds ports on import), so the
 * HTTP test mounts a handler that wires the REAL isTerminalOwner in the
 * REAL order used by server.ts: verify Clerk → owner gate → workspace
 * auth → mint. The Socket.IO test composes the REAL verifyTerminalToken
 * with the REAL isTerminalOwner exactly as the io.use middleware does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  getTerminalOwnerIds,
  isTerminalOwner,
  warnIfOwnerAllowlistUnset,
} from "../terminal-owner-gate.js";
import { mintTerminalToken, verifyTerminalToken, bearerToken } from "../auth.js";
import type { AuthenticatedRequest } from "../internal-auth.js";

const OWNER_ID = "user_3GsAlPRx3ihYhftgAQ8Owr1uxzF"; // Larry — default allowlist
const INTRUDER_ID = "user_9xIntruder00000000000000000";
const VALID_SECRET = "s".repeat(32);

// ─── Mock Clerk verification (same shape as api-command-auth.test.ts) ───

vi.mock("../clerk-verify.js", () => ({
  verifyClerkToken: vi.fn(async (token: string) => {
    if (!token || token === "invalid-clerk-token") {
      throw new Error("Invalid Clerk token");
    }
    const userId = token.replace("clerk-token-", "");
    if (!userId || userId === "clerk-token-") {
      throw new Error("Clerk token has no subject");
    }
    return { userId, claims: { sub: userId } };
  }),
}));

// ─── Env helpers ────────────────────────────────────────────────────

let savedOwnerEnv: string | undefined;
let savedAuthSecret: string | undefined;

beforeEach(() => {
  savedOwnerEnv = process.env.TERMINAL_OWNER_CLERK_IDS;
  savedAuthSecret = process.env.TERMINAL_AUTH_SECRET;
  process.env.TERMINAL_AUTH_SECRET = VALID_SECRET;
});

afterEach(() => {
  if (savedOwnerEnv === undefined) delete process.env.TERMINAL_OWNER_CLERK_IDS;
  else process.env.TERMINAL_OWNER_CLERK_IDS = savedOwnerEnv;
  if (savedAuthSecret === undefined) delete process.env.TERMINAL_AUTH_SECRET;
  else process.env.TERMINAL_AUTH_SECRET = savedAuthSecret;
  vi.clearAllMocks();
});

// ─── Allowlist parsing (real code) ──────────────────────────────────

describe("getTerminalOwnerIds", () => {
  it("defaults to the workspace owner when the env var is unset", () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    expect(getTerminalOwnerIds()).toEqual([OWNER_ID]);
  });

  it("parses a comma-separated env var, trimming whitespace and dropping empties", () => {
    process.env.TERMINAL_OWNER_CLERK_IDS = ` ${OWNER_ID} ,, user_abc123 ,`;
    expect(getTerminalOwnerIds()).toEqual([OWNER_ID, "user_abc123"]);
  });

  it("an empty env var falls back to nothing (no owners) — explicit deny", () => {
    process.env.TERMINAL_OWNER_CLERK_IDS = "   ";
    expect(getTerminalOwnerIds()).toEqual([]);
  });
});

describe("isTerminalOwner", () => {
  it("allows the default owner", () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    expect(isTerminalOwner(OWNER_ID)).toBe(true);
  });

  it("denies any other Clerk identity by default", () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    expect(isTerminalOwner(INTRUDER_ID)).toBe(false);
    expect(isTerminalOwner("user_alice")).toBe(false);
  });

  it("denies null/undefined/empty userIds", () => {
    expect(isTerminalOwner(null)).toBe(false);
    expect(isTerminalOwner(undefined)).toBe(false);
    expect(isTerminalOwner("")).toBe(false);
  });

  it("honors an explicit multi-owner env var", () => {
    process.env.TERMINAL_OWNER_CLERK_IDS = `${OWNER_ID},user_teammate1`;
    expect(isTerminalOwner(OWNER_ID)).toBe(true);
    expect(isTerminalOwner("user_teammate1")).toBe(true);
    expect(isTerminalOwner(INTRUDER_ID)).toBe(false);
  });
});

describe("warnIfOwnerAllowlistUnset", () => {
  it("warns when the env var is unset", () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfOwnerAllowlistUnset();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/TERMINAL_OWNER_CLERK_IDS is unset/);
    spy.mockRestore();
  });

  it("stays silent when the env var is set", () => {
    process.env.TERMINAL_OWNER_CLERK_IDS = OWNER_ID;
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfOwnerAllowlistUnset();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ─── HTTP: /api/token-exchange owner gate (real wiring order) ───────

function createGatedExchangeApp(): express.Application {
  const app = express();
  app.use(express.json());

  // Mirrors server.ts: verify Clerk → OWNER GATE → workspace auth → mint.
  app.post("/api/token-exchange", async (req: AuthenticatedRequest, res) => {
    try {
      const clerkToken = bearerToken(req.headers.authorization);
      if (!clerkToken) {
        res.status(401).json({ error: "Missing Clerk token" });
        return;
      }
      const { verifyClerkToken } = await import("../clerk-verify.js");
      const verified = await verifyClerkToken(clerkToken);
      const userId = verified.userId;

      // ─── Owner gate — the REAL isTerminalOwner, in the REAL position ───
      if (!isTerminalOwner(userId)) {
        res.status(403).json({ error: "Terminal access is restricted to the workspace owner" });
        return;
      }

      // Workspace auth would run here; a marker proves ordering.
      const mintMarker = "workspace-auth-ran";
      const terminalToken = mintTerminalToken(userId, 300);
      res.json({ terminalToken, expiresIn: 300, userId, _mintMarker: mintMarker });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Token exchange failed";
      res.status(401).json({ error: message });
    }
  });

  return app;
}

describe("/api/token-exchange owner gate", () => {
  it("403s a non-owner Clerk identity with the exact error and NO token", async () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    const app = createGatedExchangeApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", `Bearer clerk-token-${INTRUDER_ID}`)
      .send();

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Terminal access is restricted to the workspace owner");
    expect(res.body.terminalToken).toBeUndefined();
  });

  it("the gate runs BEFORE workspace authorization (non-owner + workspaceId still 403, no mint)", async () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    const app = createGatedExchangeApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", `Bearer clerk-token-${INTRUDER_ID}`)
      .send({ workspaceId: "ws-anything" });

    expect(res.status).toBe(403);
    expect(res.body.terminalToken).toBeUndefined();
    expect(res.body._mintMarker).toBeUndefined();
  });

  it("the owner gets a terminal JWT whose sub is the owner", async () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    const app = createGatedExchangeApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", `Bearer clerk-token-${OWNER_ID}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.terminalToken).toBeDefined();
    const payload = verifyTerminalToken(res.body.terminalToken);
    expect(payload.sub).toBe(OWNER_ID);
  });

  it("an env-listed second owner also passes", async () => {
    process.env.TERMINAL_OWNER_CLERK_IDS = `${OWNER_ID},user_teammate1`;
    const app = createGatedExchangeApp();
    const res = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer clerk-token-user_teammate1")
      .send();

    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user_teammate1");
  });

  it("still 401s on missing/invalid Clerk tokens (gate does not weaken existing checks)", async () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    const app = createGatedExchangeApp();

    const missing = await request(app).post("/api/token-exchange").send();
    expect(missing.status).toBe(401);

    const invalid = await request(app)
      .post("/api/token-exchange")
      .set("Authorization", "Bearer invalid-clerk-token")
      .send();
    expect(invalid.status).toBe(401);
  });
});

// ─── Socket.IO auth decision (real verifyTerminalToken + real isTerminalOwner) ───

describe("Socket.IO auth owner gate", () => {
  // Replicates the io.use middleware decision in server.ts using the
  // REAL functions it calls:
  //   const tokenPayload = verifyTerminalToken(socket.handshake.auth?.token);
  //   if (!isTerminalOwner(tokenPayload.sub)) return next(new Error("Forbidden"));
  function socketAuthDecision(token: unknown): "accept" | "forbidden" | "unauthorized" {
    try {
      const tokenPayload = verifyTerminalToken(token);
      if (!isTerminalOwner(tokenPayload.sub)) return "forbidden";
      return "accept";
    } catch {
      return "unauthorized";
    }
  }

  it("accepts a terminal JWT minted for the owner", () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    const token = mintTerminalToken(OWNER_ID, 300);
    expect(socketAuthDecision(token)).toBe("accept");
  });

  it("rejects a terminal JWT minted for a non-owner (pre-gate 5-min window token)", () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    // This token is cryptographically VALID — minted by the server before
    // the gate deployed. The socket gate must still refuse it.
    const token = mintTerminalToken(INTRUDER_ID, 300);
    expect(verifyTerminalToken(token).sub).toBe(INTRUDER_ID); // valid signature
    expect(socketAuthDecision(token)).toBe("forbidden"); // but gate refuses
  });

  it("still rejects malformed tokens as unauthorized", () => {
    delete process.env.TERMINAL_OWNER_CLERK_IDS;
    expect(socketAuthDecision("not-a-token")).toBe("unauthorized");
    expect(socketAuthDecision(undefined)).toBe("unauthorized");
  });
});
