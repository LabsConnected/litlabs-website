import dotenv from "dotenv";
import path from "path";
import fs from "fs";

// Load .env.local first, then .env
const envLocalPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
}
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import { isAbsolute, relative, resolve } from "path";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync, renameSync } from "fs";
import type { NextFunction, Request, Response } from "express";
import { isBlockedCommand, auditCommand, getAuditLog } from "./security";
import { handleLiTTCodeCommand, type LiTTEvent } from "./litt-code";
import { streamLiTTOperator } from "./litt-agent";
import { runLiTTOperator, operatorAvailable } from "./litt-operator";
import { dispatchMobileCommand } from "./mobile-commands";
import {
  initRuntime,
  runtimeCommandStart,
  runtimeCommandEnd,
  runtimeSetPhase,
  getRuntimeState,
  getExecutionGateway,
} from "./runtime";
import {
  prepareWorkspace,
  prepareBlankWorkspace,
  getWorkspace,
  listWorkspaces,
  type WorkspaceDescriptor,
} from "./workspace/WorkspaceManager";
import {
  startPreview,
  stopPreview,
  restartPreview,
  getPreviewStatus,
  getPreviewLogs,
  verifyPreviewHealth,
  type PreviewStatus,
} from "./preview/PreviewManager";
import { dispatchCommand } from "./command-bridge";
import { PtySessionManager, type PtySessionSnapshot } from "./pty-session-manager";
import { requireInternalServiceAuth, type AuthenticatedRequest } from "./internal-auth";
import { mintTerminalToken, verifyTerminalToken, bearerToken } from "./auth";
import { verifyClerkToken } from "./clerk-verify";
import { checkEntitlement, recordUsage, estimateCoinCost, entitlementReady } from "./entitlement";
import type { RemoteCommandRequest } from "@litt/agent-core";

const PORT = Number(process.env.PORT || process.env.TERMINAL_SERVER_PORT || 4001);
const ALLOWED_ORIGINS = [
  ...(process.env.TERMINAL_ALLOWED_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // Always allow local development origins
  "http://localhost:3000",
  "http://localhost:3001",
].filter((v, i, arr) => arr.indexOf(v) === i); // dedupe
const WORKSPACE_ROOT = process.env.TERMINAL_WORKSPACE_ROOT || resolve("/tmp/littree-workspaces");
const USE_DOCKER = process.env.TERMINAL_USE_DOCKER === "true";

const MAX_READ_SIZE = 2 * 1024 * 1024;
const MAX_WRITE_SIZE = 1 * 1024 * 1024;
const MAX_PATH_LENGTH = 4096;

/**
 * Probe whether Docker is actually available — not just whether the env var
 * is set. Checks that the Docker CLI exists, the daemon responds, and (when
 * Docker mode is enabled) the required image and network exist.
 *
 * Result is cached for 30s to avoid spawning `docker` on every health check.
 */
let dockerProbeCache: { value: boolean; reason: string; at: number } | null = null;
const DOCKER_PROBE_TTL_MS = 30_000;

async function probeDockerAvailability(): Promise<{ value: boolean; reason: string }> {
  if (!USE_DOCKER) return { value: false, reason: "TERMINAL_USE_DOCKER is not set to true" };
  if (dockerProbeCache && Date.now() - dockerProbeCache.at < DOCKER_PROBE_TTL_MS) {
    return { value: dockerProbeCache.value, reason: dockerProbeCache.reason };
  }

  const { execFile } = await import("child_process");
  const image = process.env.DOCKER_TERMINAL_IMAGE || "littree-terminal:latest";

  const checkCmd = (args: string[]): Promise<{ ok: boolean; stderr: string }> =>
    new Promise((resolve) => {
      execFile("docker", args, { timeout: 5000 }, (_err, _stdout, stderr) => {
        resolve({ ok: !_err, stderr: (stderr || "").trim() });
      });
    });

  // 1. Is the Docker daemon running?
  const daemon = await checkCmd(["info", "--format", "{{.ServerVersion}}"]);
  if (!daemon.ok) {
    dockerProbeCache = { value: false, reason: "Docker daemon not reachable", at: Date.now() };
    return { value: false, reason: "Docker daemon not reachable" };
  }

  // 2. Does the required image exist?
  const imageCheck = await checkCmd(["image", "inspect", image]);
  if (!imageCheck.ok) {
    dockerProbeCache = { value: false, reason: `Image ${image} not found`, at: Date.now() };
    return { value: false, reason: `Image ${image} not found` };
  }

  // 3. Does the required network exist?
  const networkCheck = await checkCmd(["network", "inspect", "littree-terminal"]);
  if (!networkCheck.ok) {
    dockerProbeCache = { value: false, reason: "Network littree-terminal not found", at: Date.now() };
    return { value: false, reason: "Network littree-terminal not found" };
  }

  dockerProbeCache = { value: true, reason: "ok", at: Date.now() };
  return { value: true, reason: "ok" };
}

if (process.env.NODE_ENV === "production" && !USE_DOCKER) {
  console.warn(
    "[Terminal] WARNING: Running in production without Docker isolation (TERMINAL_USE_DOCKER=false). " +
      "PTY sessions will run directly on the host with no container isolation. " +
      "This is acceptable for Railway deployments but less secure than Docker mode. " +
      "Set TERMINAL_USE_DOCKER=true and provide a Docker daemon for full isolation.",
  );
}

// Warn if workspace root is the ephemeral default in production — cloned
// repositories and the workspace registry (.workspaces.json) will be lost
// on every container restart. Operators should mount a persistent volume
// and set TERMINAL_WORKSPACE_ROOT to that path.
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.TERMINAL_WORKSPACE_ROOT || WORKSPACE_ROOT.startsWith("/tmp"))
) {
  console.warn(
    "[Terminal] WARNING: TERMINAL_WORKSPACE_ROOT is not set or points to /tmp. " +
      "Workspaces will be lost on restart. Mount a persistent volume and set " +
      "TERMINAL_WORKSPACE_ROOT to the mounted path (e.g. /data/littree-workspaces).",
  );
}

mkdirSync(WORKSPACE_ROOT, { recursive: true });

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ─── Canonical runtime authority ──────────────────────────────────
// One RuntimeStore owns the truth. Socket.IO clients receive a full
// snapshot on connect and incremental updates on every mutation.
// server.ts does NOT create another parallel state object.
initRuntime(io);

// ─── PTY session manager ───────────────────────────────────────────
// Canonical PTY lifecycle: create/input/resize/kill/snapshot with
// idle timeout, absolute lifetime, and max concurrent PTYs per user.
const ptyManager = new PtySessionManager();
ptyManager.startSweeper();

app.get("/health/live", (_req, res) => {
  res.json({
    service: "terminal-server",
    status: "alive",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Runtime state endpoint ───────────────────────────────────────
// Returns the canonical runtime snapshot. Both PowerShell and litbit-web
// can poll this or use Socket.IO for realtime updates.
app.get("/internal/runtime", requireInternalServiceAuth, (_req: AuthenticatedRequest, res: Response) => {
  res.json(getRuntimeState());
});

// ─── Token exchange: Clerk token → short-lived terminal JWT ───────
// POST /api/token-exchange
//
// Security chain:
//   CLI/Desktop/Mobile (authenticated Clerk user)
//     → sends Clerk-issued JWT (Authorization: Bearer <clerk-token>)
//     → terminal-server verifies Clerk token server-side (CLERK_SECRET_KEY)
//     → server derives userId from verified Clerk token (NOT from request body)
//     → server mints short-lived terminal JWT (5 min TTL) using TERMINAL_AUTH_SECRET
//     → returns terminal JWT to client
//     → client uses terminal JWT for /api/command, /api/runtime, /api/cancel
//
// The client NEVER touches TERMINAL_AUTH_SECRET or CLERK_SECRET_KEY.
// The terminal JWT is short-lived (5 min) and must be refreshed via
// another token exchange.
app.post("/api/token-exchange", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const clerkToken = bearerToken(req.headers.authorization);
    if (!clerkToken) {
      res.status(401).json({ error: "Missing Clerk token" });
      return;
    }

    // ─── 1. Verify the Clerk token server-side ────────────────────
    // userId comes from the verified token, NOT from the request body.
    const verified = await verifyClerkToken(clerkToken);
    const userId = verified.userId;

    // ─── 2. Workspace/project authorization (server-side) ────────
    // If the client requests a specific workspaceId, verify the
    // workspace exists AND belongs to the authenticated user.
    // This prevents cross-user workspace access.
    //
    // The workspaceId is NOT trusted from the request body for
    // identity — it's only used for authorization after the user
    // has been verified via the Clerk token.
    const body = req.body ?? {};
    const requestedWorkspaceId = typeof body.workspaceId === "string" ? body.workspaceId : null;
    let authorizedWorkspaceId: string | undefined;
    let authorizedProjectId: string | undefined;
    let authorizedWorkspaceRoot: string | undefined;

    if (requestedWorkspaceId) {
      const ws = getWorkspace(requestedWorkspaceId);
      if (!ws) {
        res.status(404).json({ error: "Workspace not found" });
        return;
      }
      // ─── Ownership check: workspace must belong to the verified user ──
      if (ws.userId !== userId) {
        res.status(403).json({
          error: "Forbidden — workspace does not belong to the authenticated user",
        });
        return;
      }
      authorizedWorkspaceId = ws.workspaceId;
      authorizedProjectId = ws.projectId;
      authorizedWorkspaceRoot = ws.root;
    }

    // ─── 3. Mint a short-lived terminal JWT (5 min TTL) ──────────
    // The terminal JWT embeds the verified userId and optionally the
    // authorized workspaceId/projectId. The client cannot forge these
    // claims — they come from server-side verification.
    const terminalToken = authorizedWorkspaceId
      ? mintTerminalToken(userId, 300, {
          workspaceId: authorizedWorkspaceId,
          projectId: authorizedProjectId,
          cwd: authorizedWorkspaceRoot,
        })
      : mintTerminalToken(userId, 300);

    res.json({
      terminalToken,
      expiresIn: 300,
      userId, // returned for client convenience; the token is the authority
      workspaceId: authorizedWorkspaceId,
      projectId: authorizedProjectId,
      workspaceRoot: authorizedWorkspaceRoot,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token exchange failed";
    res.status(401).json({ error: message });
  }
});

// ─── Token revocation: server-side logout ─────────────────────────
// POST /api/revoke — revokes the caller's terminal JWT session.
//
// This clears the server-side session state associated with the
// terminal JWT. The CLI also clears local credentials and revokes
// the Clerk refresh token via Clerk's /oauth/revoke endpoint.
//
// Security: requires a valid terminal JWT (user-authenticated).
app.post("/api/revoke", (req: AuthenticatedRequest, res: Response) => {
  try {
    const payload = verifyTerminalToken(bearerToken(req.headers.authorization));
    // The terminal JWT is stateless (HMAC-signed), so there's no
    // server-side session to revoke — the token simply expires.
    // This endpoint exists for API completeness and future session
    // tracking. The client-side logout (clearing credentials + Clerk
    // refresh token revocation) is the effective logout path.
    res.json({ revoked: true, userId: payload.sub });
  } catch {
    // Even if the token is invalid/expired, return success — the
    // client is already clearing local credentials.
    res.json({ revoked: true });
  }
});

// ─── User-authenticated runtime state endpoint ────────────────────
// GET /api/runtime — returns the canonical runtime snapshot using
// USER authentication (terminal JWT minted by /api/token-exchange).
app.get("/api/runtime", (req: AuthenticatedRequest, res: Response) => {
  try {
    verifyTerminalToken(bearerToken(req.headers.authorization));
    res.json(getRuntimeState());
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
});

// ─── User-authenticated cancel endpoint ───────────────────────────
// POST /api/cancel — cancel the currently active run using USER auth.
app.post("/api/cancel", (req: AuthenticatedRequest, res: Response) => {
  try {
    verifyTerminalToken(bearerToken(req.headers.authorization));
  } catch {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const runId = String(req.body?.runId ?? "");
  if (!runId) {
    res.status(400).json({ error: "Missing 'runId'" });
    return;
  }
  // TODO: wire to actual cancel — for now returns ok
  res.json({ ok: true, runId });
});

// ─── Remote inference endpoint (SSE) ───────────────────────────────
// POST /api/inference — stream model inference from the server's
// provider key. This is the customer-facing path: a paid LiTT user
// with NO local OPENROUTER_API_KEY gets inference served here.
//
// Flow:
//   1. Verify terminal JWT → extract userId (Clerk ID)
//   2. checkEntitlement(userId) → subscription + credits
//      - 402 if not entitled (clean message, never an API-key error)
//   3. runLiTTOperator() with the server's OPENROUTER_API_KEY
//   4. Stream deltas back as SSE events:
//        event: meta\ndata: {"provider":"openrouter","model":"..."}
//        event: delta\ndata: {"text":"..."}
//        event: done\ndata: {"model":"...","usage":{...}}
//        event: error\ndata: {"message":"..."}
//   5. recordUsage() — ledger + coin debit (best-effort)
//
// The server's OPENROUTER_API_KEY NEVER appears in any response,
// header, log line, or event. The CLI only sees model deltas.
app.post("/api/inference", async (req: AuthenticatedRequest, res: Response) => {
  // ─── 1. Verify user JWT ──────────────────────────────────────────
  let clerkId: string;
  try {
    const token = bearerToken(req.headers.authorization);
    const payload = verifyTerminalToken(token);
    clerkId = payload.sub;
  } catch {
    res.status(401).json({ error: "Unauthorized — valid terminal token required" });
    return;
  }

  // ─── 2. Validate request body ────────────────────────────────────
  const body = req.body as {
    prompt?: string;
    messages?: Array<{ role: string; content: string }>;
    cwd?: string;
    mode?: "plan" | "act" | "auto";
  };
  const prompt = body?.prompt;
  const messages = body?.messages;
  if (!prompt && !messages) {
    res.status(400).json({ error: "Missing 'prompt' or 'messages'" });
    return;
  }

  // Build the prompt — prefer explicit prompt, else reconstruct from messages
  const finalPrompt = prompt ?? (messages ?? [])
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const cwd = body.cwd ?? process.cwd();
  const mode = body.mode ?? "act";

  // ─── 3. Entitlement check (subscription + credits) ───────────────
  const entitlement = await checkEntitlement(clerkId);
  if (!entitlement.entitled) {
    res.status(402).json({
      error: entitlement.reason,
      code: entitlement.code,
      plan: entitlement.plan,
      coinBalance: entitlement.coinBalance,
    });
    return;
  }

  // ─── 4. Set up SSE ───────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering
  res.flushHeaders?.();

  // Helper: send an SSE event
  const sendEvent = (event: string, data: unknown): void => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Track whether we've sent a terminal event (done/error) to avoid
  // duplicate terminal events if both the stream handler and the
  // outer try/catch fire.
  let terminated = false;
  const finish = (): void => {
    if (terminated) return;
    terminated = true;
    res.end();
  };

  // Client disconnect handling
  const onClose = (): void => {
    terminated = true;
  };
  req.on("close", onClose);

  // ─── 5. Run the operator with streaming ──────────────────────────
  try {
    const result = await runLiTTOperator({
      prompt: finalPrompt,
      cwd,
      userId: clerkId,
      mode,
      onModelStream: (event) => {
        if (terminated) return;
        switch (event.type) {
          case "meta":
            sendEvent("meta", {
              provider: event.provider,
              model: event.model,
              profile: event.profile,
            });
            break;
          case "delta":
            sendEvent("delta", { text: event.text });
            break;
          case "done":
            sendEvent("done", {
              model: event.model,
              usage: event.usage,
              timing: event.timing,
            });
            break;
          case "error":
            sendEvent("error", { message: event.message });
            break;
        }
      },
    });

    // ─── 6. Record usage (best-effort) ─────────────────────────────
    const totalTokens = result.usage?.total_tokens ?? 0;
    const coinsDebited = estimateCoinCost(totalTokens, entitlement.plan);
    // Cost estimate: rough $0.002 per 1K tokens (varies by model, but
    // this is a conservative average for ledger analytics)
    const costUsd = (totalTokens / 1000) * 0.002;

    await recordUsage({
      clerkId,
      provider: "openrouter",
      model: "remote-inference",
      promptTokens: 0, // not separately tracked in operator result
      completionTokens: totalTokens,
      totalTokens,
      costUsd,
      coinsDebited,
      runId: result.runId,
      mode,
      durationMs: result.durationMs,
    }).catch(() => { /* best-effort */ });

    // Send a final completion event with the full content + runId
    if (!terminated) {
      sendEvent("complete", {
        runId: result.runId,
        content: result.content,
        termination: result.termination,
        rounds: result.rounds,
        toolCalls: result.toolCalls.length,
        coinsDebited,
      });
    }
    finish();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!terminated) {
      sendEvent("error", { message });
    }
    finish();
  }
});

// ─── Command bridge endpoint ──────────────────────────────────────
// POST /internal/command — dispatch a slash command through the
// canonical command registry. Both Studio Web, `litt --remote`, and
// the PowerShell cockpit hit this endpoint.
//
// The command registry is the single source of truth for all commands.
// Unknown commands produce a controlled error response — never a crash.
app.post("/internal/command", requireInternalServiceAuth, async (req: AuthenticatedRequest, res: Response) => {
  const body = req.body as RemoteCommandRequest;
  if (!body?.command || typeof body.command !== "string") {
    res.status(400).json({ error: "Missing 'command' field" });
    return;
  }
  // Normalize: ensure `args` is always a string[] (never undefined).
  // The canonical protocol requires structured argv; we coerce here
  // rather than reject so legacy clients sending `{command, args: {...}}`
  // get a controlled failure instead of a 500.
  if (body.args !== undefined && !Array.isArray(body.args)) {
    res.status(400).json({ error: "'args' must be a string[] (structured argv)" });
    return;
  }
  const normalizedReq: RemoteCommandRequest = {
    ...body,
    args: Array.isArray(body.args) ? body.args.filter((a) => typeof a === "string") : [],
    userId: body.userId ?? req.terminalUserId ?? null,
  };
  try {
    const result = await dispatchCommand(normalizedReq);
    // Unknown commands and command-level failures return HTTP 200 with
    // ok:false so the client can display the typed error. Only server
    // errors get HTTP 500.
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ─── User-authenticated command endpoint ──────────────────────────
// POST /api/command — dispatch a command through the canonical command
// registry using USER authentication (terminal JWT), NOT the internal
// service key. This is the endpoint `litt --remote` should use.
//
// Security chain:
//   CLI authenticated user
//     → signed user token (Authorization: Bearer <token>)
//     → terminal-server verifies identity via verifyTerminalToken
//     → userId extracted from JWT (NOT from request body)
//     → authorized workspace/project
//     → ExecutionGateway
//
// A user CANNOT specify another userId, workspaceId, or project and
// gain access — the userId comes from the verified JWT, and workspace
// ownership is validated against that userId.
app.post("/api/command", async (req: AuthenticatedRequest, res: Response) => {
  // ─── 1. Verify user JWT ──────────────────────────────────────────
  let userId: string;
  try {
    const token = bearerToken(req.headers.authorization);
    const payload = verifyTerminalToken(token);
    userId = payload.sub;
  } catch {
    res.status(401).json({ error: "Unauthorized — valid terminal token required" });
    return;
  }

  // ─── 2. Validate request body ────────────────────────────────────
  const body = req.body as RemoteCommandRequest;
  if (!body?.command || typeof body.command !== "string") {
    res.status(400).json({ error: "Missing 'command' field" });
    return;
  }
  if (body.args !== undefined && !Array.isArray(body.args)) {
    res.status(400).json({ error: "'args' must be a string[] (structured argv)" });
    return;
  }

  // ─── 3. Build authenticated request ──────────────────────────────
  // userId comes from the VERIFIED JWT — NOT from the request body.
  // A user cannot impersonate another user by setting userId in the body.
  // workspaceId/cwd are validated against the user's workspace root.
  const workspaceRoot = process.env.TERMINAL_WORKSPACE_ROOT ?? "";
  const userWorkspaceRoot = workspaceRoot
    ? resolve(workspaceRoot, userId)
    : process.cwd();

  // If the request specifies a cwd, validate it's within the user's workspace.
  // This prevents cross-user workspace access.
  let cwd = body.cwd ?? userWorkspaceRoot;
  if (workspaceRoot) {
    const resolvedCwd = resolve(cwd);
    const resolvedUserRoot = resolve(userWorkspaceRoot);
    const rel = relative(resolvedUserRoot, resolvedCwd);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      res.status(403).json({
        error: "Forbidden — cwd is outside your workspace",
      });
      return;
    }
  }

  const normalizedReq: RemoteCommandRequest = {
    ...body,
    args: Array.isArray(body.args) ? body.args.filter((a) => typeof a === "string") : [],
    // userId from the JWT — overrides any value in the body
    userId,
    // cwd validated to be within the user's workspace
    cwd,
  };

  try {
    const result = await dispatchCommand(normalizedReq);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get("/health/ready", async (_req, res) => {
  const authConfigured = (process.env.TERMINAL_AUTH_SECRET?.length ?? 0) >= 32;
  const internalServiceConfigured = (process.env.TERMINAL_INTERNAL_SERVICE_KEY?.length ?? 0) >= 32;
  const workspaceRoot = process.env.TERMINAL_WORKSPACE_ROOT ?? "";
  const workspaceReady = workspaceRoot.length > 0;
  const dockerProbe = await probeDockerAvailability();
  const entitlementConfigured = await entitlementReady().catch(() => false);

  const checks = {
    authConfigured,
    internalServiceConfigured,
    workspaceRoot: workspaceReady,
    docker: dockerProbe.value,
    dockerReason: dockerProbe.reason,
    entitlement: entitlementConfigured,
  };

  // Docker readiness is reported but does NOT block the overall readiness
  // in development (host PTY mode). In production, Docker mode is required
  // by the startup guard, so if the probe fails the health check will
  // correctly report docker: false.
  const allReady = authConfigured && internalServiceConfigured && workspaceReady;

  res.status(allReady ? 200 : 503).json({
    service: "terminal-server",
    readiness: allReady ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    checks,
    reasons: allReady
      ? []
      : [
          !authConfigured ? "TERMINAL_AUTH_SECRET not configured (min 32 chars)" : "",
          !internalServiceConfigured ? "TERMINAL_INTERNAL_SERVICE_KEY not configured (min 32 chars)" : "",
          !workspaceReady ? "TERMINAL_WORKSPACE_ROOT not set" : "",
        ].filter(Boolean),
  });
});

// Backward-compatible /health — returns readiness check
app.get("/health", async (_req, res) => {
  const authConfigured = (process.env.TERMINAL_AUTH_SECRET?.length ?? 0) >= 32;
  const internalServiceConfigured = (process.env.TERMINAL_INTERNAL_SERVICE_KEY?.length ?? 0) >= 32;
  const workspaceRoot = process.env.TERMINAL_WORKSPACE_ROOT ?? "";
  const workspaceReady = workspaceRoot.length > 0;
  const dockerProbe = await probeDockerAvailability();
  const allReady = authConfigured && internalServiceConfigured && workspaceReady;

  res.status(allReady ? 200 : 503).json({
    service: "terminal-server",
    status: allReady ? "ok" : "degraded",
    uptime: process.uptime(),
    activeSessions: ptyManager.size,
    timestamp: new Date().toISOString(),
    readiness: allReady ? "ready" : "not_ready",
    checks: {
      authConfigured,
      internalServiceConfigured,
      workspaceRoot: workspaceReady,
      docker: dockerProbe.value,
      dockerReason: dockerProbe.reason,
    },
    reasons: allReady
      ? []
      : [
          !authConfigured ? "TERMINAL_AUTH_SECRET not configured (min 32 chars)" : "",
          !internalServiceConfigured ? "TERMINAL_INTERNAL_SERVICE_KEY not configured (min 32 chars)" : "",
          !workspaceReady ? "TERMINAL_WORKSPACE_ROOT not set" : "",
        ].filter(Boolean),
  });
});

// Audit log endpoint (service-to-service only)
app.get("/internal/audit-log", requireInternalServiceAuth, (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(Number(req.query?.limit) || 100, 1000);
  res.json({ entries: getAuditLog(limit) });
});

// ─── PTY session status endpoint ──────────────────────────────────
// Returns active PTY session snapshots (safe shape — no ptyProcess handle).
// Service-to-service only (requires internal service key).
app.get("/internal/sessions", requireInternalServiceAuth, (req: AuthenticatedRequest, res: Response) => {
  const userId = req.terminalUserId;
  const sessions = userId
    ? ptyManager.snapshotByUser(userId)
    : ptyManager.snapshot();
  res.json({ sessions });
});

// ─── Internal workspace endpoints (service-to-service) ─────────
// These are only callable by the Next.js server using the shared
// internal service key. They are NOT callable from the browser.

/**
 * POST /internal/workspace/prepare
 * Provision a workspace for a project.
 *
 * Body for GitHub project:
 *   { sourceType: "github", userId, projectId, installationId, owner, repo, branch, githubToken? }
 *
 * Body for blank project:
 *   { sourceType: "blank", userId, projectId, templateId }
 *
 * Returns: { workspaceId, userId, projectId, root, branch, commitSha, ready }
 * Idempotent: if a workspace already exists for the projectId+userId, returns it.
 */
app.post("/internal/workspace/prepare", requireInternalServiceAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    const userId = String(body.userId || "");
    const projectId = String(body.projectId || "");
    const sourceType = String(body.sourceType || "");

    if (!userId || !projectId || !sourceType) {
      res.status(400).json({ error: "Missing required fields: userId, projectId, sourceType" });
      return;
    }

    // Check for existing workspace (idempotent)
    const existingWs = listWorkspaces(userId).find((w: WorkspaceDescriptor) => w.projectId === projectId);
    if (existingWs && existingWs.ready) {
      const { workspaceId, root, branch, commitSha } = existingWs;
      res.json({ workspaceId, userId, projectId, root, branch, commitSha, ready: true });
      return;
    }

    let descriptor: WorkspaceDescriptor;

    if (sourceType === "blank") {
      const templateId = String(body.templateId || "blank-static");
      descriptor = await prepareBlankWorkspace({
        userId,
        projectId,
        workspaceRoot: WORKSPACE_ROOT,
        templateId,
      });
    } else if (sourceType === "github") {
      const installationId = Number(body.installationId);
      const owner = String(body.owner || "");
      const repo = String(body.repo || "");
      const branch = String(body.branch || "main");
      const githubToken = body.githubToken ? String(body.githubToken) : null;

      if (!installationId || !owner || !repo) {
        res.status(400).json({ error: "Missing GitHub fields: installationId, owner, repo" });
        return;
      }

      descriptor = await prepareWorkspace({
        userId,
        projectId,
        installationId,
        owner,
        repo,
        branch,
        commitSha: body.commitSha ? String(body.commitSha) : null,
        workspaceRoot: WORKSPACE_ROOT,
        githubToken,
      });
    } else {
      res.status(400).json({ error: `sourceType must be "github" or "blank"` });
      return;
    }

    res.json({
      workspaceId: descriptor.workspaceId,
      userId: descriptor.userId,
      projectId: descriptor.projectId,
      root: descriptor.root,
      branch: descriptor.branch,
      commitSha: descriptor.commitSha,
      ready: descriptor.ready,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Workspace preparation failed";
    console.error("[Internal] Workspace prepare error:", message);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /internal/workspace/:workspaceId
 * Get workspace state. Verifies userId ownership.
 */
app.get("/internal/workspace/:workspaceId", requireInternalServiceAuth, (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const userId = String(req.query.userId || "");

  if (!userId) {
    res.status(400).json({ error: "Missing userId query parameter" });
    return;
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json({
    workspaceId: ws.workspaceId,
    userId: ws.userId,
    projectId: ws.projectId,
    root: ws.root,
    branch: ws.branch,
    commitSha: ws.commitSha,
    ready: ws.ready,
  });
});

/**
 * POST /internal/workspace/:workspaceId/exec
 * Execute a command in the workspace. Service-to-service only.
 * Returns stdout, stderr, exit code, and duration.
 */
app.post("/internal/workspace/:workspaceId/exec", requireInternalServiceAuth, async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const userId = String(req.body?.userId || "");
  const command = String(req.body?.command || "");
  const stdinInput = typeof req.body?.stdin === "string" ? req.body.stdin : undefined;

  if (!userId || !command) {
    res.status(400).json({ error: "Missing userId or command" });
    return;
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!ws.ready) {
    res.status(409).json({ error: "Workspace not ready" });
    return;
  }

  // Block dangerous commands
  if (isBlockedCommand(command)) {
    auditCommand(userId, workspaceId, command, true);
    res.status(403).json({ error: "Blocked unsafe command" });
    return;
  }

  auditCommand(userId, workspaceId, command, false);

  // ─── Route through the canonical ExecutionGateway ───────────────
  // This endpoint previously called child_process.execFile directly
  // with `bash -c <command>` — bypassing the ExecutionGateway, risk
  // classification, mode/policy enforcement, and RuntimeStore lifecycle.
  //
  // Now it routes through getExecutionGateway() → project.run, which
  // enforces the canonical authority. The command is parsed into
  // structured argv (command + args) to avoid shell-string interpolation.
  const startTime = Date.now();
  const parts = command.trim().split(/\s+/);
  const cmd = parts[0] ?? "";
  const cmdArgs = parts.slice(1);

  try {
    const gateway = getExecutionGateway(ws.root, "act");
    const gwResult = await gateway.execute({
      toolId: "project.run",
      inputs: { command: cmd, args: cmdArgs, stdin: stdinInput },
      cwd: ws.root,
      mode: "act",
      identity: {
        tenantId: "terminal-server",
        userId,
        actorId: userId,
        trusted: true, // service-to-service, authenticated at boundary
        interaction: "headless",
      },
      timeoutMs: 120_000,
    });

    const result = gwResult.result;
    const exitCode = (result.data.exitCode as number | null) ?? (result.success ? 0 : 1);
    const durationMs = Date.now() - startTime;

    res.json({
      exitCode,
      stdout: (result.data.stdout as string) ?? "",
      stderr: (result.data.stderr as string) ?? "",
      durationMs,
      // Gateway enforcement metadata
      runId: gwResult.runId,
      policyEffect: gwResult.policyEffect,
      approved: gwResult.approved,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      error: "Execution failed",
      message,
      durationMs,
    });
  }
});

// ─── Internal Preview Endpoints ────────────────────────────────────
// These endpoints manage preview runtimes (dev servers) on the terminal
// server. The browser never calls these directly — Next.js calls them
// using TERMINAL_INTERNAL_SERVICE_KEY.

/**
 * POST /internal/workspace/:workspaceId/preview/start
 * Start a preview dev server for the workspace.
 */
app.post("/internal/workspace/:workspaceId/preview/start", requireInternalServiceAuth, async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const userId = String(req.body?.userId || "");
  const framework = req.body?.framework ? String(req.body.framework) : undefined;
  const command = req.body?.command ? String(req.body.command) : undefined;
  const packageManager = req.body?.packageManager ? String(req.body.packageManager) : undefined;

  if (!userId) {
    res.status(400).json({ error: "Missing userId" });
    return;
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (!ws.ready) {
    res.status(409).json({ error: "Workspace not ready" });
    return;
  }

  try {
    const runtime = await startPreview({ workspaceId, userId, framework, command, packageManager });
    res.json({
      workspaceId: runtime.workspaceId,
      status: runtime.status,
      port: runtime.port,
      framework: runtime.framework,
      command: runtime.command,
      startedAt: runtime.startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /internal/workspace/:workspaceId/preview/status
 * Get the current preview runtime status, with a live health check.
 */
app.get("/internal/workspace/:workspaceId/preview/status", requireInternalServiceAuth, async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const userId = String(req.query.userId || "");

  if (!userId) {
    res.status(400).json({ error: "Missing userId query parameter" });
    return;
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // If runtime says ready, verify with a live health probe
  const status = getPreviewStatus(workspaceId);
  if (status.status === "ready") {
    const healthy = await verifyPreviewHealth(workspaceId);
    if (!healthy) {
      // Process died — return the updated status
      const updated = getPreviewStatus(workspaceId);
      res.json(updated);
      return;
    }
  }

  res.json(status);
});

/**
 * POST /internal/workspace/:workspaceId/preview/stop
 * Stop the preview dev server.
 */
app.post("/internal/workspace/:workspaceId/preview/stop", requireInternalServiceAuth, (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const userId = String(req.body?.userId || "");

  if (!userId) {
    res.status(400).json({ error: "Missing userId" });
    return;
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  stopPreview(workspaceId);
  res.json({ workspaceId, status: "stopped" });
});

/**
 * POST /internal/workspace/:workspaceId/preview/restart
 * Restart the preview dev server.
 */
app.post("/internal/workspace/:workspaceId/preview/restart", requireInternalServiceAuth, async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const userId = String(req.body?.userId || "");

  if (!userId) {
    res.status(400).json({ error: "Missing userId" });
    return;
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  try {
    const runtime = await restartPreview(workspaceId);
    res.json({
      workspaceId: runtime.workspaceId,
      status: runtime.status,
      port: runtime.port,
      framework: runtime.framework,
      command: runtime.command,
      startedAt: runtime.startedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/**
 * GET /internal/workspace/:workspaceId/preview/logs
 * Get recent preview stdout/stderr logs.
 */
app.get("/internal/workspace/:workspaceId/preview/logs", requireInternalServiceAuth, (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;
  const userId = String(req.query.userId || "");
  const lines = Math.min(Number(req.query.lines) || 100, 500);

  if (!userId) {
    res.status(400).json({ error: "Missing userId query parameter" });
    return;
  }

  const ws = getWorkspace(workspaceId);
  if (!ws) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  if (ws.userId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const logs = getPreviewLogs(workspaceId, lines);
  res.json({ workspaceId, logs });
});

/**
 * GET /preview/:workspaceId/*
 * Public preview proxy — proxies HTTP requests to the workspace's
 * dev server running on localhost:<port>. This is how the browser
 * accesses the running application.
 *
 * Access is protected by a preview token query parameter.
 */
app.use("/preview/:workspaceId", async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId = req.params.workspaceId;

  // Verify preview token
  const previewToken = String(req.query.token || req.headers["x-preview-token"] || "");
  const expectedToken = process.env.PREVIEW_ACCESS_TOKEN ?? "";

  if (expectedToken && previewToken !== expectedToken) {
    res.status(401).json({ error: "Invalid preview token" });
    return;
  }

  const status = getPreviewStatus(workspaceId);
  if (status.status !== "ready" || !status.port) {
    res.status(503).json({
      error: "Preview not ready",
      status: status.status,
    });
    return;
  }

  // Proxy the request to localhost:<port>
  const targetUrl = `http://127.0.0.1:${status.port}${req.url.replace(/^\/preview\/[^/]+/, "")}`;
  try {
    const proxyResp = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers as Record<string, string>,
        host: `127.0.0.1:${status.port}`,
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : (req as any),
      redirect: "manual",
    });

    // Forward status, headers, and body
    res.status(proxyResp.status);
    proxyResp.headers.forEach((value, key) => {
      // Skip transfer-encoding header as express handles it
      if (key.toLowerCase() !== "transfer-encoding") {
        res.setHeader(key, value);
      }
    });

    const body = await proxyResp.arrayBuffer();
    res.send(Buffer.from(body));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(502).json({ error: "Preview proxy error", detail: message });
  }
});

function getUserWorkspace(userId: string) {
  const workspace = resolve(WORKSPACE_ROOT, userId);
  mkdirSync(workspace, { recursive: true });
  return workspace;
}

function safePath(userId: string, filePath: string) {
  if (filePath.length > MAX_PATH_LENGTH) {
    throw new Error("Path too long");
  }
  const workspace = getUserWorkspace(userId);
  const target = resolve(workspace, filePath);
  const pathFromWorkspace = relative(workspace, target);
  if (pathFromWorkspace.startsWith("..") || isAbsolute(pathFromWorkspace)) {
    throw new Error("Invalid path");
  }
  return target;
}

function requireTerminalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    req.terminalUserId = verifyTerminalToken(
      bearerToken(req.headers.authorization),
    ).sub;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

app.use("/files", requireTerminalAuth);

app.get("/files", (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const dirPath = String(req.query.path || ".");
  try {
    const target = safePath(userId, dirPath);
    const entries = readdirSync(target, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "folder" : "file",
    }));
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list files" });
  }
});

app.post("/files/read", (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const filePath = String(req.body.path || "");
  try {
    const target = safePath(userId, filePath);
    const stats = statSync(target);
    if (!stats.isFile()) {
      return res.status(400).json({ error: "Not a file" });
    }
    if (stats.size > MAX_READ_SIZE) {
      return res
        .status(413)
        .json({ error: `File exceeds maximum read size of ${MAX_READ_SIZE} bytes` });
    }
    const content = readFileSync(target, "utf-8");
    res.json({ content });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read file" });
  }
});

app.post("/files/write", (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const filePath = String(req.body.path || "");
  const content = String(req.body.content || "");
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_SIZE) {
    return res
      .status(413)
      .json({ error: `Content exceeds maximum write size of ${MAX_WRITE_SIZE} bytes` });
  }
  try {
    const target = safePath(userId, filePath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf-8");
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to write file" });
  }
});

app.post("/files/delete", (req: AuthenticatedRequest, res) => {
  const userId = req.terminalUserId!;
  const filePath = String(req.body.path || "");
  if (!filePath || filePath === ".") {
    return res.status(400).json({ error: "Refusing to delete workspace root" });
  }
  try {
    const target = safePath(userId, filePath);
    rmSync(target, { recursive: true, force: true });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete file" });
  }
});

// ─── Workspace-scoped file endpoints ───────────────────────────
// These endpoints require BOTH a terminal token (user auth) AND a
// workspaceId. They verify that the workspace belongs to the user
// and operate only within the workspace root.

function resolveWorkspacePath(workspaceId: string, userId: string, filePath: string): string {
  const ws = getWorkspace(workspaceId);
  if (!ws) throw new Error("Workspace not found");
  if (ws.userId !== userId) throw new Error("Forbidden");
  if (!ws.ready) throw new Error("Workspace not ready");

  if (filePath.length > MAX_PATH_LENGTH) {
    throw new Error("Path too long");
  }
  const target = resolve(ws.root, filePath);
  const pathFromRoot = relative(ws.root, target);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new Error("Invalid path — escapes workspace root");
  }
  return target;
}

/** Middleware: extract workspaceId from header and verify it belongs to the user. */
function requireWorkspaceAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const userId = verifyTerminalToken(bearerToken(req.headers.authorization)).sub;
    req.terminalUserId = userId;
    const workspaceId = req.headers["x-workspace-id"] as string | undefined;
    if (!workspaceId) {
      res.status(400).json({ error: "Missing X-Workspace-Id header" });
      return;
    }
    const ws = getWorkspace(workspaceId);
    if (!ws) {
      res.status(404).json({ error: "Workspace not found" });
      return;
    }
    if (ws.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    if (!ws.ready) {
      res.status(409).json({ error: "Workspace not ready" });
      return;
    }
    req.workspaceId = workspaceId;
    req.workspaceRoot = ws.root;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

app.use("/ws-files", requireWorkspaceAuth);

app.get("/ws-files", (req: AuthenticatedRequest, res) => {
  const dirPath = String(req.query.path || ".");
  try {
    const target = resolve(req.workspaceRoot!, dirPath);
    const rel = relative(req.workspaceRoot!, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      return res.status(400).json({ error: "Invalid path" });
    }
    const entries = readdirSync(target, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "folder" : "file",
    }));
    res.json({ entries, workspaceId: req.workspaceId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to list files" });
  }
});

app.post("/ws-files/read", (req: AuthenticatedRequest, res) => {
  const filePath = String(req.body.path || "");
  try {
    const target = resolveWorkspacePath(req.workspaceId!, req.terminalUserId!, filePath);
    const stats = statSync(target);
    if (!stats.isFile()) {
      return res.status(400).json({ error: "Not a file" });
    }
    if (stats.size > MAX_READ_SIZE) {
      return res.status(413).json({ error: `File exceeds max read size (${MAX_READ_SIZE} bytes)` });
    }
    const content = readFileSync(target, "utf-8");
    res.json({ content, workspaceId: req.workspaceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to read file";
    const status = msg === "Forbidden" ? 403 : msg === "Workspace not found" ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post("/ws-files/write", (req: AuthenticatedRequest, res) => {
  const filePath = String(req.body.path || "");
  const content = String(req.body.content || "");
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_SIZE) {
    return res.status(413).json({ error: `Content exceeds max write size (${MAX_WRITE_SIZE} bytes)` });
  }
  if (!filePath || filePath === ".") {
    return res.status(400).json({ error: "Refusing to write to workspace root" });
  }
  try {
    const target = resolveWorkspacePath(req.workspaceId!, req.terminalUserId!, filePath);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, content, "utf-8");
    res.json({ saved: true, workspaceId: req.workspaceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to write file";
    const status = msg === "Forbidden" ? 403 : msg === "Workspace not found" ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post("/ws-files/delete", (req: AuthenticatedRequest, res) => {
  const filePath = String(req.body.path || "");
  if (!filePath || filePath === ".") {
    return res.status(400).json({ error: "Refusing to delete workspace root" });
  }
  try {
    const target = resolveWorkspacePath(req.workspaceId!, req.terminalUserId!, filePath);
    rmSync(target, { recursive: true, force: true });
    res.json({ deleted: true, workspaceId: req.workspaceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete file";
    const status = msg === "Forbidden" ? 403 : msg === "Workspace not found" ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post("/ws-files/mkdir", (req: AuthenticatedRequest, res) => {
  const filePath = String(req.body.path || "");
  if (!filePath || filePath === ".") {
    return res.status(400).json({ error: "Folder path is required" });
  }
  try {
    const target = resolveWorkspacePath(req.workspaceId!, req.terminalUserId!, filePath);
    if (existsSync(target)) return res.status(409).json({ error: "Path already exists" });
    mkdirSync(target, { recursive: false });
    res.json({ created: true, workspaceId: req.workspaceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create folder";
    const status = msg === "Forbidden" ? 403 : msg === "Workspace not found" ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

app.post("/ws-files/rename", (req: AuthenticatedRequest, res) => {
  const filePath = String(req.body.path || "");
  const newPath = String(req.body.newPath || "");
  if (!filePath || !newPath || filePath === "." || newPath === ".") {
    return res.status(400).json({ error: "Both source and destination paths are required" });
  }
  try {
    const source = resolveWorkspacePath(req.workspaceId!, req.terminalUserId!, filePath);
    const target = resolveWorkspacePath(req.workspaceId!, req.terminalUserId!, newPath);
    if (!existsSync(source)) return res.status(404).json({ error: "Source path not found" });
    if (existsSync(target)) return res.status(409).json({ error: "Destination path already exists" });
    renameSync(source, target);
    res.json({ renamed: true, workspaceId: req.workspaceId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to rename path";
    const status = msg === "Forbidden" ? 403 : msg === "Workspace not found" ? 404 : 500;
    res.status(status).json({ error: msg });
  }
});

io.use((socket, next) => {
  try {
    const tokenPayload = verifyTerminalToken(socket.handshake.auth?.token);
    socket.data.userId = tokenPayload.sub;
    socket.data.cwd = tokenPayload.cwd;  // Authenticated Desktop cwd from JWT
    const workspaceId = tokenPayload.wid;
    if (workspaceId) {
      const ws = getWorkspace(String(workspaceId));
      if (!ws) {
        next(new Error("Workspace not found"));
        return;
      }
      if (ws.userId !== socket.data.userId) {
        next(new Error("Forbidden"));
        return;
      }
      if (!ws.ready) {
        next(new Error("Workspace not ready"));
        return;
      }
      socket.data.workspaceId = ws.workspaceId;
      socket.data.workspaceRoot = ws.root;
      socket.data.projectId = ws.projectId;
    }
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = String(socket.data.userId);
  const workspaceId = socket.data.workspaceId as string | undefined;
  const projectId = socket.data.projectId as string | undefined;
  const desktopCwd = socket.data.cwd as string | undefined;

  // If a workspaceId was provided and verified, use the workspace root.
  // Otherwise fall back to the user's root workspace (legacy behavior).
  const workspace = (socket.data.workspaceRoot as string | undefined) ?? resolve(WORKSPACE_ROOT, userId);
  mkdirSync(workspace, { recursive: true });

  console.log("[Terminal] Connected:", { userId, workspaceId: workspaceId ?? "default", projectId: projectId ?? "none" });
  if (desktopCwd) {
    console.log("[Terminal] Authenticated desktop cwd:", desktopCwd);
  }

  // ─── Create PTY session via the canonical manager ───────────────
  // PtySessionManager handles: spawn, metadata, idle/lifetime timers,
  // max concurrent enforcement, workspace boundary validation, and cleanup.
  // The allowedRoot is the server-side resolved workspace root — the
  // manager validates that cwd is within this root before spawning.
  let session: PtySessionSnapshot;
  try {
    session = ptyManager.create({
      userId,
      projectId: projectId ?? null,
      workspaceId: workspaceId ?? null,
      cwd: workspace,
      allowedRoot: workspace,
      useDocker: USE_DOCKER,
      onData: (data: string) => socket.emit("terminal:output", data),
      onExit: ({ sessionId, exitCode, signal }) => {
        console.log("[Terminal] Exit:", { sessionId, exitCode, signal });
        socket.emit("terminal:output", `\r\n\x1b[31m[Session ended ${exitCode ?? signal}]\x1b[0m\r\n`);
      },
      onOutputDropped: ({ sessionId, dropped }) => {
        console.warn("[Terminal] Output dropped:", { sessionId, dropped });
      },
      // ─── Backpressure protection ───────────────────────────────
      // Predicate: is the Socket.IO transport ready to accept output?
      // Checks both disconnection and Engine.IO sendBuffer buildup.
      // When this returns false, PtySessionManager buffers output up
      // to MAX_PENDING_OUTPUT_BYTES, then drops to prevent OOM.
      isTransportWritable: () => {
        if (socket.disconnected) return false;
        // Engine.IO sendBuffer: packets queued waiting for the transport.
        // If it's backing up (slow client), stop feeding it more data.
        const conn = (socket as any).conn;
        if (conn?.sendBuffer && Array.isArray(conn.sendBuffer) && conn.sendBuffer.length > 64) {
          return false;
        }
        return true;
      },
      // Throttled user-visible warning — emitted once when the transport
      // recovers and buffered output is flushed, if any output was dropped.
      onBackpressureWarning: ({ droppedChunks, droppedBytes }) => {
        const kb = Math.max(1, Math.round(droppedBytes / 1024));
        socket.emit(
          "terminal:output",
          `\r\n\x1b[33m\u26A0 Terminal output dropped (${droppedChunks} chunks, ~${kb} KiB) \u2014 connection too slow.\x1b[0m\r\n`,
        );
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start terminal";
    console.error("[Terminal] Start failed:", message);
    socket.emit("terminal:error", message);
    socket.disconnect();
    return;
  }

  const sessionId = session.sessionId;

  socket.emit("session:ready", {
    sessionId,
    cwd: workspace,
    workspaceId: workspaceId ?? null,
    projectId: projectId ?? null,
    shell: session.shell,
  });

  socket.on("terminal:input", (data: string) => {
    if (typeof data !== "string") return;

    const userId = socket.data.userId || "unknown";

    // Rate limiting: max 60 inputs per 10s per socket
    const now = Date.now();
    const window = 10_000;
    if (!(socket as any).__rateBuckets) (socket as any).__rateBuckets = [];
    const buckets = (socket as any).__rateBuckets as number[];
    const recent = buckets.filter((t) => now - t < window);
    recent.push(now);
    (socket as any).__rateBuckets = recent;
    if (recent.length > 60) {
      socket.emit("terminal:output", "\r\n\x1b[33m⚠ Rate limit: too many commands. Slow down.\x1b[0m\r\n");
      return;
    }

    if (isBlockedCommand(data)) {
      auditCommand(userId, sessionId, data, true);
      socket.emit("terminal:output", "\r\n\x1b[31m⛔ Blocked unsafe command.\x1b[0m\r\n");
      return;
    }

    auditCommand(userId, sessionId, data, false);
    if (!ptyManager.input(sessionId, data, userId)) {
      // input rejected — wrong owner, exited, or oversized
      socket.emit("terminal:output", "\r\n\x1b[33m⚠ Input rejected (session ended or too large).\x1b[0m\r\n");
    }
  });

    socket.on("litt-code:command", async (input: string) => {
    if (typeof input !== "string") return;

    // Mobile commands (litt mobile:check, mobile:start, etc.) are dispatched
    // directly to the PTY as real shell commands — no LLM round-trip.
    const mobileCmd = dispatchMobileCommand(input);
    if (mobileCmd) {
      const userId = socket.data.userId || "unknown";
      auditCommand(userId, sessionId, mobileCmd.shellCommand, false);
      socket.emit("terminal:output", `\r\n\x1b[36m📱 ${mobileCmd.label}\x1b[0m\r\n`);
      ptyManager.input(sessionId, mobileCmd.shellCommand + "\r", userId);
      return;
    }

    socket.emit("terminal:output", "\r\n\x1b[36mLiTT is thinking...\x1b[0m\r\n");
    const cmdStart = Date.now();
    const userId = socket.data.userId || "unknown";

    // ─── Canonical operator path ───────────────────────────────────
    // Route through runLiTTOperator → runAgentLoop → ExecutionGateway.
    // This gives the NL path: tools, gateway enforcement, canonical
    // runId, RuntimeStore lifecycle events, and cross-surface identity.
    //
    // Falls back to the legacy askLiTTCode path ONLY if the model
    // provider is unreachable (no Ollama + no OPENROUTER_API_KEY).
    const canUseOperator = await operatorAvailable().catch(() => false);

    if (canUseOperator) {
      try {
        const result = await runLiTTOperator({
          prompt: input,
          cwd: workspace,
          userId,
          mode: "act",
          onModelStream: (event) => {
            if (event.type === "delta") {
              socket.emit("terminal:output", event.text.replace(/\n/g, "\r\n"));
            }
          },
        });

        socket.emit("terminal:output", "\r\n\x1b[36mLiTT:\x1b[0m\r\n");
        socket.emit("terminal:output", result.content.replace(/\n/g, "\r\n") + "\r\n");
        socket.emit("terminal:output", `\r\n\x1b[2mrunId: ${result.runId} (${result.termination}, ${result.rounds} rounds)\x1b[0m\r\n`);
      } catch (err) {
        const message = err instanceof Error ? err.message : "LiTT operator failed";
        socket.emit("terminal:output", `\r\n\x1b[31m⚠ ${message}\x1b[0m\r\n`);
      }
      return;
    }

    // ─── Legacy fallback (no model provider available) ─────────────
    runtimeSetPhase("thinking");
    try {
      const reply = await handleLiTTCodeCommand(input);
      runtimeCommandEnd("litt-code:command", true, 0, Date.now() - cmdStart, "LiTT replied (legacy)");
      socket.emit("terminal:output", "\r\n\x1b[36mLiTT:\x1b[0m\r\n");
      socket.emit("terminal:output", reply.replace(/\n/g, "\r\n") + "\r\n");
    } catch (err) {
      const message = err instanceof Error ? err.message : "LiTT failed";
      runtimeCommandEnd("litt-code:command", false, 1, Date.now() - cmdStart, message);
      socket.emit("terminal:output", `\r\n\x1b[31m⚠ ${message}\x1b[0m\r\n`);
    }
  });

  socket.on("terminal:resize", ({ cols, rows }: { cols: number; rows: number }) => {
    if (typeof cols === "number" && typeof rows === "number") {
      ptyManager.resize(sessionId, cols, rows, userId);
    }
  });

  // ── Natural-language chat ────────────────────────────────────────
  // Thin bridge: authenticated socket → streamLiTTCode → litt:event streaming back
  socket.on("litt:chat", async (req: { turnId: string; message: string }) => {
    if (!req?.turnId || typeof req?.message !== "string" || !req.message.trim()) {
      socket.emit("litt:event", { type: "error", turnId: req?.turnId ?? "unknown", message: "Invalid request: require turnId and non-empty message" });
      return;
    }

    const turnId = req.turnId;
    const message = req.message;

    console.log("[LiTT Chat] turn cwd:", desktopCwd || "none");

    // Call the canonical natural-language entrypoint
    try {
      if (!desktopCwd) {
        socket.emit("litt:event", {
          type: "error",
          turnId,
          message: "Authenticated Desktop project cwd is unavailable.",
        });
        return;
      }

      await streamLiTTOperator(
        message,
        desktopCwd,
        (event: LiTTEvent) => {
          // Re-emit only to the originating authenticated Desktop turn.
          socket.emit("litt:event", { ...event, turnId });
        },
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "LiTT chat failed";
      socket.emit("litt:event", { type: "error", turnId, message: errorMsg });
    }
  });

  socket.on("disconnect", () => {
    console.log("[Terminal] Disconnected:", sessionId);
    // Kill the session — the socket owns it, so we pass the authenticated userId.
    // This is safe because userId came from the JWT, not the client.
    ptyManager.kill(sessionId, "client_disconnect", userId);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 LiTTree Terminal Server running on http://0.0.0.0:${PORT}`);
  console.log(`   Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`);
  console.log(`   Workspace root: ${WORKSPACE_ROOT}`);
  console.log(`   Docker mode: ${USE_DOCKER}`);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[terminal-server] Received ${signal}, shutting down...`);
  ptyManager.shutdown();
  io.close(() => {
    server.close(() => {
      console.log("[terminal-server] All connections closed.");
      process.exit(0);
    });
  });
  // Force exit after 10s if connections don't close
  setTimeout(() => {
    console.error("[terminal-server] Forcing exit after timeout.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
