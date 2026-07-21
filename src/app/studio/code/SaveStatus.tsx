"use client";

interface SaveStatusProps {
  isDirty: boolean;
  isSaving: boolean;
  error: string | null;
}

export default function SaveStatus({ isDirty, isSaving, error }: SaveStatusProps) {
  if (error) {
    return <span className="text-[9px] font-semibold text-rose-400">{error}</span>;
  }
  if (isSaving) {
    return <span className="text-[9px] font-semibold text-cyan-300">Saving…</span>;
  }
  if (isDirty) {
    return <span className="text-[9px] font-semibold text-amber-400">Unsaved</span>;
  }
  return <span className="text-[9px] font-semibold text-emerald-400/60">Saved</span>;
}
