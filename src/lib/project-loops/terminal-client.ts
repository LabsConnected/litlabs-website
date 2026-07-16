/**
 * Project Loops — terminal-server client
 *
 * Server-side wrapper around the standalone terminal-server's
 * `POST /run` one-shot command endpoint. The Loop agent uses this to
 * actually run `pnpm tsc`, `pnpm test`, `pnpm lint` etc. inside a
 * per-user sandbox instead of fabricating fake test results.
 *
 * The terminal-server is a separate Node process (pnpm terminal:dev)
 * and is NOT available on Vercel — the caller should treat any
 * connection failure as a soft "skip" and continue the loop.
 */

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const DEFAULT_BASE_URL =
  process.env.TERMINAL_SERVER_URL ||
  process.env.NEXT_PUBLIC_TERMINAL_URL ||
  "http://localhost:4001";

export type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  truncated: boolean;
  durationMs: number;
  cwd: string;
};

export type RunError = {
  error: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number | null;
  truncated?: boolean;
  durationMs?: number;
};

/**
 * Run a shell command in the user's terminal-server sandbox and return
 * the captured output. Returns `null` when the terminal-server is not
 * reachable (e.g. in production on Vercel) so callers can fall back
 * gracefully.
 */
export async function runInTerminal(args: {
  userId: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}): Promise<RunResult | null> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Get a short-lived token. The /api/terminal/token route ships in
  // a later commit; for now we accept an env-provided bearer token as
  // a fallback so the client is usable from a custom server context.
  let token: string | undefined = process.env.TERMINAL_AUTH_TOKEN;
  let baseUrl = DEFAULT_BASE_URL;
  try {
    const tokenRes = await fetch("/api/terminal/token", { cache: "no-store" });
    if (tokenRes.ok) {
      const body = (await tokenRes.json()) as {
        token: string;
        baseUrl?: string;
      };
      token = body.token;
      if (body.baseUrl) baseUrl = body.baseUrl;
    }
  } catch {
    // network error — fall through to env-based token or null below
  }
  if (!token) {
    return null; // No token available — silently skip the live call.
  }

  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/$/, "")}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        command: args.command,
        cwd: args.cwd,
        timeoutMs,
        env: args.env,
      }),
    });
  } catch {
    return null;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as RunError;
    throw new Error(
      `terminal-server returned ${res.status}: ${body.error ?? "unknown"}`,
    );
  }

  return (await res.json()) as RunResult;
}

/** True when the terminal-server is reachable and authenticated. */
export async function isTerminalAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/terminal/token", { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
