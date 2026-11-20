"use client";

/**
 * LookupApplyDialog — explicit confirmation before a live-lookup result
 * is written into the active project (checklist requirement: no project
 * file is ever touched without the user seeing exactly what will be
 * written and confirming it first). Mirrors ProjectNameDialog's modal
 * contract (fixed overlay, role="dialog", Escape-to-cancel).
 */
import { useEffect, useRef } from "react";
import { FileText, X } from "lucide-react";
import { LOOKUP_NOTES_PATH } from "../../hooks/useApplyLookupResult";

export default function LookupApplyDialog({
  open,
  query,
  formatted,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  query: string;
  formatted: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => confirmRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  return (
    <div
      data-testid="lookup-apply-dialog"
      className="fixed inset-0 z-[10020] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="lookup-apply-title"
        className="w-full max-w-md rounded-2xl border p-5 shadow-2xl"
        style={{ borderColor: "var(--studio-border-strong)", backgroundColor: "var(--studio-elevated)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div
              className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em]"
              style={{ color: "var(--litt-primary)" }}
            >
              <FileText size={14} /> Save to project
            </div>
            <h2 id="lookup-apply-title" className="text-lg font-black" style={{ color: "var(--text-primary)" }}>
              Add this answer to your project?
            </h2>
            <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>
              This appends a note to <code data-testid="lookup-apply-path">{LOOKUP_NOTES_PATH}</code> in your
              project workspace. Nothing else is changed.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/8 disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div
          data-testid="lookup-apply-preview"
          className="mt-4 max-h-40 overflow-y-auto rounded-xl border p-3 text-xs leading-5"
          style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)" }}
        >
          <p className="font-bold" style={{ color: "var(--text-primary)" }}>
            Asked: {query}
          </p>
          <p className="mt-1">{formatted}</p>
        </div>

        {error && (
          <p role="alert" data-testid="lookup-apply-error" className="mt-3 text-xs font-bold" style={{ color: "#fca5a5" }}>
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="lookup-apply-cancel"
            className="rounded-xl border px-4 py-2.5 text-xs font-bold disabled:opacity-50"
            style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)" }}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="lookup-apply-confirm"
            className="rounded-xl px-4 py-2.5 text-xs font-black text-white disabled:opacity-50"
            style={{ backgroundColor: "var(--litt-primary)" }}
          >
            {busy ? "Saving…" : "Add to project"}
          </button>
        </div>
      </section>
    </div>
  );
}
