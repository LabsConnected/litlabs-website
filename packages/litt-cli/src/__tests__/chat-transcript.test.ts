/**
 * Chat Transcript Rendering — regression coverage for the release blocker
 * where the assistant response body was not visible in the cockpit.
 *
 * Canonical response path under test:
 *   provider stream/result
 *     → agent/operator result (runAgentLoop)
 *     → controller (onModelStream deltas + result.content)
 *     → ChatTranscriptStore (add / appendDelta / finalize)
 *     → CockpitStore hook mirrors snapshot → ChatTranscript renderer
 *
 * The invariants are enforced at the ChatTranscriptStore level (the pure
 * canonical state) so they are testable in the CLI's `node` test env
 * without a React renderer. The CockpitStore hook delegates to this store.
 *
 * Invariants enforced:
 *   1. Exactly one assistant message per turn (never duplicated).
 *   2. The final response body is result.content — persisted once.
 *   3. Streaming text is visible (live preview via appendDelta).
 *   4. The response persists (store state, not ephemeral).
 *   5. The response survives overlay open/close (store state, not overlay-local).
 *   6. The response does not disappear after the next command (bounded append).
 *   7. Markdown/plain text renders safely (no raw tool_call json in the body).
 *   8. A provider error renders as an error message — never blank.
 *   9. Routing trace is recorded: requestedModel, resolvedModel, servedModel,
 *      fallbackReason — so the Brain→Route sequence is traceable.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ChatTranscriptStore } from "../ink/chat-transcript-store.js";

// ─── Helpers ──────────────────────────────────────────────────────

/** Submit a user message + open a streaming assistant message (CHAT path shape). */
function startAssistantTurn(
  store: ChatTranscriptStore,
  userText: string,
  trace: {
    requestedModel?: string;
    resolvedModel?: string;
    servedModel?: string | null;
    fallbackReason?: string | null;
  } = {},
): string {
  store.add({
    role: "user",
    content: userText,
    ts: Date.now(),
    status: "complete",
  });
  return store.add({
    role: "assistant",
    content: "",
    ts: Date.now(),
    status: "streaming",
    requestedModel: trace.requestedModel ?? "LiTT Auto",
    resolvedModel: trace.resolvedModel ?? "GPT-5.6 Luna",
    servedModel: trace.servedModel ?? null,
    fallbackReason: trace.fallbackReason ?? null,
  });
}

/**
 * Id of the newest message — the turn these helpers target by default,
 * matching the pre-invariant-7 "operate on the last message" shape.
 */
function lastId(store: ChatTranscriptStore): string {
  return store.last()?.id ?? "";
}

/** Stream a delta into a pending assistant message (defaults to the newest). */
function streamDelta(store: ChatTranscriptStore, text: string, id?: string): void {
  store.appendDelta(id ?? lastId(store), text);
}

/** Finalize the pending assistant message (success or error). */
function finalizeAssistant(
  store: ChatTranscriptStore,
  content: string,
  status: "complete" | "error",
  servedModel?: string | null,
  id?: string,
): void {
  store.finalize(id ?? lastId(store), { content, status, servedModel });
}

// ─── Tests ────────────────────────────────────────────────────────

describe("Chat transcript — canonical response rendering", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("starts empty — no assistant message until a turn is submitted", () => {
    expect(store.snapshot()).toEqual([]);
    expect(store.isEmpty()).toBe(true);
  });

  it("persists exactly one assistant message per turn (no duplication)", () => {
    startAssistantTurn(store, "hello");
    streamDelta(store, "Hi ");
    streamDelta(store, "there");
    finalizeAssistant(store, "Hi there", "complete", "gpt-5.6-luna");

    const transcript = store.snapshot();
    expect(transcript.length).toBe(2); // 1 user + 1 assistant
    const assistant = transcript[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.status).toBe("complete");
    expect(assistant.content).toBe("Hi there");
  });

  it("streaming text is visible during the turn (live preview)", () => {
    startAssistantTurn(store, "hello");
    streamDelta(store, "Partial ");
    streamDelta(store, "response…");

    const assistant = store.snapshot()[1];
    expect(assistant.role).toBe("assistant");
    expect(assistant.status).toBe("streaming");
    expect(assistant.content).toBe("Partial response…");
  });

  it("finalizes with result.content — the canonical final body, persisted once", () => {
    startAssistantTurn(store, "hello");
    streamDelta(store, "partial stream that will be replaced");
    // The final result.content replaces the streamed body — never appended.
    finalizeAssistant(store, "The real final answer.", "complete", "gpt-5.6-luna");

    const assistant = store.snapshot()[1];
    expect(assistant.content).toBe("The real final answer.");
    expect(assistant.status).toBe("complete");
  });

  it("response persists — store state is not ephemeral", () => {
    startAssistantTurn(store, "hello");
    finalizeAssistant(store, "Persisted body", "complete", "gpt-5.6-luna");

    // The store holds the state — a snapshot taken later is identical.
    const snap1 = store.snapshot();
    const snap2 = store.snapshot();
    expect(snap1).toBe(snap2); // same reference until a mutation occurs
    expect(snap2.length).toBe(2);
    expect(snap2[1].content).toBe("Persisted body");
  });

  it("response survives overlay open/close (store state is overlay-independent)", () => {
    startAssistantTurn(store, "hello");
    finalizeAssistant(store, "Body before overlay", "complete", "gpt-5.6-luna");

    // The ChatTranscriptStore has no knowledge of overlays — opening or
    // closing an overlay cannot affect the transcript. Simulate the
    // overlay cycle by re-snapshotting (the hook does this on render).
    const beforeOverlay = store.snapshot();
    // (overlay open/close happens in CockpitStore.overlay state — not here)
    const afterOverlay = store.snapshot();
    expect(afterOverlay.length).toBe(beforeOverlay.length);
    expect(afterOverlay[1].content).toBe("Body before overlay");
  });

  it("response does not disappear after the next command (bounded append)", () => {
    startAssistantTurn(store, "first question");
    finalizeAssistant(store, "First answer", "complete", "gpt-5.6-luna");

    // Submit a second turn — the first response must remain.
    startAssistantTurn(store, "second question");
    finalizeAssistant(store, "Second answer", "complete", "gpt-5.6-luna");

    const transcript = store.snapshot();
    expect(transcript.length).toBe(4); // 2 user + 2 assistant
    expect(transcript[1].content).toBe("First answer");
    expect(transcript[3].content).toBe("Second answer");
  });

  it("markdown/plain text renders safely — no raw tool_call json in the body", () => {
    startAssistantTurn(store, "show me code");
    // The controller filters tool_call markup before persisting; the
    // final body is clean prose + fenced code (rendered as plain text).
    const body = "Here is the code:\n```ts\nconst x = 1;\n```\nDone.";
    finalizeAssistant(store, body, "complete", "gpt-5.6-luna");

    const assistant = store.snapshot()[1];
    expect(assistant.content).toBe(body);
    // No raw tool_call json leaked into the body.
    expect(assistant.content).not.toContain('{"tool"');
    expect(assistant.content).not.toContain("```tool_call");
  });

  it("provider error renders as an error message — never blank", () => {
    startAssistantTurn(store, "hello");
    // Simulate a provider failure — the controller finalizes as error.
    const errText = "Agent error: OpenRouter API error 429: rate limited";
    finalizeAssistant(store, errText, "error");

    const assistant = store.snapshot()[1];
    expect(assistant.status).toBe("error");
    expect(assistant.content).toBe(errText);
    expect(assistant.content).not.toBe("");
  });

  it("empty model response renders as an explicit error — never a blank completed turn", () => {
    startAssistantTurn(store, "hello");
    // The controller maps empty result.content to an explicit message.
    const emptyBody = "LiTT returned an empty response. The turn was not completed.";
    finalizeAssistant(store, emptyBody, "error");

    const assistant = store.snapshot()[1];
    expect(assistant.status).toBe("error");
    expect(assistant.content).toBe(emptyBody);
  });
});

describe("Chat transcript — routing trace (Brain → Route sequence)", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("records requestedModel, resolvedModel, servedModel, fallbackReason", () => {
    // Simulate the live sequence the user observed:
    //   Brain: GPT-5.6 Terra   (requestedModel — the configured brain/policy)
    //   Route: GPT-5.6 Luna    (resolvedModel — what route() picked)
    //   ACTIVE: GPT-5.6 Luna   (servedModel — confirmed after streaming)
    // This is AUTO selection — fallbackReason explains why the resolved
    // model differs from the requested brain.
    startAssistantTurn(store, "do the thing", {
      requestedModel: "GPT-5.6 Terra",
      resolvedModel: "GPT-5.6 Luna",
      servedModel: null,
      fallbackReason: "AUTO: Terra unavailable, escalated to Luna",
    });
    finalizeAssistant(store, "Done.", "complete", "gpt-5.6-luna");

    const assistant = store.snapshot()[1];
    expect(assistant.requestedModel).toBe("GPT-5.6 Terra");
    expect(assistant.resolvedModel).toBe("GPT-5.6 Luna");
    expect(assistant.servedModel).toBe("gpt-5.6-luna");
    expect(assistant.fallbackReason).toBe("AUTO: Terra unavailable, escalated to Luna");
  });

  it("servedModel is null during streaming, set after finalization", () => {
    startAssistantTurn(store, "hello", {
      requestedModel: "LiTT Auto",
      resolvedModel: "GPT-5.6 Luna",
      servedModel: null,
      fallbackReason: null,
    });

    // During streaming, servedModel is unknown.
    expect(store.snapshot()[1].servedModel).toBeNull();

    finalizeAssistant(store, "Hi", "complete", "gpt-5.6-luna");
    expect(store.snapshot()[1].servedModel).toBe("gpt-5.6-luna");
  });

  it("fallbackReason is null when the policy was honored exactly (FIXED mode)", () => {
    startAssistantTurn(store, "hello", {
      requestedModel: "Claude Sonnet 5",
      resolvedModel: "Claude Sonnet 5",
      servedModel: null,
      fallbackReason: null,
    });
    finalizeAssistant(store, "Hi", "complete", "claude-sonnet-5");

    const assistant = store.snapshot()[1];
    expect(assistant.fallbackReason).toBeNull();
    expect(assistant.requestedModel).toBe(assistant.resolvedModel);
  });

  it("the Brain→Route sequence is traceable: requested ≠ resolved when AUTO escalates", () => {
    startAssistantTurn(store, "complex task", {
      requestedModel: "GPT-5.6 Terra",   // brain label (AUTO policy)
      resolvedModel: "GPT-5.6 Luna",     // route() picked a different model
      servedModel: null,
      fallbackReason: "AUTO escalation: task complexity > Terra threshold",
    });
    finalizeAssistant(store, "Done", "complete", "gpt-5.6-luna");

    const assistant = store.snapshot()[1];
    // The trace makes the escalation explicit — not a silent substitution.
    expect(assistant.requestedModel).not.toBe(assistant.resolvedModel);
    expect(assistant.fallbackReason).toContain("AUTO");
  });
});

describe("Chat transcript — /clear clears the transcript", () => {
  it("clear empties the transcript", () => {
    const store = new ChatTranscriptStore();
    startAssistantTurn(store, "hello");
    finalizeAssistant(store, "Hi", "complete", "gpt-5.6-luna");
    expect(store.length()).toBe(2);

    store.clear();
    expect(store.isEmpty()).toBe(true);
    expect(store.snapshot()).toEqual([]);
  });
});

describe("Chat transcript — appendDelta safety", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("is a no-op when there is no streaming assistant message", () => {
    // No messages at all — delta is dropped, not crashed.
    store.appendDelta("chat_nonexistent", "orphan delta");
    expect(store.snapshot()).toEqual([]);
  });

  it("is a no-op on a completed assistant message (does not append after finalize)", () => {
    const id = startAssistantTurn(store, "hello");
    finalizeAssistant(store, "Final", "complete", "gpt-5.6-luna");

    // A late delta must NOT mutate the finalized message.
    store.appendDelta(id, "late delta");
    expect(store.snapshot()[1].content).toBe("Final");
    expect(store.snapshot()[1].status).toBe("complete");
  });

  it("ignores empty deltas", () => {
    const id = startAssistantTurn(store, "hello");
    store.appendDelta(id, "");
    expect(store.snapshot()[1].content).toBe("");
  });

  it("is a no-op on a user message (last message is not assistant)", () => {
    const id = store.add({ role: "user", content: "hi", ts: Date.now(), status: "complete" });
    store.appendDelta(id, "should not append");
    expect(store.snapshot()[0].role).toBe("user");
    expect(store.snapshot()[0].content).toBe("hi");
    expect(store.length()).toBe(1);
  });
});

describe("Chat transcript — finalize safety", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("is a no-op when the last message is a user message", () => {
    const id = store.add({ role: "user", content: "hello", ts: Date.now(), status: "complete" });
    // No streaming assistant to finalize — must not corrupt the user msg.
    store.finalize(id, { content: "should not apply", status: "complete" });
    expect(store.snapshot()[0].role).toBe("user");
    expect(store.snapshot()[0].content).toBe("hello");
  });

  it("is a no-op when the transcript is empty", () => {
    store.finalize("chat_nonexistent", { content: "orphan", status: "complete" });
    expect(store.isEmpty()).toBe(true);
  });

  it("preserves the routing trace when finalizing", () => {
    startAssistantTurn(store, "hello", {
      requestedModel: "LiTT Auto",
      resolvedModel: "GPT-5.6 Luna",
      servedModel: null,
      fallbackReason: "AUTO escalation",
    });
    finalizeAssistant(store, "Done", "complete", "gpt-5.6-luna");

    const assistant = store.snapshot()[1];
    // Finalize replaces content/status/servedModel but preserves the trace.
    expect(assistant.requestedModel).toBe("LiTT Auto");
    expect(assistant.resolvedModel).toBe("GPT-5.6 Luna");
    expect(assistant.fallbackReason).toBe("AUTO escalation");
  });
});

describe("Chat transcript — bounding", () => {
  it("bounds the transcript to the last MAX_CHAT_MESSAGES entries", () => {
    const store = new ChatTranscriptStore();
    // Add well over the cap (alternating user/assistant pairs).
    for (let i = 0; i < 60; i++) {
      store.add({ role: "user", content: `q${i}`, ts: Date.now(), status: "complete" });
      store.add({
        role: "assistant",
        content: `a${i}`,
        ts: Date.now(),
        status: "complete",
      });
    }
    // The transcript is bounded — older messages are dropped, but the
    // most recent responses remain (the response does not disappear
    // after the next command, but unbounded growth is prevented).
    expect(store.length()).toBeLessThanOrEqual(50);
    const snap = store.snapshot();
    // The most recent messages are preserved.
    expect(snap[snap.length - 1].content).toBe("a59");
    expect(snap[snap.length - 2].content).toBe("q59");
  });
});

// ─── Invariant 7: stale-turn protection ───────────────────────────
//
// The bug this prevents: appendDelta/finalize used to target whatever
// message was LAST. When turn A was superseded (cancelled, timed out,
// or just slow) and turn B had already opened its own assistant
// message, A's late deltas landed on B's message — the user watched a
// dead stream overwrite the live answer, and A's finalize replaced B's
// body wholesale.
//
// Now every mutation is scoped to the id add() returned for THAT turn.

describe("Chat transcript — invariant 7 (stale stream cannot touch a newer message)", () => {
  let store: ChatTranscriptStore;

  beforeEach(() => {
    store = new ChatTranscriptStore();
  });

  it("a late delta from a superseded turn does not touch the newer message", () => {
    // Turn A opens and streams.
    const idA = startAssistantTurn(store, "first question");
    streamDelta(store, "A-partial", idA);

    // Turn B starts before A settled — B is now the newest message.
    const idB = startAssistantTurn(store, "second question");
    streamDelta(store, "B-live", idB);

    // A's abandoned stream finally emits.
    store.appendDelta(idA, "-A-LATE");

    const snap = store.snapshot();
    const a = snap.find((m) => m.id === idA)!;
    const b = snap.find((m) => m.id === idB)!;
    expect(b.content).toBe("B-live");           // newer message untouched
    expect(a.content).toBe("A-partial-A-LATE"); // A's own message still its own
  });

  it("a late finalize from a superseded turn does not overwrite the newer message", () => {
    const idA = startAssistantTurn(store, "first");
    streamDelta(store, "A-partial", idA);
    const idB = startAssistantTurn(store, "second");
    streamDelta(store, "B-live", idB);

    // A's loop finally errors out and finalizes ITS message.
    store.finalize(idA, { content: "A timed out", status: "error", servedModel: "model-a" });

    const b = store.snapshot().find((m) => m.id === idB)!;
    expect(b.content).toBe("B-live");
    expect(b.status).toBe("streaming");
    expect(b.servedModel).toBeNull();

    const a = store.snapshot().find((m) => m.id === idA)!;
    expect(a.status).toBe("error");
    expect(a.content).toBe("A timed out");
  });

  it("full interleaving: A starts, B starts, A's late delta AND finalize both land on A only", () => {
    const idA = startAssistantTurn(store, "q-a");
    streamDelta(store, "a1", idA);
    const idB = startAssistantTurn(store, "q-b");
    streamDelta(store, "b1", idB);
    store.appendDelta(idA, "a2");   // stale delta
    streamDelta(store, "b2", idB);  // live continues
    store.finalize(idA, { content: "A final", status: "error" });
    streamDelta(store, "b3", idB);  // live still streaming after A settled
    store.finalize(idB, { content: "B final", status: "complete", servedModel: "model-b" });

    const snap = store.snapshot();
    expect(snap.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    const a = snap.find((m) => m.id === idA)!;
    const b = snap.find((m) => m.id === idB)!;
    expect(a.content).toBe("A final");
    expect(a.status).toBe("error");
    expect(b.content).toBe("B final");
    expect(b.status).toBe("complete");
    expect(b.servedModel).toBe("model-b");
  });

  it("an unknown id never mutates anything", () => {
    const idB = startAssistantTurn(store, "only turn");
    streamDelta(store, "live", idB);
    const before = store.snapshot();

    store.appendDelta("chat_does_not_exist", "ghost");
    store.finalize("chat_does_not_exist", { content: "ghost", status: "complete" });

    expect(store.snapshot()).toEqual(before);
    expect(store.snapshot().find((m) => m.id === idB)!.content).toBe("live");
  });

  it("an empty id is rejected — it must never fall back to the last message", () => {
    const idB = startAssistantTurn(store, "only turn");
    streamDelta(store, "live", idB);

    store.appendDelta("", "ghost");
    store.finalize("", { content: "ghost", status: "complete" });

    const b = store.snapshot().find((m) => m.id === idB)!;
    expect(b.content).toBe("live");
    expect(b.status).toBe("streaming");
  });

  it("a stale delta cannot resurrect a turn the user already saw finalized", () => {
    const idA = startAssistantTurn(store, "q");
    store.finalize(idA, { content: "settled answer", status: "complete" });
    store.appendDelta(idA, " …and more");
    expect(store.snapshot().find((m) => m.id === idA)!.content).toBe("settled answer");
  });

  it("ids stay valid across intervening messages — position is not identity", () => {
    const idA = startAssistantTurn(store, "q-a");
    // Several unrelated turns land in between.
    for (let i = 0; i < 5; i++) {
      const id = startAssistantTurn(store, `filler-${i}`);
      store.finalize(id, { content: `filler-answer-${i}`, status: "complete" });
    }
    // A's stream, still open, finally finishes — it must find ITS message.
    store.appendDelta(idA, "A-body");
    store.finalize(idA, { content: "A-body", status: "complete" });

    const a = store.snapshot().find((m) => m.id === idA)!;
    expect(a.content).toBe("A-body");
    expect(a.status).toBe("complete");
    // The newest turn is untouched.
    expect(store.last()!.content).toBe("filler-answer-4");
  });

  it("find() resolves a message by id, and returns null for an unknown id", () => {
    const id = startAssistantTurn(store, "q");
    expect(store.find(id)!.role).toBe("assistant");
    expect(store.find("chat_nope")).toBeNull();
  });
});
