import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

const PORT = process.env.VOICE_PROXY_PORT || 4002;
const PATH = "/voice";
const INWORLD_ENDPOINT =
  "wss://api.inworld.ai/api/v1/realtime/session";
const INWORLD_API_KEY = process.env.INWORLD_API_KEY;

if (!INWORLD_API_KEY) {
  console.error("[voice-proxy] INWORLD_API_KEY is not set. Exiting.");
  process.exit(1);
}

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", service: "voice-proxy" }));
});

const wss = new WebSocketServer({ server, path: PATH });

wss.on("connection", (browserWs, req) => {
  const sessionId = `voice-${Date.now()}`;
  const inworldUrl = `${INWORLD_ENDPOINT}?key=${sessionId}&protocol=realtime`;

  console.debug(`[voice-proxy] New connection from ${req.socket.remoteAddress}`);

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
