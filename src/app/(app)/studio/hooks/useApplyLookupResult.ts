"use client";

/**
 * useApplyLookupResult — lets the user save a live-lookup answer into
 * their active project as a note, after an explicit confirmation step
 * (the caller owns the confirm dialog; this hook only performs the write
 * once told to).
 *
 * Deliberately reuses the existing, already-authenticated and
 * audit-logged project files API (POST /api/studio-projects/[id]/files)
 * instead of adding a new write surface — same ownership verification,
 * path-safety checks, and file-audit logging every other project write
 * goes through. This hook never talks to the terminal-server directly.
 *
 * Writes are append-only to a single fixed note file, and use the files
 * API's existing CAS precondition (expectedSha256) so a concurrent edit
 * to the same note — another tab, another device, an agent write — is
 * never silently clobbered: the write is rejected (409) instead of lost.
 * One bounded retry re-reads the fresh content and re-appends on top of
 * it; a second conflict surfaces honestly rather than looping forever.
 */
import { useCallback, useState } from "react";

export const LOOKUP_NOTES_PATH = "notes/litt-lookup.md";

interface FilesApiResponse {
  content?: string;
  error?: string;
}

async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface NotesSnapshot {
  content: string;
  /** The CAS precondition for a write on top of this snapshot: the
   * revision hash of a file that exists, or "absent" when it doesn't. */
  expectedSha256: string;
}

async function readNotes(projectId: string): Promise<NotesSnapshot> {
  const resp = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/files`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "read", path: LOOKUP_NOTES_PATH }),
  });
  if (resp.status === 404) return { content: "", expectedSha256: "absent" }; // no notes file yet
  const data = (await resp.json().catch(() => null)) as FilesApiResponse | null;
  if (!resp.ok) throw new Error(data?.error ?? "Could not read the project's notes file.");
  const content = typeof data?.content === "string" ? data.content : "";
  return { content, expectedSha256: await sha256Hex(content) };
}

/** Returns true on success, false on a revision conflict (safe to retry once), throws on any other failure. */
async function writeNotes(projectId: string, content: string, expectedSha256: string): Promise<boolean> {
  const resp = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/files`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", path: LOOKUP_NOTES_PATH, content, expectedSha256 }),
  });
  if (resp.status === 409) return false;
  const data = (await resp.json().catch(() => null)) as FilesApiResponse | null;
  if (!resp.ok) throw new Error(data?.error ?? "Could not save to the project's notes file.");
  return true;
}

function entryFor(query: string, formatted: string, source: string | null): string {
  const stamp = new Date().toISOString();
  const sourceLine = source ? ` (${source})` : "";
  return `## ${stamp}\n**Asked:** ${query}${sourceLine}\n\n${formatted}\n`;
}

function appendTo(existing: string, entry: string): string {
  return existing ? `${existing}\n${entry}` : entry;
}

export function useApplyLookupResult(projectId: string | null) {
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appliedAt, setAppliedAt] = useState<number | null>(null);

  const apply = useCallback(
    async (query: string, formatted: string, source: string | null) => {
      if (!projectId) {
        setError("No active project to save this into.");
        return false;
      }
      setApplying(true);
      setError(null);
      try {
        const entry = entryFor(query, formatted, source);

        for (let attempt = 1; attempt <= 2; attempt++) {
          const snapshot = await readNotes(projectId);
          const ok = await writeNotes(projectId, appendTo(snapshot.content, entry), snapshot.expectedSha256);
          if (ok) {
            window.dispatchEvent(
              new CustomEvent("studio:files-changed", { detail: { projectId, path: LOOKUP_NOTES_PATH } }),
            );
            setAppliedAt(Date.now());
            return true;
          }
          // 409: something else wrote this file between our read and our
          // write. One retry re-reads the now-current content and
          // re-appends on top of it, instead of overwriting it.
        }

        setError(
          "This note was changed somewhere else while saving — nothing was overwritten. Try Add to project again.",
        );
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save this to the project.");
        return false;
      } finally {
        setApplying(false);
      }
    },
    [projectId],
  );

  const resetError = useCallback(() => setError(null), []);
  // Called when a new search starts — "Saved ✓" must never linger onto
  // an unrelated result the user hasn't actually applied yet.
  const resetApplied = useCallback(() => setAppliedAt(null), []);

  return { apply, applying, error, appliedAt, resetError, resetApplied };
}
