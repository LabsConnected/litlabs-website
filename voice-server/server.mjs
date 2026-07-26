import { createServer } from "http";
import { createHmac } from "crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.VOICE_PROXY_PORT || 4002;
const PATH = "/voice";
const INWORLD_ENDPOINT =
  "wss://api.inworld.ai/api/v1/realtime/session";
const INWORLD_API_KEY = process.env.INWORLD_API_KEY;
const VOICE_AUTH_SECRET = process.env.VOICE_AUTH_SECRET;
const MAX_CONCURRENT_SESSIONS_PER_USER = Number(
  process.env.MAX_CONCURRENT_SESSIONS_PER_USER || 3,
);
const MAX_TOTAL_SESSIONS = Number(process.env.MAX_TOTAL_SESSIONS || 50);

if (!INWORLD_API_KEY) {
  console.error("[voice-proxy] INWORLD_API_KEY is not set. Exiting.");
  process.exit(1);
}

if (!VOICE_AUTH_SECRET || VOICE_AUTH_SECRET.length < 32) {
  console.error("[voice-proxy] VOICE_AUTH_SECRET must be set (>= 32 chars). Exiting.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Per-user and global connection accounting (in-memory, single-replica)
// Uses string session IDs instead of WebSocket refs for reliable Set ops.
// ---------------------------------------------------------------------------
let sessionCounter = 0;
const activeSessionsByUser = new Map(); // userId -> Set<sessionId>
const totalActiveSessions = new Set(); // all active sessionIds

function registerSession(userId) {
  const sessionId = `s${++sessionCounter}`;
  const userSessions = activeSessionsByUser.get(userId) ?? new Set();
  userSessions.add(sessionId);
  activeSessionsByUser.set(userId, userSessions);
  totalActiveSessions.add(sessionId);
  return { sessionId, userSessionCount: userSessions.size };
}

function cleanupSession(userId, sessionId) {
  const userSessions = activeSessionsByUser.get(userId);
  if (userSessions) {
    userSessions.delete(sessionId);
    if (userSessions.size === 0) {
      activeSessionsByUser.delete(userId);
    }
  }
  totalActiveSessions.delete(sessionId);
}

function verifyToken(token) {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;

  const expectedSig = createHmac("sha256", VOICE_AUTH_SECRET)
    .update(encoded)
    .digest("base64url");

  if (sig !== expectedSig) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return null;
    return payload;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  // Railway healthcheck — lightweight, no auth
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        service: "voice-proxy",
        activeSessions: totalActiveSessions.size,
        activeUsers: activeSessionsByUser.size,
      }),
    );
    return;
  }

  // Test endpoint — verifies Inworld API key by opening a WebSocket
  if (req.url === "/test-inworld") {
    try {
      const testSessionId = `test-${Date.now()}`;
      const testUrl = `${INWORLD_ENDPOINT}?key=${testSessionId}&protocol=realtime`;
      const testWs = new WebSocket(testUrl, {
        headers: { Authorization: `Basic ${INWORLD_API_KEY}` },
      });

      let result = null;
      const timeout = setTimeout(() => {
        if (!result) {
          result = { status: "timeout", message: "Inworld did not respond in 5s" };
          try { testWs.close(); } catch {}
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
      }, 5000);

      testWs.on("open", () => {
        // Connection opened — wait for session.created
      });

      testWs.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "session.created" && !result) {
            result = { status: "ok", message: "Inworld connection successful", sessionId: msg.session?.id };
            clearTimeout(timeout);
            testWs.close(1000, "Test complete");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          }
        } catch {}
      });

      testWs.on("error", (err) => {
        if (!result) {
          result = { status: "error", message: err.message };
          clearTimeout(timeout);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
      });

      testWs.on("close", (code) => {
        if (!result) {
          result = { status: "closed", message: `Inworld closed with code ${code}` };
          clearTimeout(timeout);
          res.writeHead(502, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result));
        }
      });
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "error", message: err.message }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

const wss = new WebSocketServer({ server, path: PATH });

wss.on("connection", (browserWs, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    console.warn("[voice-proxy] Connection rejected: missing token");
    browserWs.close(4001, "Authentication required");
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    console.warn("[voice-proxy] Connection rejected: invalid or expired token");
    browserWs.close(4001, "Invalid or expired token");
    return;
  }

  const userId = payload.sub || "unknown";

  // --- Rate limiting: per-user concurrent sessions ---
  const existingUserSessions = activeSessionsByUser.get(userId);
  if (existingUserSessions && existingUserSessions.size >= MAX_CONCURRENT_SESSIONS_PER_USER) {
    console.warn(
      `[voice-proxy] User ${userId} exceeded concurrent session limit (${MAX_CONCURRENT_SESSIONS_PER_USER})`,
    );
    browserWs.close(4003, "Too many concurrent voice sessions");
    return;
  }

  // --- Rate limiting: global concurrent sessions ---
  if (totalActiveSessions.size >= MAX_TOTAL_SESSIONS) {
    console.warn(
      `[voice-proxy] Global session limit reached (${MAX_TOTAL_SESSIONS})`,
    );
    browserWs.close(1013, "Voice service at capacity");
    return;
  }

  // Register this session for accounting IMMEDIATELY (before async Inworld dial)
  // so concurrent connections from the same user are counted correctly.
  const { sessionId: acctSessionId, userSessionCount } = registerSession(userId);
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cleanupSession(userId, acctSessionId);
  };

  console.info(`[voice-proxy] Authenticated user: ${userId} (sessions: ${userSessionCount}) at ${new Date().toISOString()}`);

  const inworldSessionId = `voice-${Date.now()}`;
  const inworldUrl = `${INWORLD_ENDPOINT}?key=${inworldSessionId}&protocol=realtime`;

  let inworldWs;
  try {
    console.info(`[voice-proxy] Connecting to Inworld (user: ${userId})...`);
    inworldWs = new WebSocket(inworldUrl, {
      headers: {
        Authorization: `Basic ${INWORLD_API_KEY}`,
      },
    });
  } catch (err) {
    console.error("[voice-proxy] Failed to connect to Inworld:", err.message);
    cleanup();
    browserWs.close(1011, "Voice service unavailable");
    return;
  }

  // Inworld -> Browser
  inworldWs.on("open", () => {
    console.info(`[voice-proxy] Inworld connected (user: ${userId})`);
  });

  inworldWs.on("message", (data, isBinary) => {
    // Log first message for debugging
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "session.created" || msg.type === "error") {
        console.info(`[voice-proxy] Inworld msg: ${msg.type} (user: ${userId})`, msg.type === "error" ? msg.message || msg.code : "");
      }
    } catch {}
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data, { binary: isBinary });
    }
  });

  inworldWs.on("close", (code, reason) => {
    console.info(`[voice-proxy] Inworld closed: ${code} ${reason.toString()} (user: ${userId})`);
    cleanup();
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.close(code, reason);
    }
  });

  inworldWs.on("error", (err) => {
    console.error("[voice-proxy] Inworld error:", err.message, `(user: ${userId})`);
    cleanup();
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.close(1011, "Voice service error");
    }
  });

  // Browser -> Inworld
  browserWs.on("message", (data, isBinary) => {
    if (inworldWs.readyState === WebSocket.OPEN) {
      inworldWs.send(data, { binary: isBinary });
    }
  });

  browserWs.on("close", () => {
    console.info(`[voice-proxy] Browser closed connection (user: ${userId}) at ${new Date().toISOString()}`);
    cleanup();
    if (inworldWs.readyState === WebSocket.OPEN) {
      inworldWs.close(1000, "Client disconnect");
    }
  });

  browserWs.on("error", (err) => {
    console.error("[voice-proxy] Browser error:", err.message, `(user: ${userId})`);
    cleanup();
    if (inworldWs.readyState === WebSocket.OPEN) {
      inworldWs.close(1000, "Client error");
    }
  });
});

server.listen(PORT, () => {
  console.log(`[voice-proxy] Listening on ws://localhost:${PORT}${PATH}`);
  console.log(`[voice-proxy] Proxying to ${INWORLD_ENDPOINT}`);
});
