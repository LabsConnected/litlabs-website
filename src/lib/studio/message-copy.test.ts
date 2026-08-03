import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  markdownToPlainText,
  extractCodeBlock,
  conversationToPlainText,
  conversationToMarkdown,
  copyToClipboard,
} from "./message-copy";
import type { ChatMessage } from "@/app/studio/stores/useStudioAgentStore";

describe("message-copy utilities", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("markdownToPlainText", () => {
    it("strips heading markers but keeps text", () => {
      expect(markdownToPlainText("## Hello World")).toBe("Hello World");
    });

    it("removes bold and italic markers", () => {
      expect(markdownToPlainText("**bold** and *italic*")).toBe("bold and italic");
    });

    it("converts links to just the link text", () => {
      expect(markdownToPlainText("[Click here](https://example.com)")).toBe("Click here");
    });

    it("preserves code block content verbatim", () => {
      const md = "Here is code:\n```ts\nconst x = 42;\n```\nDone.";
      const plain = markdownToPlainText(md);
      expect(plain).toContain("const x = 42;");
      expect(plain).not.toContain("```");
    });

    it("removes inline code backticks", () => {
      expect(markdownToPlainText("Use `npm install` to install")).toBe("Use npm install to install");
    });

    it("converts unordered list markers to bullets", () => {
      const md = "- First\n- Second\n- Third";
      const plain = markdownToPlainText(md);
      expect(plain).toContain("• First");
      expect(plain).toContain("• Second");
    });

    it("removes blockquote markers", () => {
      expect(markdownToPlainText("> This is a quote")).toBe("This is a quote");
    });

    it("preserves ordered list numbers", () => {
      const md = "1. First\n2. Second";
      const plain = markdownToPlainText(md);
      expect(plain).toContain("1. First");
      expect(plain).toContain("2. Second");
    });
  });

  describe("extractCodeBlock", () => {
    it("extracts the first code block", () => {
      const md = "Text\n```js\nconsole.log('hi');\n```\nMore";
      expect(extractCodeBlock(md)).toBe("console.log('hi');");
    });

    it("extracts a specific code block by index", () => {
      const md = "```js\nfirst\n```\n```py\nsecond\n```";
      expect(extractCodeBlock(md, 0)).toBe("first");
      expect(extractCodeBlock(md, 1)).toBe("second");
    });

    it("returns null when no code block exists", () => {
      expect(extractCodeBlock("just text")).toBeNull();
    });
  });

  describe("conversationToPlainText", () => {
    it("builds a plain text transcript with timestamps and speakers", () => {
      const messages: ChatMessage[] = [
        { id: "1", role: "user", content: "Hello **LiTT**", createdAt: 1700000000000 },
        { id: "2", role: "assistant", content: "Hi! Here is code:\n```ts\nconst x = 1;\n```", createdAt: 1700000001000 },
      ];
      const text = conversationToPlainText(messages, "LiTT");
      expect(text).toContain("You:");
      expect(text).toContain("LiTT:");
      expect(text).toContain("Hello LiTT");
      expect(text).toContain("const x = 1;");
      expect(text).not.toContain("```");
      expect(text).not.toContain("**");
    });

    it("skips messages with no content", () => {
      const messages: ChatMessage[] = [
        { id: "1", role: "user", content: "", createdAt: 0 },
        { id: "2", role: "assistant", content: "Hello", createdAt: 0 },
      ];
      const text = conversationToPlainText(messages);
      expect(text).not.toContain("You:");
      expect(text).toContain("LiTT:");
    });
  });

  describe("conversationToMarkdown", () => {
    it("builds a Markdown transcript preserving formatting", () => {
      const messages: ChatMessage[] = [
        { id: "1", role: "user", content: "Hello **LiTT**", createdAt: 1700000000000 },
        { id: "2", role: "assistant", content: "Hi! Here is code:\n```ts\nconst x = 1;\n```", createdAt: 1700000001000 },
      ];
      const md = conversationToMarkdown(messages, "LiTT");
      expect(md).toContain("# Conversation Export");
      expect(md).toContain("**You**");
      expect(md).toContain("**LiTT**");
      expect(md).toContain("Hello **LiTT**");
      expect(md).toContain("```ts");
      expect(md).toContain("const x = 1;");
    });
  });

  describe("copyToClipboard", () => {
    it("uses navigator.clipboard when available", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      const ok = await copyToClipboard("test text");
      expect(ok).toBe(true);
      expect(writeText).toHaveBeenCalledWith("test text");
    });

    it("falls back to execCommand when clipboard API is unavailable", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });
      const execCommand = vi.fn().mockReturnValue(true);
      document.execCommand = execCommand;
      const ok = await copyToClipboard("fallback text");
      expect(ok).toBe(true);
      expect(execCommand).toHaveBeenCalledWith("copy");
    });

    it("returns false when both methods fail", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
        configurable: true,
      });
      const execCommand = vi.fn(() => { throw new Error("not allowed"); });
      document.execCommand = execCommand;
      const ok = await copyToClipboard("test");
      expect(ok).toBe(false);
    });
  });
});
