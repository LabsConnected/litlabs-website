/**
 * RemoteModelProvider — a ModelProvider that streams inference from
 * the LiTT terminal-server's /api/inference endpoint.
 *
 * This is the CUSTOMER path. A paid LiTT user with NO local
 * OPENROUTER_API_KEY gets inference served by the server, which holds
 * the provider key server-side. The CLI never sees the key.
 *
 *   CLI cockpit
 *     ↓
 *   RemoteModelProvider.stream()
 *     ↓
 *   POST /api/inference  (Bearer: terminal JWT from AuthSession)
 *     ↓
 *   terminal-server: verifyToken → checkEntitlement → runLiTTOperator
 *     ↓
 *   SSE stream: meta / delta / done / error / complete events
 *     ↓
 *   parsed back into ModelStreamEvent → emit to the agent loop
 *
 * The server's OPENROUTER_API_KEY NEVER appears in:
 *   - any request from the CLI (only the terminal JWT is sent)
 *   - any response body, header, or SSE event
 *   - any log line on the client
 *   - the session file (~/.litt/sessions.json)
 *
 * Entitlement failures (402) are surfaced as ModelStreamEvent "error"
 * with a clean human message — never a raw API-key error.
 */

import type {
  ChatMessage,
  ModelProvider,
  ModelResult,
  ModelStreamEvent,
  ModelProfile,
} from "@litt/agent-core";
import { getTerminalUrl } from "./auth/auth-config.js";
import { getAuthSession } from "./auth/auth-session.js";

// ─── Types ─────────────────────────────────────────────────────────

export interface RemoteModelProviderOptions {
  /** Terminal-server base URL (defaults to production). */
  terminalUrl?: string;
  /** Working directory to pass to the server. */
  cwd?: string;
  /** Mission mode. */
  mode?: "plan" | "act" | "auto";
  /** The configured model label (for display truth — the server picks the actual model). */
  configuredModel?: string;
}

// SSE event types from /api/inference
interface SSEMetaEvent {
  provider: string;
  model: string;
  profile: ModelProfile;
}
interface SSEDeltaEvent {
  text: string;
}
interface SSEDoneEvent {
  model: string;
  usage: { total_tokens: number };
  timing: { ttftMs: number; generationMs: number; totalMs: number };
}
interface SSEErrorEvent {
  message: string;
}
interface SSECompleteEvent {
  runId: string;
  content: string;
  termination: string;
  rounds: number;
  toolCalls: number;
  coinsDebited: number;
}

// ─── RemoteModelProvider ───────────────────────────────────────────

export class RemoteModelProvider implements ModelProvider {
  /** Identifies this as the remote/server-served provider. */
  readonly providerId = "remote" as const;
  private readonly _terminalUrl: string;
  private readonly _cwd: string;
  private readonly _mode: "plan" | "act" | "auto";
  private readonly _configuredModel: string;
  /** The active model — set after the first meta/done event from the server. */
  private _activeModel: string | null = null;

  constructor(options: RemoteModelProviderOptions = {}) {
    this._terminalUrl = options.terminalUrl ?? getTerminalUrl();
    this._cwd = options.cwd ?? process.cwd();
    this._mode = options.mode ?? "act";
    this._configuredModel = options.configuredModel ?? "remote";
  }

  /** The configured model (what was requested). May differ from activeModel. */
  get configuredModel(): string {
    return this._configuredModel;
  }

  /** The active model — null until the server reports it via meta/done. */
  get activeModel(): string | null {
    return this._activeModel;
  }

  /**
   * Stream inference from the server.
   *
   * The CLI sends the conversation + terminal JWT. The server:
   *   1. Verifies the JWT → extracts userId
   *   2. Checks entitlement (subscription + credits)
   *   3. Runs the operator with the server's provider key
   *   4. Streams SSE events back
   *
   * We parse the SSE stream incrementally and emit ModelStreamEvents
   * to the agent loop. The final ModelResult is assembled from the
   * "complete" event (or from accumulated deltas if the server sends
   * done but not complete).
   */
  async stream(
    messages: ChatMessage[],
    emit: (event: ModelStreamEvent) => void,
  ): Promise<ModelResult> {
    // Get the terminal JWT — this is the ONLY credential we send.
    // The server's OPENROUTER_API_KEY is never on this machine.
    const authSession = getAuthSession();
    const token = await authSession.getTerminalToken();
    if (!token) {
      throw new Error(
        "Not authenticated for remote inference. Run `litt login` to sign in.",
      );
    }

    // Build the request body — send the full conversation so the
    // server's operator has context. The server reconstructs the
    // system prompt with project context.
    const body = {
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      cwd: this._cwd,
      mode: this._mode,
    };

    const t0 = Date.now();
    let firstTokenTs: number | null = null;
    let accumulatedContent = "";
    let serverModel = "remote";
    let serverProvider = "remote";
    let totalTokens = 0;
    let ttftMs = 0;
    let generationMs = 0;

    const response = await fetch(`${this._terminalUrl}/api/inference`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000), // 4 min — matches /api/command
    });

    // ─── Entitlement failure (402) ────────────────────────────────
    // Surface a clean message — never a raw API-key error.
    if (response.status === 402) {
      const payload = await response.json().catch(() => null) as
        | { error?: string; code?: string; plan?: string; coinBalance?: number }
        | null;
      const message = payload?.error ?? "Subscription required for remote inference.";
      emit({ type: "error", message });
      throw new Error(message);
    }

    // ─── Auth failure (401) ───────────────────────────────────────
    if (response.status === 401) {
      const message = "Authentication expired. Run `litt login` to re-authenticate.";
      emit({ type: "error", message });
      throw new Error(message);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const message = `Remote inference failed (${response.status}): ${text.slice(0, 200)}`;
      emit({ type: "error", message });
      throw new Error(message);
    }

    // ─── Parse the SSE stream ─────────────────────────────────────
    if (!response.body) {
      throw new Error("No response body from /api/inference");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by \n\n. Process complete events.
        let eventEnd: number;
        while ((eventEnd = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, eventEnd);
          buffer = buffer.slice(eventEnd + 2);

          const parsed = parseSSEEvent(rawEvent);
          if (!parsed) continue;

          switch (parsed.event) {
            case "meta": {
              const data = parsed.data as SSEMetaEvent;
              serverProvider = data.provider;
              serverModel = data.model;
              this._activeModel = data.model;
              emit({
                type: "meta",
                provider: data.provider,
                model: data.model,
                profile: data.profile,
              });
              break;
            }
            case "delta": {
              const data = parsed.data as SSEDeltaEvent;
              if (firstTokenTs === null) {
                firstTokenTs = Date.now();
                ttftMs = firstTokenTs - t0;
              }
              accumulatedContent += data.text;
              emit({ type: "delta", text: data.text });
              break;
            }
            case "done": {
              const data = parsed.data as SSEDoneEvent;
              serverModel = data.model;
              this._activeModel = data.model;
              totalTokens = data.usage?.total_tokens ?? 0;
              generationMs = data.timing?.generationMs ?? 0;
              emit({
                type: "done",
                model: data.model,
                usage: data.usage,
                timing: data.timing,
              });
              break;
            }
            case "complete": {
              // The server's final event with the full content.
              // If we have this, prefer it over accumulated deltas
              // (it's the canonical result from the operator).
              const data = parsed.data as SSECompleteEvent;
              if (data.content) {
                accumulatedContent = data.content;
              }
              break;
            }
            case "error": {
              const data = parsed.data as SSEErrorEvent;
              emit({ type: "error", message: data.message });
              // Don't throw — the stream may continue after a recoverable
              // error. The server will close the stream when it's done.
              break;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const totalMs = Date.now() - t0;
    if (generationMs === 0) generationMs = totalMs - ttftMs;

    return {
      content: accumulatedContent,
      model: serverModel,
      provider: serverProvider,
      usage: { total_tokens: totalTokens },
      timing: { ttftMs, generationMs, totalMs },
      profile: "auto",
    };
  }

  /**
   * Health check — ping the terminal-server's /health/live endpoint.
   * Returns ms if reachable, -1 if not.
   */
  async health(): Promise<number> {
    const t0 = Date.now();
    try {
      const response = await fetch(`${this._terminalUrl}/health/live`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return -1;
      return Date.now() - t0;
    } catch {
      return -1;
    }
  }
}

// ─── SSE parser ────────────────────────────────────────────────────

/**
 * Parse a single SSE event block into { event, data }.
 *
 * SSE format:
 *   event: delta
 *   data: {"text":"hello"}
 *
 * Multiple `data:` lines are concatenated with \n (per SSE spec).
 * Returns null if the block has no data or is malformed.
 */
function parseSSEEvent(raw: string): { event: string; data: unknown } | null {
  const lines = raw.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
    // Ignore comments (lines starting with :) and id/retry fields
  }

  if (dataLines.length === 0) return null;

  const dataStr = dataLines.join("\n");
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    // Non-JSON data — return as raw string
    return { event, data: dataStr };
  }
}

// ─── Availability check ────────────────────────────────────────────

/**
 * Check if the remote inference path is available:
 *   1. The user is signed in (has a Clerk session)
 *   2. The terminal-server is reachable
 *
 * This is called by resolveProviderAdapter() to decide whether to
 * use the RemoteModelProvider when no local key is set.
 *
 * Returns false if either check fails — the caller then falls through
 * to the "Set OPENROUTER_API_KEY" hint.
 */
export async function isRemoteInferenceAvailable(): Promise<boolean> {
  const authSession = getAuthSession();
  const signedIn = await authSession.isSignedIn();
  if (!signedIn) return false;

  // Cheap reachability check — don't exchange a token here, just
  // ping the health endpoint.
  try {
    const response = await fetch(`${getTerminalUrl()}/health/live`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
