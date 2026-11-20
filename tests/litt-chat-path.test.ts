/**
 * LiTT chat path regression tests.
 *
 * Verifies fixes for the chat path audit findings:
 * 1. No floating promises (void settleRun, void persistMemory, void harvestUserPreferences)
 * 2. V2 transport failure is logged (not silently swallowed)
 * 3. Structured logging uses studioLog (not console.log)
 * 4. No secrets/tokens/prompts/file contents in logs
 * 5. SSE stream closes properly (controller.close in finally)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf-8");
}

const MESSAGES_ROUTE = "src/app/api/studio/conversations/[conversationId]/messages/route.ts";
const LOGGER_PATH = "src/lib/studio/logger.ts";

describe("LiTT chat — no floating promises", () => {
  it("does not use 'void settleRun' (must use .catch() instead)", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).not.toContain("void settleRun");
  });

  it("does not use 'void persistMemory' (must use .catch() instead)", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).not.toContain("void persistMemory");
  });

  it("does not use 'void harvestUserPreferences' (must use .catch() instead)", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).not.toContain("void harvestUserPreferences");
  });

  it("settlement runs only through the awaited finishAgentBilling helper (no floating settleRun)", () => {
    const content = readSrc(MESSAGES_ROUTE);
    // Settlement must go through the finishAgentBilling helper, and every
    // call site must await it — a bare finishAgentBilling(...) call would be
    // a floating promise.
    const helperCalls = content.match(/finishAgentBilling\(/g) ?? [];
    const awaitedHelperCalls = content.match(/await finishAgentBilling\(/g) ?? [];
    expect(helperCalls.length).toBeGreaterThan(0);
    expect(awaitedHelperCalls.length).toBe(helperCalls.length);
    // The single direct settleRun( invocation lives inside that helper,
    // awaited within a try/catch that logs failures (never silently dropped).
    const settleCalls = content.match(/settleRun\(/g) ?? [];
    expect(settleCalls.length).toBe(1);
    expect(content).toMatch(/try \{\s*const outcome = await settleRun\(/);
    expect(content).toContain("message:billing_unconfirmed");
    expect(content).toContain("message:billing_settle_exception");
    // The old fire-and-forget shape must not come back: no settleRun(...).catch(...)
    // anywhere in the route (it would bypass the helper's failure logging).
    expect(content.match(/settleRun\([^)]+\)[^;]*\.catch\(/g)).toBeNull();
  });

  it("persistMemory calls have .catch() handlers", () => {
    const content = readSrc(MESSAGES_ROUTE);
    const persistCalls = content.match(/persistMemory\(/g);
    const catchCalls = content.match(/persistMemory\([^)]+\)[^;]*\.catch\(/g);
    // There should be .catch() on persistMemory calls (at least the ones in the route)
    if (persistCalls && persistCalls.length > 0) {
      expect(catchCalls).toBeTruthy();
    }
  });
});

describe("LiTT chat — V2 transport failure logging", () => {
  it("logs V2 transport failure with studioLog (not silently swallowed)", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).toContain("message:v2_transport_failed");
    expect(content).toContain("studioLog");
  });
});

describe("LiTT chat — structured logging", () => {
  it("uses studioLog for structured logging (not console.log)", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).toContain('import { studioLog }');
  });

  it("logger does not log tokens, secrets, prompts, or file contents", () => {
    const content = readSrc(LOGGER_PATH);
    // The LogContext interface must not have fields for secrets/tokens/prompts/contents
    expect(content).not.toMatch(/token|secret|password|prompt|content/i);
  });

  it("logger includes correlation fields (requestId, conversationId, projectId, userId)", () => {
    const content = readSrc(LOGGER_PATH);
    expect(content).toContain("requestId");
    expect(content).toContain("conversationId");
    expect(content).toContain("projectId");
    expect(content).toContain("userId");
  });

  it("logger includes errorClass field for error categorization", () => {
    const content = readSrc(LOGGER_PATH);
    expect(content).toContain("errorClass");
  });
});

describe("LiTT chat — SSE stream lifecycle", () => {
  it("SSE stream closes in finally block", () => {
    const content = readSrc(MESSAGES_ROUTE);
    // The finally block must close the controller
    expect(content).toContain("finally");
    expect(content).toContain("controller.close()");
  });

  it("emits done event at the end of the stream", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).toContain("[DONE]");
  });

  it("emits error event on LLM failure", () => {
    const content = readSrc(MESSAGES_ROUTE);
    // The error path must emit an error SSE event
    expect(content).toMatch(/type:\s*"error"/);
  });
});

describe("LiTT chat — auth and idempotency", () => {
  it("requires clientRequestId for idempotency", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).toContain("clientRequestId");
  });

  it("validates expectedRevision for optimistic concurrency", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).toContain("expectedRevision");
  });

  it("uses auth() for authentication", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).toMatch(/await auth\(/);
  });
});
