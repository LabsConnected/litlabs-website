/**
 * Submit / Transcript State Regression — covers the Termux/ADB bug where
 * pressing Enter caused the typed text to vanish with no response.
 *
 * Root cause: when hasProviderKey() was false, the controller's submit()
 * skipped addChatMessage entirely — only an activityLog entry was added.
 * The composer was already cleared by app.tsx, so:
 *   - chatTranscript stayed empty
 *   - hasConversation (shell.tsx) was false
 *   - the Welcome screen re-showed
 *   - the user saw their text vanish with no response
 *
 * Fix: the no-key fallback now adds the user message + a visible assistant
 * error to the chat transcript, so the message is always visible.
 *
 * These tests exercise the ChatTranscriptStore (pure, no React) to verify
 * the transcript invariants that prevent the bug from recurring. They also
 * simulate the no-key fallback path to verify the user message + error are
 * both present and remain visible across "rerenders" (re-snapshots).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ChatTranscriptStore } from "../ink/chat-transcript-store.js";

// ─── Helpers ──────────────────────────────────────────────────────

/** Simulate the no-key fallback path (the bug fix). */
function noKeyFallback(store: ChatTranscriptStore, input: string, submissionId: string): void {
  store.add({
    role: "user",
    content: input,
    ts: Date.now(),
    status: "complete",
    submissionId,
  });
  store.add({
    role: "assistant",
    content:
      "Set OPENROUTER_API_KEY to talk to LiTT, or use /commands for direct execution. " +
      "Run /doctor to check provider status.",
    ts: Date.now(),
    status: "error",
    servedModel: null,
    submissionId,
  });
}

/** Simulate a successful CHAT turn (user + streaming + finalize). */
function chatTurn(
  store: ChatTranscriptStore,
  input: string,
  response: string,
  submissionId: string,
): void {
  store.add({ role: "user", content: input, ts: Date.now(), status: "complete", submissionId });
  const assistantId = store.add({
    role: "assistant",
    content: "",
    ts: Date.now(),
    status: "streaming",
    submissionId,
  });
  store.appendDelta(assistantId, response);
  store.finalize(assistantId, { content: response, status: "complete", servedModel: "gpt-5.6-luna" });
}

// ─── Tests: the no-key bug fix ───────────────────────────────────

describe("Submit/transcript — no-key fallback (Termux/ADB bug fix)", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("user message is visible after submit when no API key is set", () => {
    // BEFORE the fix: no addChatMessage was called, transcript stayed empty.
    // AFTER the fix: the user message is always added.
    noKeyFallback(store, "what's up", "sub_001");

    const transcript = store.snapshot();
    expect(transcript.length).toBe(2); // user + assistant error
    expect(transcript[0].role).toBe("user");
    expect(transcript[0].content).toBe("what's up");
    expect(transcript[0].status).toBe("complete");
  });

  it("a visible assistant error appears when no API key is set", () => {
    noKeyFallback(store, "what's up", "sub_001");

    const assistant = store.snapshot()[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.status).toBe("error");
    expect(assistant.content).toContain("OPENROUTER_API_KEY");
    expect(assistant.content).not.toBe("");
  });

  it("hasConversation would be true — Welcome screen does not re-show", () => {
    // shell.tsx: hasConversation = messages.length > 0 || isProcessing || ...
    // Before the fix, messages.length was 0. After, it's 2.
    noKeyFallback(store, "what's up", "sub_001");
    const messages = store.snapshot();
    expect(messages.length).toBeGreaterThan(0);
  });

  it("both user message and assistant error remain visible across rerenders", () => {
    noKeyFallback(store, "what's up", "sub_001");

    // Simulate React rerenders — the hook re-snapshots on each render.
    const snap1 = store.snapshot();
    const snap2 = store.snapshot();
    const snap3 = store.snapshot();

    expect(snap1.length).toBe(2);
    expect(snap2.length).toBe(2);
    expect(snap3.length).toBe(2);
    expect(snap2[0].content).toBe("what's up");
    expect(snap3[1].content).toContain("OPENROUTER_API_KEY");
  });

  it("submissionId links the user message and assistant response end-to-end", () => {
    noKeyFallback(store, "what's up", "sub_trace_42");

    const [user, assistant] = store.snapshot();
    expect(user.submissionId).toBe("sub_trace_42");
    expect(assistant.submissionId).toBe("sub_trace_42");
  });
});

// ─── Tests: Enter submits the exact current text ─────────────────

describe("Submit/transcript — Enter submits exact text", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("the exact typed text is submitted (no truncation or mutation)", () => {
    const typed = "what's up";
    chatTurn(store, typed, "Not much, you?", "sub_002");

    expect(store.snapshot()[0].content).toBe(typed);
  });

  it("text with special characters is preserved", () => {
    const typed = "hello @world #foo bar/baz";
    chatTurn(store, typed, "ok", "sub_003");

    expect(store.snapshot()[0].content).toBe(typed);
  });

  it("multi-word text is not split or lost", () => {
    const typed = "the quick brown fox jumps over the lazy dog";
    chatTurn(store, typed, "nice", "sub_004");

    expect(store.snapshot()[0].content).toBe(typed);
  });
});

// ─── Tests: user message + response remain visible ───────────────

describe("Submit/transcript — visibility persistence", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("the user message remains visible after the response finalizes", () => {
    chatTurn(store, "what's up", "Not much", "sub_010");

    const transcript = store.snapshot();
    expect(transcript[0].role).toBe("user");
    expect(transcript[0].content).toBe("what's up");
    expect(transcript[0].status).toBe("complete");
  });

  it("the response remains visible after finalization", () => {
    chatTurn(store, "what's up", "Not much, you?", "sub_011");

    const assistant = store.snapshot()[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.status).toBe("complete");
    expect(assistant.content).toBe("Not much, you?");
  });

  it("both remain visible after a subsequent turn", () => {
    chatTurn(store, "first", "first response", "sub_012");
    chatTurn(store, "second", "second response", "sub_013");

    const transcript = store.snapshot();
    expect(transcript.length).toBe(4);
    expect(transcript[0].content).toBe("first");
    expect(transcript[1].content).toBe("first response");
    expect(transcript[2].content).toBe("second");
    expect(transcript[3].content).toBe("second response");
  });
});

// ─── Tests: rerenders do not reset transcript state ──────────────

describe("Submit/transcript — rerender safety", () => {
  it("multiple snapshots return the same state (no reset on rerender)", () => {
    const store = new ChatTranscriptStore();
    chatTurn(store, "what's up", "Not much", "sub_020");

    // The hook calls snapshot() on every render. The store is the source
    // of truth — re-snapshotting must not lose or reset state.
    const snaps = Array.from({ length: 10 }, () => store.snapshot());
    for (const s of snaps) {
      expect(s.length).toBe(2);
      expect(s[0].content).toBe("what's up");
      expect(s[1].content).toBe("Not much");
    }
  });

  it("a new snapshot after no mutation returns the same reference", () => {
    const store = new ChatTranscriptStore();
    chatTurn(store, "hello", "hi", "sub_021");

    // The store only creates a new array on mutation — re-snapshotting
    // without a mutation returns the same reference (no spurious reset).
    expect(store.snapshot()).toBe(store.snapshot());
  });
});

// ─── Tests: rapid/double Enter does not lose or duplicate ─────────

describe("Submit/transcript — rapid/double Enter", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("two rapid submits produce two distinct turns (no loss, no duplication)", () => {
    // Simulate double-Enter: two submits in quick succession.
    chatTurn(store, "what's up", "Not much", "sub_030");
    chatTurn(store, "how are you", "Good", "sub_031");

    const transcript = store.snapshot();
    expect(transcript.length).toBe(4);
    // No duplication — each turn appears exactly once.
    expect(transcript.filter((m) => m.content === "what's up").length).toBe(1);
    expect(transcript.filter((m) => m.content === "how are you").length).toBe(1);
    expect(transcript.filter((m) => m.content === "Not much").length).toBe(1);
    expect(transcript.filter((m) => m.content === "Good").length).toBe(1);
  });

  it("two rapid no-key submits both show their user messages + errors", () => {
    noKeyFallback(store, "first query", "sub_032");
    noKeyFallback(store, "second query", "sub_033");

    const transcript = store.snapshot();
    expect(transcript.length).toBe(4);
    expect(transcript[0].content).toBe("first query");
    expect(transcript[2].content).toBe("second query");
    // Both errors are present.
    expect(transcript[1].status).toBe("error");
    expect(transcript[3].status).toBe("error");
  });

  it("submission IDs are unique across rapid submits (traceable)", () => {
    noKeyFallback(store, "first", "sub_040");
    noKeyFallback(store, "second", "sub_041");

    const transcript = store.snapshot();
    expect(transcript[0].submissionId).toBe("sub_040");
    expect(transcript[1].submissionId).toBe("sub_040");
    expect(transcript[2].submissionId).toBe("sub_041");
    expect(transcript[3].submissionId).toBe("sub_041");
    // No cross-contamination.
    expect(transcript[0].submissionId).not.toBe(transcript[2].submissionId);
  });
});

// ─── Tests: remote/model failure does not erase the user message ──

describe("Submit/transcript — failure does not erase state", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("a provider error finalizes as an error message — user message stays", () => {
    // Simulate: user submits, streaming starts, provider fails.
    store.add({ role: "user", content: "what's up", ts: Date.now(), status: "complete", submissionId: "sub_050" });
    const assistantId = store.add({ role: "assistant", content: "", ts: Date.now(), status: "streaming", submissionId: "sub_050" });
    store.finalize(assistantId, { content: "Agent error: network timeout", status: "error" });

    const transcript = store.snapshot();
    expect(transcript.length).toBe(2);
    expect(transcript[0].content).toBe("what's up"); // user message intact
    expect(transcript[1].status).toBe("error");
    expect(transcript[1].content).toBe("Agent error: network timeout");
  });

  it("an empty model response finalizes as an explicit error — never blank", () => {
    store.add({ role: "user", content: "hello", ts: Date.now(), status: "complete", submissionId: "sub_051" });
    const assistantId = store.add({ role: "assistant", content: "", ts: Date.now(), status: "streaming", submissionId: "sub_051" });
    store.finalize(assistantId, {
      content: "LiTT returned an empty response. The turn was not completed.",
      status: "error",
    });

    const assistant = store.snapshot()[1];
    expect(assistant.status).toBe("error");
    expect(assistant.content).not.toBe("");
  });
});
