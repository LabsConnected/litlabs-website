/**
 * command-center-ping — Phase 2 connectivity test task.
 *
 * Sends ONE signed test event through the public n8n bridge
 * (POST /api/n8n/webhook/command-center-ping-test) to an isolated,
 * manually-triggered n8n workflow, and records every attempt/result in
 * the local Command Center event log (authoritative — no Supabase).
 *
 * Safety:
 * - Payload is fixed-shape: eventType "test.command-center-ping",
 *   approvedAction "log_event" — the n8n workflow is log-only and performs
 *   no outbound actions.
 * - Idempotent: a delivered idempotencyKey short-circuits the run.
 * - Retries: bounded, exponential, jittered (see task config).
 *
 * Node runtime APIs (fs) are used for the event log — runs locally under
 * `trigger.dev dev` or in Trigger.dev cloud.
 */

import { task } from "@trigger.dev/sdk";
import { randomUUID } from "crypto";
import {
  signWebhookPayload,
  type N8nWebhookPayload,
} from "@/lib/n8n-webhook";
import {
  appendLocalEvent,
  hasDeliveredKey,
} from "@/lib/command-center/local-event-log";

const EVENT_TYPE = "command-center-ping";
const TEST_WEBHOOK_PATH = "command-center-ping-test";
const EVENT_LOG_TYPE = "command-center-ping";

export interface CommandCenterPingPayload {
  /** Caller-supplied idempotency key; a UUID is generated when omitted. */
  idempotencyKey?: string;
  /** Short free-text echo for debugging (logged verbatim — keep clean). */
  echo?: string;
  /** Who initiated the test run, e.g. "muse" / "devin" / "claude". */
  source?: string;
}

export interface CommandCenterPingResult {
  ok: boolean;
  idempotencyKey: string;
  deduplicated: boolean;
  bridgeStatus: number | null;
}

function bridgeUrl(): string {
  const configured = process.env.COMMAND_CENTER_BRIDGE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) {
    throw new Error(
      "command-center-ping: set COMMAND_CENTER_BRIDGE_URL or NEXT_PUBLIC_SITE_URL",
    );
  }
  return `${site.replace(/\/$/, "")}/api/n8n/webhook/${TEST_WEBHOOK_PATH}`;
}

export const commandCenterPing = task({
  id: EVENT_TYPE,
  maxDuration: 60,
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    randomize: true,
  },
  run: async (input: CommandCenterPingPayload): Promise<CommandCenterPingResult> => {
    const idempotencyKey = input.idempotencyKey ?? randomUUID();

    if (hasDeliveredKey(EVENT_LOG_TYPE, idempotencyKey)) {
      appendLocalEvent({
        type: EVENT_LOG_TYPE,
        idempotencyKey,
        status: "deduplicated",
        detail: { source: input.source ?? "unknown" },
      });
      return { ok: true, idempotencyKey, deduplicated: true, bridgeStatus: null };
    }

    appendLocalEvent({
      type: EVENT_LOG_TYPE,
      idempotencyKey,
      status: "attempt",
      detail: { source: input.source ?? "unknown", echo: input.echo ?? null },
    });

    const payload: N8nWebhookPayload = {
      userId: "system",
      projectId: "platform",
      missionId: null,
      eventType: "test.command-center-ping",
      approvedAction: "log_event",
      callbackUrl: "",
      idempotencyKey,
      data: {
        echo: input.echo ?? null,
        source: input.source ?? "unknown",
        phase: "n8n-trigger-phase2",
      },
    };

    const { body, signature, timestamp } = signWebhookPayload(payload);

    let bridgeStatus: number | null = null;
    let bridgeOk = false;
    let bridgeBody: unknown = null;
    try {
      const res = await fetch(bridgeUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-litt-signature": signature,
          "x-litt-timestamp": String(timestamp),
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      bridgeStatus = res.status;
      bridgeOk = res.ok;
      bridgeBody = await res.json().catch(() => null);
    } catch (err) {
      appendLocalEvent({
        type: EVENT_LOG_TYPE,
        idempotencyKey,
        status: "failed",
        detail: {
          stage: "bridge-fetch",
          error: err instanceof Error ? err.message : String(err),
        },
      });
      throw err; // let trigger.dev retry policy apply
    }

    appendLocalEvent({
      type: EVENT_LOG_TYPE,
      idempotencyKey,
      status: bridgeOk ? "delivered" : "failed",
      detail: { bridgeStatus, bridgeBody },
    });

    if (!bridgeOk) {
      // Non-2xx from the bridge: retryable on 5xx, permanent on 4xx.
      throw new Error(
        `command-center-ping: bridge returned ${bridgeStatus} for ${idempotencyKey}`,
      );
    }

    return { ok: true, idempotencyKey, deduplicated: false, bridgeStatus };
  },
});
