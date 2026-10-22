/**
 * Real-process fixture for crash/kill recovery tests. Runs as an actual
 * separate OS process (spawned via tsx, not imported in-process) so that
 * a parent test can send it a real termination and verify what survives
 * in the ACTUAL session-store.ts module — not a mock of it.
 *
 * Env:
 *   LITT_SESSIONS_FILE — required, isolates the write to a temp file.
 *
 * Argv:
 *   [2] user message content to persist.
 *   [3] mode: "idle" (wait to be killed) | "crash" (throw after saving
 *       and signaling ready) | "two-saves" (save, signal ready, wait,
 *       save a second message, signal ready again, then idle).
 *   [4] readyFile — path this process writes to once each save+signal
 *       step is durably on disk, so the parent can wait deterministically
 *       instead of sleeping a guessed duration.
 */
import { writeFileSync } from "node:fs";
import { saveSession } from "../../lib/session-store.js";

const content = process.argv[2] ?? "";
const mode = process.argv[3] ?? "idle";
const readyFile = process.argv[4];

function signalReady(tag: string): void {
  if (readyFile) writeFileSync(readyFile, tag, "utf8");
}

// Mirrors the real controller: summary is always derived from the FIRST
// message of the accumulated transcript, so repeated saves of the SAME
// growing conversation share one summary and merge into one session
// record (session-store.ts's same-conversation-within-10-minutes rule).
// A fixture that re-derived the summary from only the latest message —
// which would change every call — would create a new record each time
// and falsely look like a duplication bug.
const transcript: { role: "user" | "assistant"; content: string; status: string; ts: number }[] = [];

function save(newText: string): void {
  transcript.push({ role: "user", content: newText, status: "complete", ts: Date.now() });
  saveSession({
    project: "subprocess-fixture",
    cwd: process.cwd(),
    branch: "main",
    mode: "act",
    routingMode: "auto",
    selectedModel: null,
    summary: transcript[0].content.slice(0, 40),
    messages: transcript,
  });
}

save(content);
signalReady("READY_1");

if (mode === "crash") {
  setTimeout(() => {
    throw new Error("simulated crash — must have no effect on data already saved above");
  }, 100);
} else if (mode === "two-saves") {
  setTimeout(() => {
    save(`${content} — second save`);
    signalReady("READY_2");
  }, 200);
}

// Keep the process alive so the parent controls when it ends (idle mode,
// or the window before "two-saves"/"crash" fire).
setInterval(() => {}, 1000);
