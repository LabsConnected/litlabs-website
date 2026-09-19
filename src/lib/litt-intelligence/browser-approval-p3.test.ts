// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Agent Browser Phase 3 — in-chat approvals + cooperative control.
 *
 * - describeBrowserAction / describeBrowserTarget: the approval card names
 *   the exact action and target ("Click \"Buy now\" on example.com").
 * - Registry gate: mutating browser tools (click/type/select/scroll/press/
 *   upload) are blocked without explicit approval at the registry level,
 *   not just via the permission engine.
 * - Deny path: a rejected browser approval runs nothing and stops cleanly.
 * - Control ownership: agent actions during human_control are refused
 *   cleanly; returnControl hands the browser back to the agent.
 * - Takeover announcement: the exact sentence the agent says when it needs
 *   the human, and the matching guidance in the start_session description.
 */

vi.mock("./llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

vi.mock("./browser-tool-handlers", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    browserToolHandlers: {
      ...(original.browserToolHandlers as Record<string, unknown>),
      "browser.click": vi.fn(async () => ({
        success: true,
        data: { clicked: true },
        durationMs: 1,
      })),
    },
    getBrowserPageUrl: vi.fn(async () => null),
  };
});

import {
  describeBrowserAction,
  describeBrowserTarget,
  approvalReasonForBrowserAction,
  buildHumanTakeoverMessage,
  isMutatingBrowserTool,
  BROWSER_TAKEOVER_GUIDANCE,
} from "./browser-approval";
import { toolRegistry } from "./tool-registry";
import {
  __registerActiveSessionForTest,
  __resetActiveSessionsForTest,
  takeControl,
  returnControl,
  executeBrowserAction,
  getLiveSessionStatus,
  type BrowserSession,
} from "./browser-session-manager";
import { resumeAgentLoopV2, type ResumeInput } from "./agent-loop-v2";
import { buildAssistantToolCallMessage, type LLMMessage } from "./llm-tool-calling";
import { callLLMWithTools } from "./llm-tool-calling";
import { browserToolHandlers } from "./browser-tool-handlers";
import type { Stagehand } from "@browserbasehq/stagehand";
import type { WorkspaceTransport } from "./workspace-transport";

// ─── Action descriptions ───────────────────────────────────────────

describe("describeBrowserTarget", () => {
  it("prefers visible text over every other target signal", () => {
    expect(
      describeBrowserTarget({ text: "Buy now", selector: "#buy", x: 1, y: 2 }),
    ).toBe('"Buy now"');
  });

  it("falls back through aria-label, role, testId, selector, coordinates", () => {
    expect(describeBrowserTarget({ ariaLabel: "Search" })).toBe('"Search"');
    expect(describeBrowserTarget({ role: "button" })).toBe("the button");
    expect(describeBrowserTarget({ testId: "buy-btn" })).toBe(
      'the [data-testid="buy-btn"] element',
    );
    expect(describeBrowserTarget({ selector: "#buy" })).toBe(
      'the element "#buy"',
    );
    expect(describeBrowserTarget({ x: 120, y: 300 })).toBe(
      "the point (120, 300)",
    );
  });

  it("returns null when the inputs name no target", () => {
    expect(describeBrowserTarget({})).toBeNull();
    expect(describeBrowserTarget({ sessionId: "s", userId: "u" })).toBeNull();
  });
});

describe("describeBrowserAction", () => {
  it("describes a click with its target and site", () => {
    expect(
      describeBrowserAction(
        "browser.click",
        { text: "Buy now" },
        "https://example.com/checkout",
      ),
    ).toBe('Click "Buy now" on example.com');
  });

  it("describes typing, truncating the value", () => {
    expect(
      describeBrowserAction("browser.type", {
        ariaLabel: "Search",
        value: "lawn mowing prices",
      }),
    ).toBe('Type "lawn mowing prices" into "Search"');
  });

  it("never echoes values typed into password fields", () => {
    const desc = describeBrowserAction("browser.type", {
      ariaLabel: "Password",
      value: "s3cr3t-hunter2",
    });
    expect(desc).toContain("password field");
    expect(desc).toContain("value hidden");
    expect(desc).not.toContain("s3cr3t-hunter2");
  });

  it("describes select, scroll, press, and upload", () => {
    expect(
      describeBrowserAction("browser.select", {
        selector: "#country",
        label: "Canada",
      }),
    ).toBe('Select "Canada" in the element "#country"');
    expect(
      describeBrowserAction("browser.scroll", { direction: "down" }),
    ).toBe("Scroll down");
    expect(describeBrowserAction("browser.press", { key: "Enter" })).toBe(
      "Press the Enter key",
    );
    expect(
      describeBrowserAction("browser.upload", {
        selector: "#file",
        filePath: "/tmp/report.pdf",
      }),
    ).toBe('Upload "report.pdf" to the element "#file"');
  });

  it("omits the site when the page URL is unknown", () => {
    expect(describeBrowserAction("browser.click", { text: "Next" })).toBe(
      'Click "Next"',
    );
  });

  it("recognizes every mutating tool id", () => {
    for (const id of [
      "browser.click",
      "browser.type",
      "browser.select",
      "browser.scroll",
      "browser.press",
      "browser.upload",
    ]) {
      expect(isMutatingBrowserTool(id)).toBe(true);
    }
    expect(isMutatingBrowserTool("browser.navigate")).toBe(false);
    expect(isMutatingBrowserTool("browser.screenshot")).toBe(false);
  });
});

describe("approvalReasonForBrowserAction", () => {
  it("combines the action description with the permission reason", async () => {
    const reason = await approvalReasonForBrowserAction(
      "browser.click",
      { sessionId: "no-live-session", text: "Buy now" },
      "Mutation requires approval in ACT mode",
    );
    expect(reason).toBe(
      'Browser action: Click "Buy now". Mutation requires approval in ACT mode',
    );
  });
});

describe("buildHumanTakeoverMessage", () => {
  it("names the blocker and points at Take control / Resume", () => {
    const msg = buildHumanTakeoverMessage("this page needs a login");
    expect(msg).toContain("I need you to take over: this page needs a login.");
    expect(msg).toContain("Take control");
    expect(msg).toContain("Resume");
    expect(msg).toContain("I never see what you type");
  });
});

// ─── Registry approval gate ────────────────────────────────────────

describe("registry blocks mutating browser tools without approval", () => {
  const MUTATING = [
    "browser.click",
    "browser.type",
    "browser.select",
    "browser.scroll",
    "browser.press",
    "browser.upload",
  ] as const;

  it.each(MUTATING)("%s requires explicit approval", async (toolId) => {
    const def = toolRegistry.get(toolId);
    expect(def?.readOnly).toBe(false);

    const blocked = await toolRegistry.execute(
      toolId,
      { sessionId: "sess-1", userId: "user-1" },
      { hasApproval: false },
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toMatch(/explicit approval/i);
    }

    const check = toolRegistry.canExecute(toolId, { hasApproval: false });
    expect(check.can).toBe(false);
    expect(check.reason).toBe("Approval required");
  });

  it("read-only browser tools are not gated", () => {
    for (const toolId of [
      "browser.navigate",
      "browser.snapshot",
      "browser.screenshot",
      "browser.extract",
    ]) {
      expect(
        toolRegistry.canExecute(toolId, { hasApproval: false }).can,
      ).toBe(true);
    }
  });

  it("browser.start_session carries the human-takeover guidance", () => {
    const def = toolRegistry.get("browser.start_session");
    expect(def?.description).toContain("Take control");
    expect(def?.description).toContain("Resume");
    expect(def?.description).toContain("do NOT ask the user for credentials");
    // The module constant and the registry description must not drift.
    expect(def?.description).toContain(
      BROWSER_TAKEOVER_GUIDANCE.trim().slice(0, 60),
    );
  });
});

// ─── Deny path: rejected approval runs nothing ─────────────────────

function makeTransport() {
  return {
    workspaceId: "ws-test",
    userId: "u-test",
    workspaceRoot: "/tmp/test",
    projectId: "p-test",
    createCheckpointBeforeMutation: vi.fn(async () => null),
  } as unknown as WorkspaceTransport;
}

function makeBrowserPausedInput(
  overrides?: Partial<ResumeInput>,
): ResumeInput {
  const assistantMsg: LLMMessage = buildAssistantToolCallMessage(
    [
      {
        toolId: "browser.click",
        toolCallId: "tc-click-1",
        inputs: { sessionId: "sess-1", userId: "u-test", text: "Buy now" },
      },
    ],
    "Clicking the Buy now button.",
    undefined,
  );
  const pausedMessages: LLMMessage[] = [
    { role: "user", content: "Buy the thing on example.com" },
    assistantMsg,
  ];
  return {
    pausedMessages,
    toolId: "browser.click",
    toolCallId: "tc-click-1",
    inputs: { sessionId: "sess-1", userId: "u-test", text: "Buy now" },
    decision: "rejected",
    rejectionReason: "not now",
    config: {
      systemPrompt: "You are LiTT.",
      executionMode: "act",
      enableBuildFix: false,
    },
    stepsUsedBeforePause: 2,
    hadInterveningMutation: false,
    ...overrides,
  };
}

describe("deny path stops the browser task cleanly", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
    vi.mocked(callLLMWithTools).mockResolvedValue({
      text: "Understood — I won't click it.",
      toolCalls: [],
      finishReason: "stop",
      model: "test-model",
    });
    vi.mocked(
      browserToolHandlers["browser.click"] as unknown as ReturnType<typeof vi.fn>,
    ).mockClear();
  });

  it("a rejected browser.click never reaches the browser handler", async () => {
    const clickSpy = browserToolHandlers["browser.click"] as unknown as ReturnType<typeof vi.fn>;

    const result = await resumeAgentLoopV2(
      makeBrowserPausedInput(),
      makeTransport(),
    );

    expect(clickSpy).not.toHaveBeenCalled();
    // No successful browser mutation is recorded…
    expect(
      result.toolCalls.some((c) => c.toolId === "browser.click" && c.success),
    ).toBe(false);
    // …and the run settles instead of hanging or erroring.
    expect(result.cancelled).toBe(false);
    expect(result.pendingApproval).toBeUndefined();
  });
});

// ─── Cooperative control: human_control refusal + resume ───────────

function fakeSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const now = new Date().toISOString();
  return {
    id: `session-${Math.random().toString(36).slice(2)}`,
    userId: "owner_clerk_123",
    projectId: null,
    conversationId: "conv-abc",
    browserbaseSessionId: "bb-1",
    status: "active",
    controller: "agent",
    task: null,
    liveViewUrl: "https://www.browserbase.com/sessions/bb-1",
    error: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    ...overrides,
  };
}

describe("cooperative control ownership", () => {
  beforeEach(() => {
    __resetActiveSessionsForTest();
  });

  function registerActive(overrides: Partial<BrowserSession> = {}) {
    const session = fakeSession(overrides);
    __registerActiveSessionForTest({
      stagehand: {} as Stagehand,
      session,
      lastActivity: Date.now(),
    });
    return session;
  }

  it("agent actions during human_control are refused cleanly", async () => {
    const session = registerActive();
    await takeControl(session.id, session.userId);

    const fn = vi.fn(async () => ({
      success: true,
      durationMs: 1,
    }));
    const result = await executeBrowserAction(
      session.id,
      session.userId,
      "browser.click",
      { text: "Buy now" },
      fn,
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/human control/i);
    // The Stagehand function was never invoked — nothing drove the page.
    expect(fn).not.toHaveBeenCalled();
  });

  it("the status probe reports human control honestly (drives the chip)", async () => {
    const session = registerActive({ conversationId: "conv-chip" });
    await takeControl(session.id, session.userId);

    const status = await getLiveSessionStatus(session.userId, "conv-chip");
    expect(status.state).toBe("idle");
    expect(status.controller).toBe("human");
    expect(status.sessionStatus).toBe("human_control");
    expect(status.sessionId).toBe(session.id);
  });

  it("returnControl hands the browser back to the agent", async () => {
    const session = registerActive();
    await takeControl(session.id, session.userId);

    const returned = await returnControl(session.id, session.userId);
    expect(returned?.status).toBe("agent_control");
    expect(returned?.controller).toBe("agent");

    const fn = vi.fn(async () => ({
      success: true,
      data: { clicked: true },
      durationMs: 1,
    }));
    const result = await executeBrowserAction(
      session.id,
      session.userId,
      "browser.click",
      { text: "Buy now" },
      fn,
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
  });

  it("takeControl on an unknown session returns null (no phantom transfer)", async () => {
    const result = await takeControl("no-such-session", "owner_clerk_123");
    expect(result).toBeNull();
  });
});
