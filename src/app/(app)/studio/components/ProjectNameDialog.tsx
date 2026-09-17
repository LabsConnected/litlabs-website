"use client";

import { useEffect, useRef, useState } from "react";
import { FolderPlus, X } from "lucide-react";
import { DEFAULT_PROJECT_NAME, validateProjectName } from "@/lib/projects/project-name";

export default function ProjectNameDialog({
  open,
  defaultName = DEFAULT_PROJECT_NAME,
  title = "Name your workspace",
  description = "Choose a name you’ll recognize when you come back.",
  submitLabel = "Create project",
  busy = false,
  error,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  defaultName?: string;
  title?: string;
  description?: string;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(DEFAULT_PROJECT_NAME);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setValidationError(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [defaultName, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  const submit = () => {
    const nextError = validateProjectName(name);
    if (nextError) {
      setValidationError(nextError);
      inputRef.current?.focus();
      return;
    }
    onSubmit(name.trim());
  };

  return (
    <div className="fixed inset-0 z-[10020] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="project-name-title" className="w-full max-w-md rounded-2xl border p-5 shadow-2xl" style={{ borderColor: "var(--studio-border-strong)", backgroundColor: "var(--studio-elevated)" }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em]" style={{ color: "var(--litt-primary)" }}><FolderPlus size={14} /> New project</div>
            <h2 id="project-name-title" className="text-lg font-black" style={{ color: "var(--text-primary)" }}>{title}</h2>
            <p className="mt-1 text-xs leading-5" style={{ color: "var(--text-muted)" }}>{description} You can use letters, numbers, spaces, and punctuation.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="Close project naming dialog" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg hover:bg-white/8 disabled:opacity-50" style={{ color: "var(--text-muted)" }}><X size={16} /></button>
        </div>
        <label htmlFor="project-name-input" className="mt-5 block text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>Project name</label>
        <input ref={inputRef} id="project-name-input" value={name} onChange={(event) => { setName(event.target.value); setValidationError(null); }} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} disabled={busy} maxLength={120} className="mt-1.5 h-11 w-full rounded-xl border bg-transparent px-3 text-sm outline-none focus:ring-2 disabled:opacity-60" style={{ borderColor: validationError || error ? "#f87171" : "var(--studio-border-strong)", color: "var(--text-primary)", outlineColor: "var(--litt-primary)" }} />
        {(validationError || error) && <p role="alert" className="mt-2 text-xs font-bold" style={{ color: "#fca5a5" }}>{validationError || error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-xl border px-4 py-2.5 text-xs font-bold disabled:opacity-50" style={{ borderColor: "var(--studio-border)", color: "var(--text-secondary)" }}>Cancel</button>
          <button type="button" onClick={submit} disabled={busy} className="rounded-xl px-4 py-2.5 text-xs font-black text-white disabled:opacity-50" style={{ backgroundColor: "var(--litt-primary)" }}>{busy ? "Saving…" : submitLabel}</button>
        </div>
      </section>
    </div>
  );
}
