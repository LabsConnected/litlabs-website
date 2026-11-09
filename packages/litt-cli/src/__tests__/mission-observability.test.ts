import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionEventBridge } from "../ink/session-event-bridge.js";
import {
  toolInvocationDetail,
  toolInvocationFullText,
} from "../ink/event-bridge.js";
import {
  resolveMissionLocalModelRequest,
  MISSION_DEFAULT_LOCAL_MODEL,
} from "../lib/local-model-resolution.js";
import {
  verificationTimeoutFromEnv,
  missionTimeoutFromEnv,
} from "../lib/runtime-session.js";
import type { RuntimeEvent } from "@litt/agent-core";
import type { LifecycleEvent } from "../lib/runtime-client.js";
import type { LocalLaneStatus } from "../lib/local-lane.js";

/**
 * Mission observability hardening — the live feed must show REAL
 * execution detail: tool invocations with their actual arguments,
 * evidence collection, verification-gate results, and failure reasons.
 * These tests pin the event-mapping and model/timeout configuration
 * contracts that make that possible.
 */

function collect() {
  const bridge = new SessionEventBridge();
  const events: LifecycleEvent[] = [];
  bridge.subscribe((e) => events.push(e));
  return { bridge, events };
}

const LANE_WITH_TOOLS: LocalLaneStatus = {
  available: true,
  models: ["litt-fast:2k", "litt-coder:8k", "litt-tools:4k"],
  endpoint: "http://127.0.0.1:11434",
  reason: null,
};

describe("SessionEventBridge → mission observability events", () => {
  it("mission:evidence_recorded maps to mission.evidence", () => {
    const { bridge, events } = collect();
    bridge.onEvent({
      type: "litt_event",
      subtype: "mission:evidence_recorded",
      ts: Date.now(),
      runId: "run_1",
      data: {
        missionId: "m_1",
        evidenceId: "ev_1",
        type: "typecheck_result",
        stepId: "step_tc",
        success: true,
        summary: "tsc --noEmit exit 0",
      },
    } as RuntimeEvent);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("mission.evidence");
    expect(events[0]!.data.type).toBe("typecheck_result");
    expect(events[0]!.data.success).toBe(true);
  });

  it("verification_failed_repair maps to verification.repair with check detail", () => {
    const { bridge, events } = collect();
    bridge.onEvent({
      type: "litt_event",
      subtype: "verification_failed_repair",
      ts: Date.now(),
      runId: "run_1",
      data: {
        runId: "vrun_1",
        message: "Verification not proven: Missing required evidence: typecheck_result",
        failedChecks: [
          { id: "typecheck", status: "timeout", message: "exceeded 180000ms", stderr: "" },
        ],
      },
    } as RuntimeEvent);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("verification.repair");
    const checks = events[0]!.data.failedChecks as Array<Record<string, unknown>>;
    expect(checks[0]!.status).toBe("timeout");
    expect(String(events[0]!.data.message)).toContain("typecheck_result");
  });

  it("unrelated litt_event subtypes are still dropped", () => {
    const { bridge, events } = collect();
    bridge.onEvent({
      type: "litt_event",
      subtype: "some_future_subtype",
      ts: Date.now(),
      runId: "run_1",
      data: {},
    } as RuntimeEvent);
    expect(events).toHaveLength(0);
  });
});

describe("toolInvocationDetail — real arguments in the feed", () => {
  it("extracts command + args for shell-style tools", () => {
    expect(
      toolInvocationDetail({ inputs: { command: "pnpm", args: ["run", "test"] } }),
    ).toBe("pnpm run test");
  });

  it("extracts path/file/query targets", () => {
    expect(toolInvocationDetail({ inputs: { path: "src/app.ts" } })).toBe("src/app.ts");
    expect(toolInvocationDetail({ inputs: { query: "TODO" } })).toBe("query=TODO");
  });

  it("returns null when inputs are absent or empty", () => {
    expect(toolInvocationDetail({})).toBeNull();
    expect(toolInvocationDetail({ inputs: {} })).toBeNull();
    expect(toolInvocationDetail({ inputs: "nope" })).toBeNull();
  });

  it("fullText pretty-prints inputs for expandable detail", () => {
    const text = toolInvocationFullText({ inputs: { command: "pnpm", args: ["build"] } });
    expect(text).toContain('"command": "pnpm"');
    expect(toolInvocationFullText({})).toBeUndefined();
  });
});

describe("resolveMissionLocalModelRequest — mission lane default", () => {
  const savedEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.LITT_MISSION_MODEL;
    delete process.env.LITT_MODEL;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("defaults to litt-tools:4k when the daemon has it", () => {
    expect(resolveMissionLocalModelRequest(LANE_WITH_TOOLS, null)).toBe(
      MISSION_DEFAULT_LOCAL_MODEL,
    );
    expect(MISSION_DEFAULT_LOCAL_MODEL).toBe("ollama:litt-tools:4k");
  });

  it("falls back to normal resolution when litt-tools:4k is not installed", () => {
    const lane: LocalLaneStatus = { ...LANE_WITH_TOOLS, models: ["litt-coder:8k"] };
    // No explicit request → null → lane preference order applies.
    expect(resolveMissionLocalModelRequest(lane, null)).toBeNull();
  });

  it("LITT_MISSION_MODEL wins over everything", () => {
    process.env.LITT_MISSION_MODEL = "ollama:litt-fast:2k";
    process.env.LITT_MODEL = "ollama:litt-coder:8k";
    expect(resolveMissionLocalModelRequest(LANE_WITH_TOOLS, "ollama:litt-coder:3b")).toBe(
      "ollama:litt-fast:2k",
    );
  });

  it("LITT_MODEL env beats the lane default (explicit operator request)", () => {
    process.env.LITT_MODEL = "ollama:litt-coder:8k";
    expect(resolveMissionLocalModelRequest(LANE_WITH_TOOLS, null)).toBe(
      "ollama:litt-coder:8k",
    );
  });

  it("persisted ollama: selection is NOT used when tools default applies", () => {
    // The picker selection is the coding/general default; the mission
    // lane prefers its tool-tuned build unless env names a model.
    expect(resolveMissionLocalModelRequest(LANE_WITH_TOOLS, "ollama:litt-coder:8k")).toBe(
      MISSION_DEFAULT_LOCAL_MODEL,
    );
  });

  it("persisted selection applies when tools model absent and no env", () => {
    const lane: LocalLaneStatus = { ...LANE_WITH_TOOLS, models: ["litt-coder:8k"] };
    expect(resolveMissionLocalModelRequest(lane, "ollama:litt-coder:8k")).toBe(
      "ollama:litt-coder:8k",
    );
  });
});

describe("verificationTimeoutFromEnv — configurable gate timeout", () => {
  it("parses a valid LITT_VERIFICATION_TIMEOUT_MS", () => {
    expect(verificationTimeoutFromEnv({ LITT_VERIFICATION_TIMEOUT_MS: "300000" })).toBe(300_000);
  });

  it("returns undefined when unset or malformed", () => {
    expect(verificationTimeoutFromEnv({})).toBeUndefined();
    expect(verificationTimeoutFromEnv({ LITT_VERIFICATION_TIMEOUT_MS: "abc" })).toBeUndefined();
    expect(verificationTimeoutFromEnv({ LITT_VERIFICATION_TIMEOUT_MS: "" })).toBeUndefined();
  });

  it("rejects out-of-range values rather than clamping silently", () => {
    expect(verificationTimeoutFromEnv({ LITT_VERIFICATION_TIMEOUT_MS: "5000" })).toBeUndefined();
    expect(verificationTimeoutFromEnv({ LITT_VERIFICATION_TIMEOUT_MS: "99999999" })).toBeUndefined();
  });
});

describe("missionTimeoutFromEnv — total loop deadline", () => {
  it("parses a valid LITT_MISSION_TIMEOUT_MS", () => {
    expect(missionTimeoutFromEnv({ LITT_MISSION_TIMEOUT_MS: "900000" })).toBe(900_000);
  });

  it("defaults to 45min when unset — every mission terminates", () => {
    expect(missionTimeoutFromEnv({})).toBe(2_700_000);
  });

  it("falls back to the default on malformed or out-of-range values", () => {
    expect(missionTimeoutFromEnv({ LITT_MISSION_TIMEOUT_MS: "abc" })).toBe(2_700_000);
    expect(missionTimeoutFromEnv({ LITT_MISSION_TIMEOUT_MS: "30000" })).toBe(2_700_000);
    expect(missionTimeoutFromEnv({ LITT_MISSION_TIMEOUT_MS: "999999999" })).toBe(2_700_000);
  });
});
