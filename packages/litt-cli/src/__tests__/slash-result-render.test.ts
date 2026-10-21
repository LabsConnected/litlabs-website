/**
 * P0 regression — silent slash-command disappearance.
 *
 * Root cause confirmed by code trace: the cockpit slash handler
 * (controller.ts SLASH_MAP dispatch) executed the tool and updated
 * holo state, but NEVER rendered result.message for non-shell tools.
 * project.run results are visible because CommandExecutor emits
 * stream events → transcript; android.* and dex.* handlers return a
 * bare ToolResult — no stream, no render → input cleared, nothing
 * appeared.
 *
 * These tests pin the rendering contract: a non-shell tool result —
 * success OR failure — must produce a visible transcript entry.
 */

import { describe, it, expect } from "vitest";
import { renderSlashToolResult, type SlashRenderStore } from "../lib/slash-result-render.js";
import type { ToolResult } from "@litt/agent-core";

function makeStore() {
  const chat: Array<{ role: string; content: string; status: string }> = [];
  const activity: Array<{ type: string; text: string }> = [];
  const store: SlashRenderStore = {
    addChatMessage: (m) => { chat.push({ role: m.role, content: m.content, status: m.status }); },
    addActivity: (a) => { activity.push({ type: a.type, text: a.text }); },
  };
  return { store, chat, activity };
}

function result(partial: Partial<ToolResult>): ToolResult {
  return {
    status: "success", success: true, message: "",
    durationMs: 5, ...partial,
  } as ToolResult;
}

describe("renderSlashToolResult", () => {
  it("renders android.devices success into the transcript", () => {
    const { store, chat, activity } = makeStore();
    const rendered = renderSlashToolResult(store, "android.devices", result({
      message: "1 device(s) attached (1 authorized+ready)",
    }));
    expect(rendered).toBe(true);
    expect(chat).toHaveLength(1);
    expect(chat[0].content).toContain("authorized+ready");
    expect(chat[0].status).toBe("complete");
    expect(activity[0].type).toBe("info");
  });
  it("renders a FAILED non-shell result as a visible error — never silent", () => {
    const { store, chat, activity } = makeStore();
    renderSlashToolResult(store, "dex.status", result({
      success: false, status: "failed",
      message: "Dex link DOWN — Connection refused",
    }));
    expect(chat[0].status).toBe("error");
    expect(chat[0].content).toContain("Dex link DOWN");
    expect(activity[0].type).toBe("error");
  });
  it("renders a fallback when a tool returns success with empty message", () => {
    const { store, chat } = makeStore();
    renderSlashToolResult(store, "android.tap", result({ message: "  " }));
    expect(chat[0].content).toContain("android.tap completed");
  });
  it("NEVER double-renders project.run — its output streams via executor events", () => {
    const { store, chat, activity } = makeStore();
    const rendered = renderSlashToolResult(store, "project.run", result({ message: "x" }));
    expect(rendered).toBe(false);
    expect(chat).toHaveLength(0);
    expect(activity).toHaveLength(0);
  });
  it("denial results (rejected approval) render as errors, not silence", () => {
    const { store, chat } = makeStore();
    renderSlashToolResult(store, "android.key", result({
      success: false, status: "failed",
      message: "Approval denied or not available",
    }));
    expect(chat[0].status).toBe("error");
    expect(chat[0].content).toContain("denied");
  });
});
