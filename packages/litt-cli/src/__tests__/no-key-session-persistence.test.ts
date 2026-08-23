/**
 * No-key session persistence regression.
 *
 * Covers the follow-up defect in 2ac9c968: the no-key fallback used to
 * persist with
 *
 *     summary:  summarize(input)      // current input, NOT the first user message
 *     messages: noKeyMessages         // ONLY the new pair, NOT the transcript
 *
 * so a mid-conversation no-key submit forked a new session row holding
 * only the no-key pair, demoting the real conversation — /resume then
 * offered a 2-message stub as the newest session.
 *
 * The fix routes the persist through buildConversationSave() +
 * mergeAppend(): dedupe by (submissionId, role), summary anchored to the
 * FIRST user message. These tests bind to that production code directly.
 *
 * Uses LITT_SESSIONS_FILE → temp file, never touches ~/.litt.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildConversationSave,
  saveSession,
  listSessions,
  summarize,
  type SessionMessage,
} from "../lib/session-store.js";

let tempDir: string;

const NO_KEY_TEXT =
  "Set OPENROUTER_API_KEY to talk to LiTT, or use /commands for direct execution. "
  + "Run /doctor to check provider status.";

const context = {
  project: "litlabs-website",
  cwd: "/data/data/com.termux/files/home/litt",
  branch: "feat/litt-cli-oauth-login",
  mode: "act" as const,
  routingMode: "auto",
  selectedModel: null,
};

/** The prior conversation already on screen when the no-key submit happens. */
const PRIOR_TRANSCRIPT: SessionMessage[] = [
  { role: "user", content: "whats up", status: "complete", ts: 1_000 },
  { role: "assistant", content: "Not much — Luna here. What do you need?", status: "complete", ts: 1_100 },
];

/**
 * Seed an in-progress conversation the way persistSession() does:
 * full transcript, summary derived from the FIRST user message.
 */
function seedExistingConversation(): void {
  liveTranscript = [...PRIOR_TRANSCRIPT];
  const firstUser = PRIOR_TRANSCRIPT.find((m) => m.role === "user");
  saveSession({
    ...context,
    summary: summarize(firstUser?.content ?? "untitled"),
    messages: PRIOR_TRANSCRIPT,
  });
}

/**
 * The FIXED controller flow (controller.ts submit(), no-key branch):
 *
 *   1. addChatMessage × 2 mutates the pure transcript store synchronously
 *      (with a shared submissionId).
 *   2. getChatTranscript() reads the store straight back — already
 *      containing the new pair.
 *   3. buildConversationSave(ctx, transcript, pair) merges with
 *      mergeAppend(), deduping by (submissionId, role), and derives the
 *      summary from the FIRST user message of the merged conversation.
 *
 * Both capture timings are exercised: "fresh" (snapshot already holds the
 * pair — what the controller does today) and "stale" (snapshot taken
 * before the mutation). mergeAppend must produce identical results.
 */
/**
 * Simulated live transcript store — mirrors ChatTranscriptStore semantics:
 * addChatMessage mutates it synchronously, while a React-state snapshot
 * taken "stale" simply lags behind by the current tick (it still contains
 * every earlier turn).
 */
let liveTranscript: SessionMessage[];

function fixedNoKeyPersist(
  input: string,
  timing: "fresh" | "stale",
  submissionId = "sub_nokey_test",
): void {
  const pair: SessionMessage[] = [
    { role: "user", content: input, status: "complete", ts: Date.now(), submissionId },
    { role: "assistant", content: NO_KEY_TEXT, status: "error", ts: Date.now(), submissionId },
  ];
  let snapshot: SessionMessage[];
  if (timing === "fresh") {
    liveTranscript.push(...pair);
    snapshot = [...liveTranscript];
  } else {
    snapshot = [...liveTranscript];
    liveTranscript.push(...pair);
  }
  // The controller reads getChatTranscript() (the pure store) as `prior`
  // and passes the new pair as `appended`; mergeAppend dedupes.
  saveSession(buildConversationSave(context, snapshot, pair));
}

/** The session /resume shows first — most recently updated. */
function resumedSession() {
  return listSessions()[0];
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "litt-nokey-sessions-"));
  process.env.LITT_SESSIONS_FILE = join(tempDir, "sessions.json");
  liveTranscript = [];
});

afterEach(() => {
  delete process.env.LITT_SESSIONS_FILE;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("no-key persistence — existing transcript is preserved", () => {
  for (const timing of ["fresh", "stale"] as const) {
    it(`[${timing}] keeps all prior messages after a no-key submit`, () => {
      seedExistingConversation();
      fixedNoKeyPersist("no key test", timing);

      const contents = resumedSession().messages.map((m) => m.content);
      expect(contents).toContain("whats up");
      expect(contents).toContain("Not much — Luna here. What do you need?");
    });

    it(`[${timing}] appends the new user/error pair exactly once`, () => {
      seedExistingConversation();
      fixedNoKeyPersist("no key test", timing);

      const { messages } = resumedSession();
      expect(messages.filter((m) => m.content === "no key test")).toHaveLength(1);
      expect(messages.filter((m) => m.content === NO_KEY_TEXT)).toHaveLength(1);

      const errors = messages.filter((m) => m.status === "error");
      expect(errors).toHaveLength(1);
      expect(errors[0].role).toBe("assistant");
    });

    it(`[${timing}] keeps the summary derived from the FIRST user message`, () => {
      seedExistingConversation();
      fixedNoKeyPersist("no key test", timing);

      // The conversation is still "whats up" — a mid-conversation no-key
      // submit must not relabel it, or saveSession forks a new session row.
      expect(resumedSession().summary).toBe(summarize("whats up"));
    });

    it(`[${timing}] produces no duplicate messages`, () => {
      seedExistingConversation();
      fixedNoKeyPersist("no key test", timing);

      const { messages } = resumedSession();
      const keys = messages.map((m) => `${m.role}::${m.content}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it(`[${timing}] updates the existing session in place — no forked stub row`, () => {
      seedExistingConversation();
      fixedNoKeyPersist("no key test", timing);

      const all = listSessions();
      expect(all).toHaveLength(1);
      expect(all[0].messages).toHaveLength(PRIOR_TRANSCRIPT.length + 2);
    });
  }
});

describe("no-key persistence — repeated no-key submits accumulate", () => {
  it("a second no-key submit does not overwrite the first pair", () => {
    // Each submit carries its own submissionId; mergeAppend must keep
    // BOTH pairs (different keys) while never doubling either one.
    fixedNoKeyPersist("first no key", "stale", "sub_1");
    fixedNoKeyPersist("second no key", "stale", "sub_2");

    const contents = listSessions().flatMap((s) => s.messages.map((m) => m.content));
    expect(contents).toContain("first no key");
    expect(contents).toContain("second no key");
  });

  it("repeated submits update ONE session row — no fork per turn", () => {
    fixedNoKeyPersist("first no key", "fresh", "sub_1");
    fixedNoKeyPersist("second no key", "stale", "sub_2");

    const all = listSessions();
    expect(all).toHaveLength(1);
    expect(all[0].messages).toHaveLength(4); // 2 pairs
    expect(all[0].summary).toBe(summarize("first no key"));
  });
});
