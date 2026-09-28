"use client";

const ITEMS = [
  "Open Studio and land on Workspace.",
  "Create a chat and a task.",
  "Link the chat and the task.",
  "Move and resize both windows.",
  "Reload and find the same windows, positions, and link.",
  "Rename a window from the inspector.",
  "Undo the rename, then redo it.",
  "Delete a window and confirm the conversation or task still exists.",
];

export function WorkspaceChecklist() {
  return (
    <details className="pointer-events-none absolute left-3 top-14 z-30 w-72 border border-white/10 bg-black/75 p-2 text-[11px] leading-5 text-white/75" style={{ borderRadius: 6 }}>
      <summary className="pointer-events-auto cursor-pointer text-white/90">Workspace checklist</summary>
      <ol className="pointer-events-auto mt-2 list-decimal space-y-1 pl-4">
        {ITEMS.map((item) => <li key={item}>{item}</li>)}
      </ol>
    </details>
  );
}
