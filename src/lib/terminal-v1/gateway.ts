/**
 * Terminal V1 Gateway — Socket.IO server.
 *
 * This gateway is the real-time transport layer between the browser
 * and the sandbox. It:
 *
 * 1. Verifies V1 tokens (with sandbox binding, scopes, and ownership)
 * 2. Connects to the sandbox provider's terminal stream
 * 3. Relays terminal I/O (input, output, resize)
 * 4. Enforces per-user ownership
 *
 * The gateway NEVER spawns shells directly. It always goes through
 * the sandbox provider abstraction.
 */

import { Server as IOServer, type Socket } from "socket.io";
import type { Server as HTTPServer } from "http";
import { verifyTerminalTokenV1, TerminalTokenError, tokenErrorToStatus } from "./token";
import { getSandboxProvider } from "./providers";
import { isTerminalEnabled } from "./control-plane";
import type { TerminalTransport, ShellType } from "./types";

// ─── Connection auth ─────────────────────────────────────────────

interface TerminalHandshake {
  token: string;
  sandboxId: string;
  shell?: ShellType;
  cols?: number;
  rows?: number;
}

interface AuthenticatedSocketData {
  userId: string;
  projectId: string;
  workspaceId: string;
  sandboxId: string;
  transport: TerminalTransport | null;
}

// ─── Gateway setup ───────────────────────────────────────────────

export function createTerminalGateway(httpServer: HTTPServer): IOServer {
  const io = new IOServer(httpServer, {
    path: "/terminal-v1",
    cors: {
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
      methods: ["GET", "POST"],
      credentials: true,
    },
  });

  // Auth middleware
  io.use((socket: Socket, next: (err?: Error) => void) => {
    if (!isTerminalEnabled()) {
      next(new Error("FEATURE_DISABLED"));
      return;
    }

    const handshake = socket.handshake.auth as Partial<TerminalHandshake>;
    if (!handshake.token || !handshake.sandboxId) {
      next(new Error("Missing token or sandboxId"));
      return;
    }

    try {
      const claims = verifyTerminalTokenV1(handshake.token, {
        sandboxId: handshake.sandboxId,
        scope: "terminal:connect",
      });

      const data: AuthenticatedSocketData = {
        userId: claims.sub,
        projectId: claims.pid,
        workspaceId: claims.wid,
        sandboxId: claims.sid,
        transport: null,
      };

      socket.data = data;
      next();
    } catch (err) {
      if (err instanceof TerminalTokenError) {
        next(new Error(err.code));
      } else {
        next(new Error("Unauthorized"));
      }
    }
  });

  // Connection handler
  io.on("connection", (socket: Socket) => {
    const data = socket.data as AuthenticatedSocketData;
    const { sandboxId } = data;

    const shell: ShellType = (socket.handshake.auth?.shell as ShellType) ?? "bash";
    const cols = (socket.handshake.auth?.cols as number) ?? 120;
    const rows = (socket.handshake.auth?.rows as number) ?? 32;

    // Connect to sandbox terminal
    const provider = getSandboxProvider();

    provider
      .connectTerminal(sandboxId, { shell, cols, rows })
      .then((transport) => {
        data.transport = transport;

        // Relay output to client
        transport.onOutput((output: string) => {
          socket.emit("terminal:output", output);
        });

        transport.onExit((info: { exitCode: number; signal?: number }) => {
          socket.emit("terminal:exit", info);
          socket.disconnect(true);
        });

        // Send ready event
        socket.emit("terminal:ready", {
          sessionId: transport.sessionId,
          sandboxId,
          shell,
          cols,
          rows,
        });
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Failed to connect to sandbox";
        socket.emit("terminal:error", message);
        socket.disconnect(true);
      });

    // ─── Client events ───────────────────────────────────────────

    socket.on("terminal:input", (data: string) => {
      if (typeof data !== "string") return;
      const socketData = socket.data as AuthenticatedSocketData;
      socketData.transport?.write(data);
    });

    socket.on("terminal:resize", ({ cols, rows }: { cols: number; rows: number }) => {
      if (typeof cols !== "number" || typeof rows !== "number") return;
      const socketData = socket.data as AuthenticatedSocketData;
      socketData.transport?.resize(cols, rows);
    });

    socket.on("disconnect", () => {
      const socketData = socket.data as AuthenticatedSocketData;
      socketData.transport?.kill();
      socketData.transport = null;
    });
  });

  return io;
}

// ─── Error mapping ───────────────────────────────────────────────

export function gatewayErrorToStatus(error: string): { status: number; message: string } {
  if (error === "FEATURE_DISABLED") {
    return { status: 503, message: "Terminal is disabled" };
  }
  if (error === "Missing token or sandboxId") {
    return { status: 400, message: error };
  }

  const tokenStatus = tokenErrorToStatus(error);
  if (tokenStatus !== 401 || error.startsWith("TOKEN_")) {
    return { status: tokenStatus, message: error };
  }

  return { status: 401, message: "Unauthorized" };
}
