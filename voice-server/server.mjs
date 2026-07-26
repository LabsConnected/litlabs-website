import { createServer } from "http";
import { createHmac } from "crypto";
import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.VOICE_PROXY_PORT || 4002;
const PATH = "/voice";
const INWORLD_ENDPOINT =
  "wss://api.inworld.ai/api/v1/realtime/session";
const INWORLD_API_KEY = process.env.INWORLD_API_KEY;
const VOICE_AUTH_SECRET = process.env.VOICE_AUTH_SECRET;

if (!INWORLD_API_KEY) {
  console.error("[voice-proxy] INWORLD_API_KEY is not set. Exiting.");
  process.exit(1);
}

if (!VOICE_AUTH_SECRET || VOICE_AUTH_SECRET.length < 32) {
  console.error("[voice-proxy] VOICE_AUTH_SECRET must be set (>= 32 chars). Exiting.");
  process.exit(1);
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

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "voice-proxy" }));
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

  console.debug(`[voice-proxy] Authenticated user: ${payload.sub}`);

  const sessionId = `voice-${Date.now()}`;
  const inworldUrl = `${INWORLD_ENDPOINT}?key=${sessionId}&protocol=realtime`;

  let inworldWs;
  try {
    inworldWs = new WebSocket(inworldUrl, {
      headers: {
        Authorization: `Basic ${INWORLD_API_KEY}`,
      },
    });
  } catch (err) {
    console.error("[voice-proxy] Failed to connect to Inworld:", err.message);
    browserWs.close(1011, "Voice service unavailable");
    return;
  }

  // Inworld -> Browser
  inworldWs.on("message", (data, isBinary) => {
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.send(data, { binary: isBinary });
    }
  });

  inworldWs.on("close", (code, reason) => {
    console.debug(`[voice-proxy] Inworld closed: ${code}`);
    if (browserWs.readyState === WebSocket.OPEN) {
      browserWs.close(code, reason);
    }
  });

  inworldWs.on("error", (err) => {
    console.error("[voice-proxy] Inworld error:", err.message);
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
    console.debug("[voice-proxy] Browser closed connection");
    if (inworldWs.readyState === WebSocket.OPEN) {
      inworldWs.close(1000, "Client disconnect");
    }
  });

  browserWs.on("error", (err) => {
    console.error("[voice-proxy] Browser error:", err.message);
    if (inworldWs.readyState === WebSocket.OPEN) {
      inworldWs.close(1000, "Client error");
    }
  });
});

server.listen(PORT, () => {
  console.log(`[voice-proxy] Listening on ws://localhost:${PORT}${PATH}`);
  console.log(`[voice-proxy] Proxying to ${INWORLD_ENDPOINT}`);
});
