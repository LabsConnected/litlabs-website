import { describe, it, expect, beforeAll } from "vitest";

import { registerInternalTools, toolRegistry } from "./tool-registry";
import { validateToolCallArgs } from "@litt/agent-core";

// ─── Regression: server-injected args must not be model-required ─────────
//
// Confirmed defect (e2e-live 2026-10-31): a local small model emitted
// browser.type without `sessionId`/`userId` — values only the server can
// know (the live session is provisioned server-side; userId is injected
// from the action context). The call died at argument validation as
// tool_call_parse_failed, cooled the model down, and killed the run.
// These args stay in `properties` (a supplied sessionId still flows
// through) but can no longer be REQUIRED of the model.

beforeAll(() => {
  registerInternalTools();
});

describe("browser.* tool schemas — injected args are not required", () => {
  const browserIds = toolRegistry
    .list()
    .map((t) => t.id)
    .filter((id) => id.startsWith("browser."));

  it("registers browser tools", () => {
    expect(browserIds.length).toBeGreaterThan(5);
  });

  it("no browser.* tool requires sessionId or userId from the model", () => {
    for (const id of browserIds) {
      const def = toolRegistry.get(id)!;
      const required = (def.inputSchema.required ?? []) as string[];
      expect(required, `${id} must not require sessionId`).not.toContain("sessionId");
      expect(required, `${id} must not require userId`).not.toContain("userId");
    }
  });

  it("browser.type validates without sessionId/userId (session injected at execute)", () => {
    const def = toolRegistry.get("browser.type")!;
    const err = validateToolCallArgs(
      "browser.type",
      { selector: "#cta", value: "hello" },
      [def],
    );
    // selector/text are the model-owned args — injection fills the rest.
    expect(err).toBeNull();
  });
});
