import http from "node:http";
import https from "node:https";
import type {
  LiTTRunResponse,
  LiTTStreamEvent,
  ChatMessage,
  RuntimeContext,
} from "./types.js";
import { getAuthHeaders } from "./auth.js";

const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3001";

export interface RunLiTTOptions {
  message: string;
  history?: ChatMessage[];
  runtimeContext?: Partial<RuntimeContext>;
  stream?: boolean;
  /** Hint target model id (e.g. "gemini-2.5-pro"). */
  model?: string;
  /**
   * Hint target provider. If omitted, we infer it from `model` where the
   * mapping is unambiguous (e.g. "gemini-*" -> "gemini"). The LiTT runtime
   * only honors `requestedModel` when paired with a known `requestedProvider`,
   * so we forward a derived provider so `--model` actually takes effect.
   */
  provider?: string;
  agentSlug?: string;
  projectId?: string;
}

export interface RunLiTTResult {
  response: LiTTRunResponse;
  conversationId?: string;
}

function request(url: string, body: Record<string, unknown>): Promise<LiTTRunResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const payload = JSON.stringify(body);
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        ...getAuthHeaders(),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        try {
          const data = JSON.parse(raw);
          if (res.statusCode && res.statusCode >= 400 || data.error) {
            return reject(new Error(data.error || `HTTP ${res.statusCode}`));
          }
          resolve(data as LiTTRunResponse);
        } catch {
          reject(new Error(`Invalid JSON response: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

export async function runLiTT(options: RunLiTTOptions): Promise<RunLiTTResult> {
  const baseUrl = resolveBaseUrl();
  const url = `${baseUrl}/api/litt/run`;
  const body: Record<string, unknown> = {
    message: options.message,
    agentMode: "cli",
    agentSlug: options.agentSlug || "litt",
    stream: false,
    ...resolveModelFields(options),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.history?.length ? { history: options.history } : {}),
        ...(options.runtimeContext ? { runtimeContext: options.runtimeContext } : {}),
  };
  const response = await request(url, body);
  return { response };
}

export async function* runLiTTStream(options: RunLiTTOptions): AsyncGenerator<LiTTStreamEvent> {
  const baseUrl = resolveBaseUrl();
  const url = `${baseUrl}/api/litt/run`;
  const body: Record<string, unknown> = {
    message: options.message,
    agentMode: "cli",
    agentSlug: options.agentSlug || "litt",
    stream: true,
    ...resolveModelFields(options),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.history?.length ? { history: options.history } : {}),
    ...(options.runtimeContext ? { runtimeContext: options.runtimeContext } : {}),
  };
  yield* streamResponse(url, body);
}

async function* streamResponse(
  url: string,
  body: Record<string, unknown>,
): AsyncGenerator<LiTTStreamEvent> {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  const payload = JSON.stringify(body);
  const events: LiTTStreamEvent[] = [];

  await new Promise<void>((resolve, reject) => {
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Accept: "text/event-stream",
          ...getAuthHeaders(),
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            try {
              const data = JSON.parse(raw);
              reject(new Error(data.error || `HTTP ${res.statusCode}`));
            } catch {
              reject(new Error(`HTTP ${res.statusCode}`));
            }
          });
          return;
        }

        let buffer = "";
        res.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") {
              resolve();
              return;
            }
            try {
              events.push(JSON.parse(data) as LiTTStreamEvent);
            } catch {
              // skip malformed
            }
          }
        });

        res.on("end", resolve);
        res.on("error", reject);
      },
    );

    req.on("error", reject);
    req.write(payload);
    req.end();
  });

  for (const event of events) {
    yield event;
  }
}

function resolveBaseUrl(): string {
  const fromEnv = process.env.LITT_CODE_API_URL || process.env.NEXT_PUBLIC_API_BASE || process.env.LITT_API_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, "");
  return DEFAULT_API_BASE.replace(/\/+$/, "");
}

/**
 * Build the `requestedProvider` / `requestedModel` fields for the LiTT runtime
 * request.
 *
 * The runtime (`provider-router.ts` -> `selectModelOptions`) only applies a
 * model override when a valid `requestedProvider` is paired with
 * `requestedModel`. So when the user supplies `--model` we also supply a
 * `requestedProvider`.
 *
 * Strategy:
 * - An explicit `--provider` always wins.
 * - Otherwise infer the provider from the model prefix where unambiguous
 *   (gemini-* -> "gemini"), covering the stack's default provider. For other
 *   model ids the provider is left to server auto-routing and only
 *   `requestedModel` is sent as a hint.
 */
function resolveModelFields(options: RunLiTTOptions): Record<string, unknown> {
  const { model, provider } = options;
  const inferred = provider ?? inferProvider(model);
  const fields: Record<string, unknown> = {};
  if (model) {
    fields.requestedModel = model;
    if (inferred) fields.requestedProvider = inferred;
  } else if (inferred) {
    fields.requestedProvider = inferred;
  }
  return fields;
}

/** Infer a provider from a model string; unambiguous only for known roots. */
function inferProvider(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const root = model.match(/^([a-z]+[a-z0-9-]*)/)?.[1];
  if (!root) return undefined;
  // gemini-2.5-pro -> gemini
  if (root.startsWith("gemini")) return "gemini";
  return undefined;
}