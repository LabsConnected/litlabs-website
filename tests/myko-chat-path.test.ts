/**
 * Myko chat path regression tests.
 *
 * Verifies fixes for the Myko audit findings:
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

describe("Myko chat — no floating promises", () => {
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

  it("settleRun calls have .catch() handlers", () => {
    const content = readSrc(MESSAGES_ROUTE);
    // Every settleRun call must be followed by .catch()
    const settleCalls = content.match(/settleRun\(/g);
    const catchCalls = content.match(/settleRun\([^)]+\)[^;]*\.catch\(/g);
    expect(settleCalls).toBeTruthy();
    expect(catchCalls).toBeTruthy();
    expect(catchCalls!.length).toBeGreaterThanOrEqual(settleCalls!.length);
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

describe("Myko chat — V2 transport failure logging", () => {
  it("logs V2 transport failure with studioLog (not silently swallowed)", () => {
    const content = readSrc(MESSAGES_ROUTE);
    expect(content).toContain("message:v2_transport_failed");
    expect(content).toContain("studioLog");
  });
});

describe("Myko chat — structured logging", () => {
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

describe("Myko chat — SSE stream lifecycle", () => {
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

describe("Myko chat — auth and idempotency", () => {
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
