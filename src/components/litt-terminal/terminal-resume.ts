/**
 * Terminal reconnect + session-resume helpers (pure, unit-tested).
 *
 * Root causes these address (acceptance run 2026-09-28):
 *  1. The socket handshake captured ONE terminal token at mount. Every
 *     automatic reconnect replayed that token, so once it expired the
 *     reconnect loop could only fail "Unauthorized" — and the one-shot
 *     refresh path only ever fired once per mount.
 *  2. A server-initiated disconnect ("io server disconnect") is never
 *     retried by socket.io itself, so the panel stayed "disconnected".
 *  3. The server killed the PTY on every socket close, so a refresh or a
 *     station change lost the shell and anything running in it.
 *
 * The fixes: the handshake `auth` is a function (socket.io calls it on
 * every connect AND reconnect) that fetches a fresh token and offers the
 * last sessionId for resume; server-initiated disconnects reconnect with
 * bounded backoff; the terminal server parks the PTY for a grace window.
 */

const STORAGE_PREFIX = "litt:pty-session:";

/** Bounded exponential backoff: 1s, 2s, 4s … capped at 30s. */
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const n = Math.max(1, Math.floor(attempt));
  const exp = Math.min(RECONNECT_BASE_MS * 2 ** (n - 1), RECONNECT_MAX_MS);
  // ±25% jitter so many tabs do not reconnect in lockstep, never above the cap.
  const jitter = exp * 0.25 * (random() * 2 - 1);
  return Math.max(RECONNECT_BASE_MS / 2, Math.min(RECONNECT_MAX_MS, Math.round(exp + jitter)));
}

/**
 * socket.io retries transport-level drops on its own, but a disconnect the
 * SERVER initiated ("io server disconnect") is final unless the client
 * calls connect() again. A deliberate client disconnect (unmount) must not
 * be retried.
 */
export function needsManualReconnect(reason: string): boolean {
  return reason === "io server disconnect";
}

function storageKey(projectId: string | null | undefined): string {
  return `${STORAGE_PREFIX}${projectId ?? "default"}`;
}

function safeSession(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The PTY session to ask the server to resume. sessionStorage (not
 * localStorage) on purpose: it survives a refresh of this tab but is not
 * shared with other tabs, so two tabs never fight over one shell.
 */
export function loadResumeSessionId(
  projectId: string | null | undefined,
  storage: Pick<Storage, "getItem"> | null = safeSession(),
): string | null {
  try {
    const value = storage?.getItem(storageKey(projectId)) ?? null;
    return value && UUID.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveResumeSessionId(
  projectId: string | null | undefined,
  sessionId: string,
  storage: Pick<Storage, "setItem"> | null = safeSession(),
): void {
  if (!UUID.test(sessionId)) return;
  try {
    storage?.setItem(storageKey(projectId), sessionId);
  } catch {
    // Storage unavailable (private mode, quota) — resume is best-effort.
  }
}

export function clearResumeSessionId(
  projectId: string | null | undefined,
  storage: Pick<Storage, "removeItem"> | null = safeSession(),
): void {
  try {
    storage?.removeItem(storageKey(projectId));
  } catch {
    // ignore
  }
}

export interface SocketAuthPayload {
  token: string;
  resumeSessionId?: string;
}

/**
 * Build the socket.io `auth` callback. socket.io invokes it before EVERY
 * connection attempt, including automatic reconnects, so each attempt
 * carries a token that is valid now and the session to resume.
 *
 * If fetching a fresh token fails, the last good token is used so the
 * server returns a real "Unauthorized" (which the panel surfaces) instead
 * of the handshake hanging.
 */
export function createSocketAuth(opts: {
  initialToken: string;
  fetchToken: () => Promise<string>;
  resumeSessionId: () => string | null;
}): (cb: (data: SocketAuthPayload) => void) => void {
  let lastToken = opts.initialToken;
  let first = true;
  return (cb) => {
    const finish = (token: string) => {
      const resume = opts.resumeSessionId();
      cb(resume ? { token, resumeSessionId: resume } : { token });
    };
    if (first) {
      // The token was fetched moments ago for the initial connect.
      first = false;
      finish(lastToken);
      return;
    }
    opts
      .fetchToken()
      .then((token) => {
        lastToken = token;
        finish(token);
      })
      .catch(() => finish(lastToken));
  };
}
