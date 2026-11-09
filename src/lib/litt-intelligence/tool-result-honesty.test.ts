// @vitest-environment node
import { describe, it, expect } from "vitest";

/**
 * Chat browser as first-class capability — truthful failure narration.
 *
 * Contract (k): a failed browser tool call must never be silently
 * claimed as a success. Two surfaces carry the truth:
 *   1. Model-facing: the tool-result message fed back to the model
 *      reads `Error: <reason>` (buildToolResultMessage).
 *   2. User-facing: the chat progress list shows a red dot plus a
 *      summary that names the failure (summarizeToolResult).
 *
 * These tests pin both, using a failed browser.download payload as
 * the representative case.
 */

import {
  buildToolResultMessage,
  summarizeToolResult,
  type ToolCallResult,
} from "./llm-tool-calling";
import { describeBrowserAction } from "./browser-approval";

function failedDownloadResult(): ToolCallResult {
  return {
    toolCallId: "tc-1",
    toolId: "browser.download",
    result: { success: false, error: "No download started: timeout waiting for download event", durationMs: 0 },
    success: false,
    error: "No download started: timeout waiting for download event",
  };
}

describe("failed browser tool calls are narrated truthfully", () => {
  it("buildToolResultMessage turns a failure into `Error: <reason>` for the model", () => {
    const msg = buildToolResultMessage(failedDownloadResult());
    expect(msg.role).toBe("tool");
    expect(msg.content).toContain("Error:");
    expect(msg.content).toContain("No download started");
    expect(msg.content).not.toContain('"success":true');
  });

  it("buildToolResultMessage keeps success payloads as data", () => {
    const msg = buildToolResultMessage({
      toolCallId: "tc-2",
      toolId: "browser.download",
      result: { success: true, data: { filename: "report.pdf", bytes: 1234 } },
      success: true,
    });
    expect(msg.content).toContain("report.pdf");
    expect(msg.content).not.toContain("Error:");
  });

  it("summarizeToolResult names the failure for the chat progress list", () => {
    const summary = summarizeToolResult("browser.download", failedDownloadResult().result);
    expect(summary.startsWith("Failed:")).toBe(true);
    expect(summary).toContain("No download started");
  });

  it("summarizeToolResult does not relabel successful payloads", () => {
    const summary = summarizeToolResult("browser.download", {
      success: true,
      data: { filename: "report.pdf", bytes: 1234 },
    });
    expect(summary.startsWith("Failed:")).toBe(false);
  });

  it("summarizeToolResult passes plain strings through", () => {
    expect(summarizeToolResult("browser.snapshot", "ok")).toBe("ok");
  });

  it("the approval card names a download action and its target", () => {
    const text = describeBrowserAction(
      "browser.download",
      { url: "https://example.com/report.pdf", filename: "report.pdf" },
      "https://example.com/files",
    );
    expect(text).toContain("Download");
    expect(text).toContain("report.pdf");
    expect(text).toContain("example.com");
  });
});

describe("image.generate save failures are narrated truthfully", () => {
  // Regression for the 2026-11-08 staging approval loop: provider
  // generation succeeded but the project auto-save failed, and the
  // summary was just the leading base64 of downloadUrl — the saveError
  // never reached progress events, prior_tool_calls, or the UI.
  const generatedButUnsaved = {
    success: true,
    providerId: "cloudflare",
    downloadUrl: `data:image/png;base64,${"A".repeat(600_000)}`,
    savedToProject: false,
    saveError: "Image data is truncated or corrupt",
    insertHint: "call project.insert_asset with this downloadUrl",
  };

  it("summarizeToolResult names the project save failure, not the base64 blob", () => {
    const summary = summarizeToolResult("image.generate", generatedButUnsaved);
    expect(summary).toContain("save failed");
    expect(summary).toContain("truncated or corrupt");
    expect(summary).not.toContain("base64");
    expect(summary.length).toBeLessThanOrEqual(200);
  });

  it("summarizeToolResult reports a successful project save cleanly", () => {
    const summary = summarizeToolResult("image.generate", {
      success: true,
      providerId: "cloudflare",
      downloadUrl: "data:image/jpeg;base64,AAAA",
      savedToProject: true,
      sitePath: "/assets/images/hero-abc123.jpeg",
    });
    expect(summary).toBe("Image generated and saved to project");
  });

  it("summarizeToolResult summarizes chat-context media without the data URL", () => {
    const summary = summarizeToolResult("image.generate", {
      success: true,
      providerId: "cloudflare",
      downloadUrl: "data:image/jpeg;base64,AAAA",
      markdown: "![x](data:image/jpeg;base64,AAAA)",
    });
    expect(summary).toBe("Media generated via cloudflare");
  });
});
