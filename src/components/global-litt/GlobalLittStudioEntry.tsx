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
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useGlobalLitt } from "@/components/global-litt/GlobalLittProvider";
import GlobalLittStudioPanel from "./GlobalLittStudioPanel";

export default function GlobalLittStudioEntry() {
  const { projectId, loading } = useGlobalLitt();
  const [open, setOpen] = useState(false);

  // Don't render until we know the Global LiTT state
  // (prevents flash of dead button)
  if (loading) return null;

  // If no Global LiTT project (not signed in, or error), don't render
  // This is not a dead control — it simply doesn't apply
  if (!projectId) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Global LiTT"
        title="Global LiTT — your persistent AI operator"
        className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-all hover:opacity-80"
        style={{
          borderColor: "var(--color-accent)",
          color: "var(--color-accent)",
          backgroundColor: "color-mix(in srgb, var(--color-accent) 8%, transparent)",
        }}
        data-testid="global-litt-studio-entry"
      >
        <Sparkles size={16} />
        <span className="hidden sm:inline">Global LiTT</span>
      </button>
      {open && <GlobalLittStudioPanel onClose={() => setOpen(false)} />}
    </>
  );
}
