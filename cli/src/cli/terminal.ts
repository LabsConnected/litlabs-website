import type { RuntimeContext } from "./types.js";

export interface TerminalCapability {
  available: boolean;
  status: "available" | "unavailable" | "connecting" | "error";
  sessionId?: string;
}

export async function detectTerminalCapability(
  ctx: RuntimeContext,
): Promise<TerminalCapability> {
  // The terminal server is a separate process; the CLI can only infer
  // availability from env/config. Actual PTY sessions require the web
  // app's terminal token flow, which the CLI does not own.
  const httpUrl =
    process.env.NEXT_PUBLIC_TERMINAL_HTTP_URL ||
    process.env.NEXT_PUBLIC_TERMINAL_WS_URL ||
    process.env.TERMINAL_SERVER_INTERNAL_URL ||
    process.env.LITT_TERMINAL_URL ||
    "";

  if (!httpUrl || httpUrl.includes("localhost")) {
    return { available: false, status: "unavailable" };
  }

  // Best-effort health probe
  try {
    const url = new URL(httpUrl);
    const transport = url.protocol === "https:" ? await import("node:https") : await import("node:http");
    const ready = await new Promise<boolean>((resolve) => {
      const req = (transport.default || transport).request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: "/health",
          method: "GET",
          timeout: 2000,
        },
        (res: any) => {
          resolve(res.statusCode === 200);
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.end();
    });

    if (ready) {
      return { available: true, status: "available" };
    }
  } catch {
    // ignore
  }

  return { available: false, status: "error" };
}

export function describeTerminalStatus(
  status: TerminalCapability["status"],
): string {
  switch (status) {
    case "available":
      return "available";
    case "connecting":
      return "connecting";
    case "error":
      return "error";
    default:
      return "unavailable";
  }
}