import "server-only";
import { assertSpendAuthorized } from "@/lib/metered-llm-call";
import { chargeLlmUsage } from "@/lib/llm-billing";
import { emitLlmMetering } from "@/lib/metering";

/** Billing adapter for SDK calls that cannot use the text-only LLM client.
 * Provider selection and request construction remain with the caller.
 */
export async function meteredProviderCall<T>(input: {
  clerkId: string;
  feature: string;
  provider: string;
  model: string;
  callId: string;
  execute: () => Promise<T>;
  usage: (result: T) => { promptTokens: number; completionTokens: number };
}): Promise<
  | { ok: true; result: T }
  | { ok: false; status: 402 | 403 | 503; error: string }
> {
  const authorization = await assertSpendAuthorized(input.clerkId);
  if (!authorization.ok) return authorization;

  const startedAt = new Date();
  const idempotencyKey = `metering:llm:${input.callId}:0`;
  const context = {
    clerkId: input.clerkId,
    feature: input.feature,
    provider: input.provider,
    model: input.model,
    originalRequestId: input.callId,
    idempotencyKey,
    startedAt,
  };

  // Only provider execution belongs in this catch: a billing failure after
  // success must never overwrite the successful provider attempt as failed.
  let result: T;
  try {
    result = await input.execute();
  } catch (error) {
    await emitLlmMetering({
      ...context,
      status: "failed",
      billable: false,
      error: error instanceof Error ? error.message.slice(0, 500) : "Provider request failed",
      finishedAt: new Date(),
    });
    throw error;
  }

  const usage = input.usage(result);
  await emitLlmMetering({
    ...context,
    inputTokens: usage.promptTokens,
    outputTokens: usage.completionTokens,
    status: "success",
    finishedAt: new Date(),
  });
  const billing = await chargeLlmUsage({
    clerkId: input.clerkId,
    provider: input.provider,
    model: input.model,
    ...usage,
    isByok: false,
    callId: input.callId,
    meteringBillableKey: idempotencyKey,
  });
  if (billing.error) {
    return {
      ok: false,
      status: billing.error === "Insufficient LiTTBits" ? 402 : 503,
      error: billing.error === "Insufficient LiTTBits" ? billing.error : "Billing service unavailable",
    };
  }
  return { ok: true, result };
}
