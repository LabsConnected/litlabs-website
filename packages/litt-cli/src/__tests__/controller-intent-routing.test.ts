/**
 * Controller intent routing — proves the TUI cockpit routes
 * "scan and see whats needed" to the MISSION path, not CHAT.
 *
 * The controller's submit() calls classifyIntent(input) at line 913.
 * If intent === "mission", it enters the mission lifecycle:
 *   - store.actions.startMission(input)
 *   - holoState("UNDERSTANDING")
 *   - maxRounds: 10
 *
 * If intent !== "mission", it enters the CHAT path:
 *   - maxRounds: 4
 *   - no mission lifecycle
 *
 * This test proves the routing decision at the classification boundary
 * the controller actually uses.
 */

import { describe, it, expect } from "vitest";
import { classifyIntent } from "../lib/intent.js";

describe("Controller intent routing — TUI cockpit path", () => {
  it("routes 'scan and see whats needed' to MISSION (not CHAT)", () => {
    // This is the exact input from the observed live failure.
    // The controller calls classifyIntent(input) at line 913 of controller.ts.
    // Before the fix, this returned "chat" → maxRounds: 4 → round exhaustion.
    // After the fix, this returns "mission" → maxRounds: 10 + planning + verification.
    const intent = classifyIntent("scan and see whats needed");
    expect(intent).toBe("mission");
  });

  it("routes 'scan the project' to MISSION", () => {
    expect(classifyIntent("scan the project")).toBe("mission");
  });

  it("routes 'audit the repo' to MISSION", () => {
    expect(classifyIntent("audit the repo")).toBe("mission");
  });

  it("routes 'diagnose this project' to MISSION", () => {
    expect(classifyIntent("diagnose this project")).toBe("mission");
  });

  // Speech-act protections must NOT regress — these are CHAT.
  it("preserves speech-act protection for 'say exactly: scan the project'", () => {
    expect(classifyIntent("say exactly: scan the project")).toBe("chat");
  });

  it("preserves info-act protection for 'explain what scan does'", () => {
    expect(classifyIntent("explain what scan does")).toBe("chat");
  });

  it("preserves speech-act protection for 'repeat: audit the repo'", () => {
    expect(classifyIntent("repeat: audit the repo")).toBe("chat");
  });
});
