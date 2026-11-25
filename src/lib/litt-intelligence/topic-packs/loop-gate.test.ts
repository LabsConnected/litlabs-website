import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkspaceTransport } from "../workspace-transport";

/**
 * Loop-level pack gate (§4.3.3 + §4.6.1): with LITT_TOPIC_PACKS=1, a
 * site.compose call whose plan fails the selected pack's
 * completeness bar is refused at PRE-APPROVAL with the pack's own
 * error text — it never reaches the approval gate as a valid build.
 * The compose-readback suite proves the same harness stays pack-free
 * when the flag is off.
 */
vi.hoisted(() => {
  process.env.LITT_LOCAL_SMALL = "1";
  process.env.LITT_TOPIC_PACKS = "1";
});

vi.mock("../llm-tool-calling", async (importOriginal) => ({
  ...(await importOriginal() as Record<string, unknown>),
  callLLMWithTools: vi.fn(),
}));

import { runAgentLoopV2 } from "../agent-loop-v2";
import { callLLMWithTools } from "../llm-tool-calling";

const fakeTransport = {
  workspaceId: "ws-test",
  userId: "u-test",
  workspaceRoot: "/tmp/test",
  projectId: "p-test",
  createCheckpointBeforeMutation: vi.fn().mockResolvedValue(null),
  readFile: vi.fn(async () => {
    throw new Error("404 not found");
  }),
  writeFile: vi.fn(async () => ({ saved: true })),
  listFiles: vi.fn(async () => ({ entries: [] })),
} as unknown as WorkspaceTransport;

const THIN_COFFEE_PLAN = {
  title: "Harbor Lights Coffee",
  hero: { heading: "Harbor Lights Coffee", subheading: "Fresh coffee by the pier", cta: "See the menu", image: "coffee shop" },
  sections: [
    { kind: "features", heading: "Menu", items: [{ title: "Classic Latte", text: "$4.50", icon: "cup" }] },
    { kind: "footer", text: "Open 7 AM to 6 PM" },
  ],
};

describe("runAgentLoopV2 — topic pack gate (flag on)", () => {
  beforeEach(() => {
    vi.mocked(callLLMWithTools).mockReset();
  });

  it("refuses a pack-incomplete compose pre-approval with the pack's errors", async () => {
    vi.mocked(callLLMWithTools)
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ toolCallId: "tc-1", toolId: "site.compose", inputs: THIN_COFFEE_PLAN }],
        finishReason: "tool_calls",
        model: "test-model",
      })
      .mockResolvedValueOnce({ text: "Done.", toolCalls: [], finishReason: "stop", model: "test-model" });

    const result = await runAgentLoopV2("build a coffee shop page", fakeTransport, {
      model: "test-model",
      systemPrompt: "You are LiTT.",
    });

    // The call was refused with feedback — it never paused for
    // approval as a valid build, and the feedback fed back to the
    // model names the pack and its missing pieces.
    expect(result.pendingApproval).toBeUndefined();
    const call = result.toolCalls.find((t) => t.toolId === "site.compose");
    expect(call).toBeDefined();
    expect(call!.success).toBe(false);
    const secondCallArgs = vi.mocked(callLLMWithTools).mock.calls[1];
    expect(JSON.stringify(secondCallArgs)).toContain("restaurant-food pack:");
    expect(JSON.stringify(secondCallArgs)).toContain("missing required");
  });
});
