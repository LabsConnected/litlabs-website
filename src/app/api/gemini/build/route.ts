import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/lib/auth";
import { generateComponent, directorPlan, executorCode, type GeminiWrapperResult } from "@/lib/gemini";
import { assertSpendAuthorized } from "@/lib/metered-llm-call";
import { chargeLlmUsage } from "@/lib/llm-billing";

/**
 * POST /api/gemini/build
 * Body: { action: "generate-component"|"director-plan"|"executor-code", ...params }
 *
 * Billing (P0): pre-flight balance/entitlement gate BEFORE provider
 * execution, canonical metering on the provider call, and exactly one
 * wallet debit per logical action via chargeLlmUsage.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { action, ...params } = await req.json();

    // Pre-flight spend authorization — no provider call unless authorized
    // and funded. Runs once per request (not per wrapper call).
    const authz = await assertSpendAuthorized(userId);
    if (!authz.ok) {
      return NextResponse.json(
        { error: authz.error, code: authz.code },
        { status: authz.status },
      );
    }

    const callId = randomUUID();
    const metering = { clerkId: userId, feature: "gemini-build" };

    // Runs one wrapper with metering, then charges exactly once against the
    // wrapper's billable usage_event (retries never double-charge).
    async function billedCall(
      fn: (opts: { metering: typeof metering }) => Promise<GeminiWrapperResult>,
    ): Promise<GeminiWrapperResult> {
      const r = await fn({ metering });
      const billing = await chargeLlmUsage({
        clerkId: userId,
        provider: r.provider,
        model: r.model,
        promptTokens: r.usage?.prompt ?? 0,
        completionTokens: r.usage?.completion ?? 0,
        isByok: false,
        callId,
        meteringBillableKey: r.metering.billableIdempotencyKey,
      });
      if (billing.error === "Insufficient LiTTBits") {
        throw new Error("Insufficient LiTTBits");
      }
      return r;
    }

    switch (action) {
      case "generate-component": {
        const { description, existingCode } = params;
        if (!description) return NextResponse.json({ error: "description required" }, { status: 400 });
        const r = await billedCall((opts) => generateComponent(description, existingCode, opts));
        return NextResponse.json({ code: r.text });
      }

      case "director-plan": {
        const { backlog, completed, projectContext } = params;
        const r = await billedCall((opts) => directorPlan(backlog || "", completed || "", projectContext || "", opts));
        try {
          const parsed = JSON.parse(r.text);
          return NextResponse.json({ plan: parsed });
        } catch {
          return NextResponse.json({ plan: r.text, raw: true });
        }
      }

      case "executor-code": {
        const { instructions, targetFile, existingCode, errorLogs } = params;
        if (!instructions || !targetFile) return NextResponse.json({ error: "instructions and targetFile required" }, { status: 400 });
        const r = await billedCall((opts) => executorCode(instructions, targetFile, existingCode, errorLogs, opts));
        return NextResponse.json({ code: r.text });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = msg === "Insufficient LiTTBits" ? 402 : 502;
    return NextResponse.json({ error: status === 402 ? msg : `Build error: ${msg}`, ...(status === 402 ? { code: "insufficient_credits" } : {}) }, { status });
  }
}
