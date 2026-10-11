"use client";

/**
 * GlobalLittStudioEntry — Phase 2 intentional entry point for Global LiTT in Studio.
 *
 * This is NOT another assistant implementation. It reuses:
 * - useGlobalLitt() from Phase 1 (loads the existing owner system row, never duplicates)
 * - The existing /api/gemini/chat endpoint with globalLittProjectId
 *
 * The button appears in the Studio header, separate from the ordinary
 * project picker. Global LiTT never appears in ordinary project lists.
 *
 * The entry is available to every signed-in user — it does NOT require the
 * project to pre-exist client-side. If the project hasn't loaded yet (fresh
 * user, or a transient load failure), clicking the button runs the canonical
 * get-or-create path (GET /api/global-litt) before opening the panel.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useGlobalLitt } from "@/components/global-litt/GlobalLittProvider";
import GlobalLittStudioPanel from "./GlobalLittStudioPanel";

export default function GlobalLittStudioEntry() {
  const { projectId, loading, error, refresh } = useGlobalLitt();
  const { isSignedIn } = useClerkAuth();
  const [open, setOpen] = useState(false);
  const [ensuring, setEnsuring] = useState(false);

  // Don't render until we know the auth + Global LiTT state
  // (prevents flash of dead button)
  if (loading) return null;

  // Only applies to signed-in users
  if (!isSignedIn) return null;

  const handleOpen = async () => {
    if (!projectId) {
      // Fresh user or transient load failure — run the canonical
      // get-or-create endpoint, then open. The panel reads projectId
      // from context at render time, so it sees the fresh value.
      setEnsuring(true);
      try {
        await refresh();
      } finally {
        setEnsuring(false);
      }
    }
    setOpen(true);
  };

  const unavailable = !projectId && error;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        disabled={ensuring}
        aria-label="Open Global LiTT"
        title={
          unavailable
            ? `Global LiTT unavailable: ${error} — click to retry`
            : "Global LiTT — your persistent AI operator"
        }
        className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all hover:opacity-80 disabled:opacity-60"
        style={{
          borderColor: "var(--color-accent)",
          color: "var(--color-accent)",
          backgroundColor: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
        }}
        data-testid="global-litt-studio-entry"
      >
        <Sparkles size={16} />
        <span className="hidden sm:inline">
          {ensuring ? "Starting…" : "Global LiTT"}
        </span>
      </button>
      {open && <GlobalLittStudioPanel onClose={() => setOpen(false)} />}
    </>
  );
}
