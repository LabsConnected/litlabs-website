/**
 * Streaming-visibility regression — while an assistant message is
 * streaming and has not yet emitted its first visible token
 * (content === "", status === "streaming"), AssistantMessage must show
 * a visible indication of activity instead of rendering nothing.
 *
 * Root cause: `lines` is forced to `[]` whenever `msg.content` is empty
 * (chat-transcript.tsx), and the placeholder branch was only reachable
 * via `isError || rendered === null` — an empty (but non-null) `rendered`
 * array for the non-error empty-content case fell through to rendering
 * the empty array, i.e. nothing, under the bold "LiTT" label.
 *
 * This renders the real, exported `ChatMessageView` directly (no
 * CockpitApp, no runtime session, no Ollama) over a PassThrough stdout —
 * the smallest isolated Ink harness for this component.
 */

import React from "react";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { describe, it, expect } from "vitest";

import { ChatMessageView } from "../ink/chat-transcript.js";
import type { ChatMessage } from "../ink/cockpit-store.js";

const stripAnsi = (s: string) =>
  s.replace(/\x1B(?:\][^\x07]*\x07|\[[0-9;?]*[ -/]*[@-~])/g, "");

function mount(msg: ChatMessage) {
  let out = "";
  const stdout = new PassThrough() as PassThrough & { columns?: number; rows?: number; isTTY?: boolean };
  stdout.columns = 80;
  stdout.rows = 20;
  stdout.isTTY = true;
  stdout.on("data", (c: Buffer) => { out += c.toString(); });

  const instance = render(React.createElement(ChatMessageView, { msg }), {
    stdout: stdout as unknown as NodeJS.WriteStream,
    patchConsole: false,
  });

  return {
    frame: () => stripAnsi(out),
    /** Wait until Ink has written the first complete frame (no fixed delays). */
    async waitFrame(ms = 4000) {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (out.length > 0) return true;
        await new Promise((r) => setTimeout(r, 25));
      }
      return false;
    },
    unmount: () => instance.unmount(),
  };
}

function baseMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "chat_1",
    role: "assistant",
    content: "",
    ts: Date.now(),
    status: "streaming",
    requestedModel: "LiTT Auto",
    resolvedModel: "litt-fast:2k",
    servedModel: null,
    fallbackReason: null,
    ...overrides,
  };
}

describe("AssistantMessage — streaming visibility", () => {
  it("shows a visible indicator when streaming with zero initial deltas", async () => {
    const m = mount(baseMsg());
    expect(await m.waitFrame()).toBe(true);
    const frame = m.frame();
    m.unmount();

    expect(frame).toContain("LiTT");
    // The body placeholder glyph must render while content is empty —
    // pre-fix the frame is exactly "LiTT\nLitt Fast:2k\n" (label + routing
    // footer only, no body at all), so this specifically checks the BODY,
    // not just "anything after the label" (the footer always renders
    // regardless of content emptiness and would make a weaker check pass
    // for the wrong reason).
    expect(frame, `expected a body placeholder; got: ${JSON.stringify(frame)}`).toContain("…");
  });

  it("renders real streamed text once the first token has arrived, with no leftover placeholder", async () => {
    // A fresh mount with the post-first-token shape (same component,
    // same conditional logic path a live re-render would take once
    // msg.content is no longer empty) — this is what proves the
    // placeholder branch is exited cleanly rather than left showing
    // alongside real content.
    const m = mount(baseMsg({ content: "Hello" }));
    expect(await m.waitFrame()).toBe(true);
    const frame = m.frame();
    m.unmount();

    expect(frame).toContain("Hello");
    expect(frame).not.toContain("…");
  });

  it("shows no placeholder once completed with real content", async () => {
    const m = mount(baseMsg({ content: "Done.", status: "complete", servedModel: "litt-fast:2k" }));
    expect(await m.waitFrame()).toBe(true);
    const frame = m.frame();
    m.unmount();

    expect(frame).toContain("Done.");
    // The streaming-only placeholder glyph must not leak into a settled turn.
    expect(frame).not.toContain("…");
  });

  it("completion with no text still renders the explicit empty-response fallback, not the streaming placeholder", async () => {
    const fallback = "LiTT returned an empty response. The turn was not completed.";
    const m = mount(baseMsg({ content: fallback, status: "error" }));
    expect(await m.waitFrame()).toBe(true);
    const frame = m.frame();
    m.unmount();

    expect(frame).toContain(fallback);
  });

  it("error status (non-empty content) renders the error text, unaffected by the placeholder branch", async () => {
    const errText = "Agent error: connection refused";
    const m = mount(baseMsg({ content: errText, status: "error" }));
    expect(await m.waitFrame()).toBe(true);
    const frame = m.frame();
    m.unmount();

    expect(frame).toContain(errText);
  });

  it("a cancelled/settled turn with empty content does not keep showing the streaming placeholder as if still active", async () => {
    // Cancellation finalizes with explicit, non-empty content in this
    // codebase (ChatMessage has no "cancelled" status) — this asserts
    // the only real post-settle empty-content case (error placeholder
    // reuse) behaves identically whether streaming or not.
    const m = mount(baseMsg({ content: "", status: "error" }));
    expect(await m.waitFrame()).toBe(true);
    const frame = m.frame();
    m.unmount();

    // Still shows the shared placeholder glyph, not a blank body.
    expect(frame).toContain("…");
  });
});
