// CLI Bridge WebSocket Route
// Allows remote control of qwen, hermes, openclaw, and other CLI tools
// Only admin user can access this

import { spawn, ChildProcess } from "child_process";
import { auth } from "@clerk/nextjs/server";

// Admin user ID - only this user can use CLI bridge
const ADMIN_USER_ID = process.env.ADMIN_CLERK_ID || process.env.ADMIN_USER_ID || "";

// Active sessions storage
const activeSessions = new Map<
  string,
  {
    process: ChildProcess;
    toolName: string;
    startTime: Date;
    outputBuffer: string[];
  }
>();

interface BridgeMessage {
  type: "command" | "input" | "resize" | "ping";
  tool?: string;
  command?: string;
  args?: string[];
  input?: string;
  cols?: number;
  rows?: number;
}

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (userId !== ADMIN_USER_ID) {
    return new Response("Forbidden", { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const tool = searchParams.get("tool") || "terminal";

  if (!["qwen", "hermes", "openclaw", "gemini", "terminal"].includes(tool)) {
    return new Response("Invalid tool", { status: 400 });
  }

  const sessionId = `${userId}_${tool}_${Date.now()}`;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: "connected", sessionId, tool })}\n\n`,
        ),
      );

      // Spawn the CLI tool
      let childProcess: ChildProcess;

      try {
        switch (tool) {
          case "qwen":
            childProcess = spawn("qwen", [], {
              cwd: process.env.HOME || "/home/litbit",
              env: { ...process.env, TERM: "xterm-256color" },
            });
            break;
          case "hermes":
            childProcess = spawn("hermes", [], {
              cwd: process.env.HOME || "/home/litbit",
              env: { ...process.env, TERM: "xterm-256color" },
            });
            break;
          case "openclaw":
            childProcess = spawn("openclaw", [], {
              cwd: process.env.HOME || "/home/litbit",
              env: { ...process.env, TERM: "xterm-256color" },
            });
            break;
          case "gemini":
            childProcess = spawn("gemini", [], {
              cwd: process.env.HOME || "/home/litbit",
              env: {
                ...process.env,
                TERM: "xterm-256color",
                GEMINI_API_KEY: process.env.GEMINI_API_KEY,
              },
            });
            break;
          default:
            childProcess = spawn("bash", ["-i"], {
              cwd: process.env.HOME || "/home/litbit",
              env: { ...process.env, TERM: "xterm-256color" },
            });
        }

        activeSessions.set(sessionId, {
          process: childProcess,
          toolName: tool,
          startTime: new Date(),
          outputBuffer: [],
        });

        // Handle stdout
        childProcess.stdout?.on("data", (data: Buffer) => {
          if (!closed) {
            const output = data.toString("utf-8");
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "output", data: output })}\n\n`,
              ),
            );
          }
        });

        // Handle stderr
        childProcess.stderr?.on("data", (data: Buffer) => {
          if (!closed) {
            const output = data.toString("utf-8");
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", data: output })}\n\n`,
              ),
            );
          }
        });

        // Handle process exit
        childProcess.on("exit", (code) => {
          if (!closed) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "exit", code })}\n\n`,
              ),
            );
            controller.close();
            closed = true;
            activeSessions.delete(sessionId);
          }
        });

        // Handle errors
        childProcess.on("error", (err) => {
          if (!closed) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ type: "error", data: err.message })}\n\n`,
              ),
            );
            controller.close();
            closed = true;
            activeSessions.delete(sessionId);
          }
        });

        // Set timeout (30 minutes max)
        setTimeout(
          () => {
            if (!closed && activeSessions.has(sessionId)) {
              childProcess.kill();
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: "timeout", message: "Session expired after 30 minutes" })}\n\n`,
                ),
              );
              controller.close();
              closed = true;
              activeSessions.delete(sessionId);
            }
          },
          30 * 60 * 1000,
        );
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : "Failed to spawn process";
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", data: errorMessage })}\n\n`,
          ),
        );
        controller.close();
        closed = true;
      }
    },

    cancel() {
      closed = true;
      const session = activeSessions.get(sessionId);
      if (session) {
        session.process.kill();
        activeSessions.delete(sessionId);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// POST endpoint to send input to running CLI session
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (userId !== ADMIN_USER_ID) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as BridgeMessage & { sessionId: string };
    const { sessionId, type, input } = body;

    const session = activeSessions.get(sessionId);
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    if (type === "input" && input) {
      // Validate input (basic security)
      if (input.length > 10000) {
        return Response.json({ error: "Input too long" }, { status: 400 });
      }

      // Write to stdin
      session.process.stdin?.write(input + "\n");

      return Response.json({ success: true });
    }

    if (type === "resize") {
      // Terminal resize not implemented for basic spawn
      return Response.json({ success: true });
    }

    return Response.json({ error: "Unknown message type" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

// DELETE endpoint to kill session
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (userId !== ADMIN_USER_ID) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");

  if (!sessionId) {
    return Response.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const session = activeSessions.get(sessionId);
  if (session) {
    session.process.kill();
    activeSessions.delete(sessionId);
  }

  return Response.json({ success: true });
}

// GET sessions list
export async function PATCH() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (userId !== ADMIN_USER_ID) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessions = Array.from(activeSessions.entries())
    .filter(([id]) => id.startsWith(userId))
    .map(([id, session]) => ({
      sessionId: id,
      toolName: session.toolName,
      startTime: session.startTime,
      uptime: Date.now() - session.startTime.getTime(),
    }));

  return Response.json({ sessions });
}
