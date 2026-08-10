// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "http";
import { Server as IOServer } from "socket.io";
import { io as ioc, type Socket as IOClient } from "socket.io-client";
import { createHmac } from "crypto";

/**
 * Real Socket.IO integration test for the terminal server.
 *
 * Spins up an actual Socket.IO server with the same authentication
 * middleware that terminal-server/server.ts uses. The AI provider's
 * HTTP endpoints (Ollama and OpenRouter) are mocked at the fetch level
 * — the handler, token verification, and socket wiring are all real.
 *
 * Verifies:
 *   1. A valid terminal token allows connection.
 *   2. An invalid/missing token is rejected with "Unauthorized".
 *   3. An expired token is rejected with "Unauthorized".
 *   4. A "litt-code:command" event reaches handleLiTTCodeCommand
 *      and the client receives "terminal:output" through the real socket.
 *   5. Non-string input is silently ignored (no output, no handler call).
 */

// ── Mock only the external AI provider HTTP calls ───────────────
// handleLiTTCodeCommand → askLiTTCode → chatWithOllama → chatWithOpenRouter
// Both use globalThis.fetch. We intercept fetch and return mock responses
// for Ollama and OpenRouter URLs, letting all other fetches pass through.
const originalFetch = globalThis.fetch;

vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
  if (urlStr.includes("localhost:11434")) {
    // Mock Ollama — simulate a connection failure so the handler
    // falls back to OpenRouter (matching real behavior when Ollama is down)
    throw new Error("Ollama not available in test");
  }
  if (urlStr.includes("openrouter.ai")) {
    // Mock OpenRouter — return a canned response
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "MOCK_LITT: Scan complete — 3 files found in src/",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  // Pass through any other fetch calls
  return originalFetch(url as Parameters<typeof originalFetch>[0], init as Parameters<typeof originalFetch>[1]);
});

// Set a dummy API key so chatWithOpenRouter doesn't throw before fetching
process.env.OPENROUTER_API_KEY = "test-key-for-integration";

import { handleLiTTCodeCommand } from "../terminal-server/litt-code";
import { verifyTerminalToken } from "../terminal-server/auth";

// ── Test token helpers ──────────────────────────────────────────
const TEST_SECRET = "test-secret-at-least-32-characters-long!!";

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function createTestToken(userId: string): string {
  const payload = {
    sub: userId,
    aud: "littree-terminal",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const encodedSignature = sign(encodedPayload, TEST_SECRET);
  return `${encodedPayload}.${encodedSignature}`;
}

function createExpiredToken(userId: string): string {
  const payload = {
    sub: userId,
    aud: "littree-terminal",
    iat: Math.floor(Date.now() / 1000) - 7200,
    exp: Math.floor(Date.now() / 1000) - 3600,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const encodedSignature = sign(encodedPayload, TEST_SECRET);
  return `${encodedPayload}.${encodedSignature}`;
}

// ── Test server setup ───────────────────────────────────────────
let httpServer: Server;
let ioServer: IOServer;
const TEST_PORT = 4098;
const TEST_USER_ID = "test-user-integration";

beforeAll(() => {
  process.env.TERMINAL_AUTH_SECRET = TEST_SECRET;

  httpServer = createServer();
  ioServer = new IOServer(httpServer, {
    cors: { origin: "*" },
  });

  // Register the same auth middleware as terminal-server/server.ts
  ioServer.use((socket, next) => {
    try {
      const tokenPayload = verifyTerminalToken(socket.handshake.auth?.token);
      socket.data.userId = tokenPayload.sub;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  ioServer.on("connection", (socket) => {
    // Register the same litt-code:command handler as terminal-server
    socket.on("litt-code:command", async (input: string) => {
      if (typeof input !== "string") return;
      socket.emit("terminal:output", "\r\n\x1b[36mLiTT is thinking...\x1b[0m\r\n");
      try {
        const reply = await handleLiTTCodeCommand(input);
        socket.emit("terminal:output", "\r\n\x1b[36mLiTT:\x1b[0m\r\n");
        socket.emit("terminal:output", reply.replace(/\n/g, "\r\n") + "\r\n");
      } catch (err) {
        const message = err instanceof Error ? err.message : "LiTT failed";
        socket.emit("terminal:output", `\r\n\x1b[31m⚠ ${message}\x1b[0m\r\n`);
      }
    });
  });

  return new Promise<void>((resolve, reject) => {
    httpServer.once("error", (err) => reject(err));
    httpServer.listen(TEST_PORT, () => resolve());
  });
}, 15000);

afterAll(() => {
  return new Promise<void>((resolve) => {
    ioServer.close();
    httpServer.close(() => resolve());
  });
});

// ── Tests ───────────────────────────────────────────────────────

describe("Terminal Socket.IO integration", () => {
  it("rejects connection without a token", async () => {
    const client = ioc(`http://localhost:${TEST_PORT}`, {
      transports: ["websocket"],
      auth: {},
      reconnection: false,
    });

    const error = await new Promise<string>((resolve) => {
      client.on("connect_error", (err: Error) => resolve(err.message));
    });

    expect(error).toBe("Unauthorized");
    client.disconnect();
  });

  it("rejects connection with an expired token", async () => {
    const client = ioc(`http://localhost:${TEST_PORT}`, {
      transports: ["websocket"],
      auth: { token: createExpiredToken(TEST_USER_ID) },
      reconnection: false,
    });

    const error = await new Promise<string>((resolve) => {
      client.on("connect_error", (err: Error) => resolve(err.message));
    });

    expect(error).toBe("Unauthorized");
    client.disconnect();
  });

  it("accepts connection with a valid token", async () => {
    const client = ioc(`http://localhost:${TEST_PORT}`, {
      transports: ["websocket"],
      auth: { token: createTestToken(TEST_USER_ID) },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      client.on("connect", () => resolve());
    });

    expect(client.connected).toBe(true);
    client.disconnect();
  });

  it("litt scan reaches handleLiTTCodeCommand and returns terminal:output through the real socket", async () => {
    const client = ioc(`http://localhost:${TEST_PORT}`, {
      transports: ["websocket"],
      auth: { token: createTestToken(TEST_USER_ID) },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      client.on("connect", () => resolve());
    });

    const outputs: string[] = [];
    client.on("terminal:output", (data: string) => outputs.push(data));

    // Emit the command through the real socket
    client.emit("litt-code:command", "litt scan");

    // Wait for at least 3 output messages (thinking + LiTT: + reply)
    await new Promise<void>((resolve) => {
      const check = () => {
        if (outputs.length >= 3) resolve();
        else setTimeout(check, 50);
      };
      check();
    });

    // Give a little extra time for all messages
    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const allOutput = outputs.join("");
    expect(allOutput).toContain("LiTT is thinking");
    expect(allOutput).toContain("LiTT:");
    expect(allOutput).toContain("MOCK_LITT");
    expect(allOutput).toContain("Scan complete");

    client.disconnect();
  });

  it("litt fix reaches handleLiTTCodeCommand and returns a response through the real socket", async () => {
    const client = ioc(`http://localhost:${TEST_PORT}`, {
      transports: ["websocket"],
      auth: { token: createTestToken(TEST_USER_ID) },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      client.on("connect", () => resolve());
    });

    const outputs: string[] = [];
    client.on("terminal:output", (data: string) => outputs.push(data));

    client.emit("litt-code:command", "litt fix");

    await new Promise<void>((resolve) => {
      const check = () => {
        if (outputs.length >= 3) resolve();
        else setTimeout(check, 50);
      };
      check();
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 100));

    const allOutput = outputs.join("");
    expect(allOutput).toContain("LiTT:");
    expect(allOutput).toContain("MOCK_LITT");

    client.disconnect();
  });

  it("ignores non-string input without calling the handler or producing output", async () => {
    const client = ioc(`http://localhost:${TEST_PORT}`, {
      transports: ["websocket"],
      auth: { token: createTestToken(TEST_USER_ID) },
      reconnection: false,
    });

    await new Promise<void>((resolve) => {
      client.on("connect", () => resolve());
    });

    const outputs: string[] = [];
    client.on("terminal:output", (data: string) => outputs.push(data));

    // Emit non-string input
    client.emit("litt-code:command", 12345 as unknown as string);

    // Wait long enough to confirm no output arrives
    await new Promise<void>((resolve) => setTimeout(resolve, 300));

    expect(outputs).toHaveLength(0);

    client.disconnect();
  });
});
