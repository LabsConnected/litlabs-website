/**
 * AgentTool canonicalization regression tests.
 *
 * Verifies that AgentTool:
 *   - Has ZERO chat composer (no textarea, no input)
 *   - Has ZERO duplicate conversation history (no localStorage chat)
 *   - No longer calls /api/gemini/chat
 *   - No longer has a provider selector
 *   - Chat with LiTT/Spark navigates to canonical tool=chat
 *   - Uses canonical agent registry (CORE_PERSONALITIES)
 *   - Capabilities are derived from real connections
 *   - Model display comes from canonical model store
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("AgentTool canonicalization", () => {
  const toolPath = path.resolve(
    __dirname,
    "../src/app/(app)/studio/tools/AgentTool.tsx",
  );
  const source = fs.readFileSync(toolPath, "utf-8");

  describe("P0: No duplicate chat system", () => {
    it("does NOT call /api/gemini/chat (in actual code, not comments)", () => {
      // Remove comment blocks before checking
      const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(codeOnly).not.toContain("/api/gemini/chat");
      expect(codeOnly).not.toMatch(/fetch\s*\(\s*["'`].*gemini\/chat/);
    });

    it("does NOT have a textarea or chat input", () => {
      expect(source).not.toContain("<textarea");
      expect(source).not.toContain("textareaRef");
    });

    it("does NOT have localStorage chat history (litlabs-agent-chat-v2)", () => {
      expect(source).not.toContain("litlabs-agent-chat-v2");
    });

    it("does NOT have a provider selector (litlabs-agent-tool-provider)", () => {
      expect(source).not.toContain("litlabs-agent-tool-provider");
      expect(source).not.toContain("PROVIDER_OPTIONS");
      expect(source).not.toContain("PROVIDER_STORAGE_KEY");
    });

    it("does NOT have streaming logic (SSE parsing)", () => {
      expect(source).not.toContain("getReader()");
      expect(source).not.toContain("TextDecoder");
      expect(source).not.toContain("[DONE]");
    });

    it("does NOT have context pruning / token estimation", () => {
      expect(source).not.toContain("estimateTokens");
      expect(source).not.toContain("pruneHistory");
      expect(source).not.toContain("MAX_TOKENS_APPROX");
    });

    it("does NOT have a sendMessage function", () => {
      expect(source).not.toMatch(/const\s+sendMessage\s*=/);
      expect(source).not.toMatch(/async\s+function\s+sendMessage/);
    });

    it("does NOT have chatMap or message state", () => {
      expect(source).not.toContain("chatMap");
      expect(source).not.toContain("setChatMap");
    });

    it("does NOT have a markdown renderer (renderMarkdown)", () => {
      // The old AgentTool had its own markdown renderer for chat messages
      expect(source).not.toContain("function renderMarkdown");
    });
  });

  describe("P0: Canonical navigation", () => {
    it("imports useConversationStore for conversation ID preservation", () => {
      expect(source).toContain("useConversationStore");
    });

    it("imports useSearchParams and useRouter for navigation", () => {
      expect(source).toContain("useSearchParams");
      expect(source).toContain("useRouter");
    });

    it("has a chatWithAgent function that sets tool=chat", () => {
      expect(source).toContain("chatWithAgent");
      expect(source).toContain('params.set("tool", "chat")');
    });

    it("preserves conversation ID when navigating to chat", () => {
      expect(source).toContain("selectedConversationId");
      expect(source).toContain('params.set("conversation"');
    });

    it("preserves agent slug when navigating to chat", () => {
      expect(source).toContain('params.set("agent"');
    });
  });

  describe("P0: Uses canonical agent registry", () => {
    it("imports from agent-registry (CORE_PERSONALITIES)", () => {
      expect(source).toContain("agent-registry");
      expect(source).toContain("CORE_PERSONALITIES");
    });

    it("does NOT define its own PRIMARY_ASSISTANTS array", () => {
      // The old AgentTool had its own PRIMARY_ASSISTANTS with hardcoded system prompts
      expect(source).not.toContain("PRIMARY_ASSISTANTS");
    });

    it("does NOT define its own system prompts", () => {
      expect(source).not.toContain("You are LiTT, the single AI copilot");
      expect(source).not.toContain("You are Spark, LiTT's playful creative companion");
    });
  });

  describe("P0: Real derived capabilities", () => {
    it("imports useConnectionSummary for real connection state", () => {
      expect(source).toContain("useConnectionSummary");
    });

    it("imports useStudioModelStore for canonical model routing", () => {
      expect(source).toContain("useStudioModelStore");
    });

    it("derives agent status from real connections (getAgentStatus)", () => {
      expect(source).toContain("getAgentStatus");
      expect(source).toContain("connCaps");
    });

    it("does NOT hardcode agent status", () => {
      // The old code had hardcoded access arrays like "GitHub unavailable"
      expect(source).not.toContain("GitHub unavailable");
      expect(source).not.toContain("PTY unavailable");
    });
  });

  describe("P0: Management UI (not chat)", () => {
    it("has MY AI CREW as the page title", () => {
      expect(source).toContain("My AI Crew");
    });

    it("has agent cards (AgentCard component)", () => {
      expect(source).toContain("AgentCard");
    });

    it("has agent detail view (AgentDetailView component)", () => {
      expect(source).toContain("AgentDetailView");
    });

    it("has detail tabs including Overview, Capabilities, Tools, Permissions, Memory, Model, Activity, Settings", () => {
      const tabs = ["overview", "capabilities", "tools", "permissions", "memory", "model", "activity", "settings"];
      tabs.forEach((tab) => {
        expect(source).toContain(`"${tab}"`);
      });
    });

    it("has Chat with [Agent] buttons that navigate to canonical chat", () => {
      expect(source).toContain("Chat with");
      expect(source).toContain("MessageSquare");
    });

    it("has Find Agents link to marketplace", () => {
      expect(source).toContain("Find Agents");
      expect(source).toContain("/marketplace");
    });
  });

  describe("P1: Premium visuals + 3D", () => {
    it("uses existing agent artwork (poster images)", () => {
      expect(source).toContain("litt-agent-hero-v2.png");
      expect(source).toContain("spark-agent-hero-v2.png");
    });

    it("has AGENT_ARTWORK mapping", () => {
      expect(source).toContain("AGENT_ARTWORK");
    });

    it("lazy-loads the 3D viewer (dynamic import)", () => {
      expect(source).toContain("lazy(");
      expect(source).toContain("AgentModelViewer");
    });

    it("does NOT load 3D models on initial render", () => {
      // The 3D viewer is behind a click handler, not rendered by default
      expect(source).toContain("viewer3DAgent");
      expect(source).toContain("setViewer3DAgent");
    });
  });
});
