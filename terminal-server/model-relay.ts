/**
 * Model relay — the handler logic behind the CLI interactive cockpit's
 * litt:model:request / litt:model:event / litt:model:cancel Socket.IO
 * channel. Extracted from server.ts so it's unit-testable without a
 * real (or faked) Socket.IO server.
 *
 * PURE model-completion proxy: streams text + relays OpenRouter's
 * native tool_calls back to the caller. Never executes a tool, never
 * touches a gateway or filesystem — the CLI's own local agent loop
 * does that against the user's real project, exactly as in
 * local-provider mode. Only the model call moves server-side.
 *
 * Gated by the SAME billing.ts entitlement/credit check Commit A added
 * for the /api/command ask path — no separate, looser entry point into
 * model execution exists on this server.
 */

import type { ChatMessage } from "@litt/agent-core";
import { streamModelForRemoteClient, type LiTTEvent, type RemoteToolSchema } from "./litt-code.js";
import { getBillingClient } from "./billing.js";
import { redactSecrets } from "./command-registry.js";

export interface ModelRequestPayload {
  requestId: string;
  model: string;
  messages: ChatMessage[];
  tools?: RemoteToolSchema[];
  maxTokens?: number;
  /** Provider the CLI routed to ("openai", "openrouter", etc.). */
  providerHint?: string;
  /** OpenRouter fallback model slug, used if server falls back to OpenRouter. */
  openRouterModelId?: string;
}

export interface ModelRelayEventPayload {
  requestId: string;
  event: LiTTEvent;
  denied?: boolean;
  denialCode?: string;
}

export type ModelRelayEmit = (payload: ModelRelayEventPayload) => void;

/**
 * Handle one litt:model:request. `userId` is the VERIFIED identity from
 * the socket's terminal JWT (never trust a client-supplied one).
 * `activeStreams` is the caller's per-socket AbortController registry —
 * this function owns adding/removing this requestId's entry.
 */
export async function handleModelRequest(
  userId: string | null | undefined,
  payload: ModelRequestPayload,
  emit: ModelRelayEmit,
  activeStreams: Map<string, AbortController>,
): Promise<void> {
  const requestId = payload?.requestId;
  if (!requestId || !Array.isArray(payload?.messages) || !payload?.model) {
    emit({
      requestId: requestId ?? "unknown",
      event: { type: "error", message: "Invalid request: require requestId, model, and messages[]" },
    });
    return;
  }

  // ─── Authorization gate — BEFORE any provider resource is touched ──
  const authz = await getBillingClient().authorize(userId);
  if (!authz.ok) {
    emit({
      requestId,
      event: { type: "error", message: authz.message ?? "Not authorized." },
      denied: true,
      denialCode: authz.code,
    });
    return;
  }
  const identity = authz.identity!;

  const controller = new AbortController();
  activeStreams.set(requestId, controller);

  let streamProvider: string | null = null;
  let streamModel: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  try {
    await streamModelForRemoteClient(
      payload.messages,
      payload.tools ?? [],
      (event) => {
        if (event.type === "meta") {
          streamProvider = event.provider;
          streamModel = event.model;
        }
        if (event.type === "done") {
          streamModel = event.model;
          promptTokens += event.usage.prompt_tokens ?? 0;
          completionTokens += event.usage.completion_tokens ?? 0;
          totalTokens += event.usage.total_tokens ?? 0;
        }
        emit({ requestId, event });
      },
      {
        model: payload.model,
        providerHint: payload.providerHint,
        openRouterModelId: payload.openRouterModelId,
        maxTokens: payload.maxTokens,
        signal: controller.signal,
      },
    );

    // Usage recording — success only, for any billed provider
    // (openrouter or openai direct). Billing-exempt owner: meter but
    // don't debit (handled in recordUsage).
    if (streamProvider === "openrouter" || streamProvider === "openai") {
      await getBillingClient().recordUsage({
        identity,
        runId: requestId,
        provider: streamProvider,
        model: streamModel ?? "unknown",
        promptTokens,
        completionTokens,
        totalTokens,
        billingExempt: authz.billingExempt ?? false,
      });
    }
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    emit({ requestId, event: { type: "error", message } });
    // No usage recording on failure — a failed/cancelled call is never billed.
  } finally {
    activeStreams.delete(requestId);
  }
}

/** Handle one litt:model:cancel — aborts the matching in-flight stream, if any. */
export function handleModelCancel(activeStreams: Map<string, AbortController>, requestId: string | undefined): void {
  if (!requestId) return;
  const controller = activeStreams.get(requestId);
  if (controller) controller.abort();
}
