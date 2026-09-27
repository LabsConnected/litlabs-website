"use client";

/**
 * Studio shell top bar: LiTT mark · project switcher · named-task switcher ·
 * terminal status · owner indicator.
 *
 * Tasks are the old worktab bar, renamed: meaningful names, inline rename,
 * restore-on-select. There is no "Untitled N" anywhere in this component.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Pencil, Plus, X } from "lucide-react";
import { OwnerTestModeIndicator } from "@/components/OwnerTestModeIndicator";
import { useStudioShell } from "./StudioShellContext";
import { isPlaceholderTitle } from "./task-naming";

function TaskSwitcher() {
  const {
    tasks,
    tasksLoading,
    activeTask,
    activeTaskId,
    selectTask,
    createNewTask,
    renameTask,
    closeTask,
  } = useStudioShell();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open ]);

  const commitRename = async (taskId: string) => {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    setBusy(true);
    try {
      await renameTask(taskId, title);
    } finally {
      setBusy(false);
    }
  };

  const handleNew = async () => {
    setBusy(true);
    try {
      await createNewTask();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const label = activeTask
    ? isPlaceholderTitle(activeTask.title)
      ? "New task"
      : activeTask.title
    : "Select task";

  return (
    <div ref={rootRef} className="relative min-w-0" data-testid="studio-task-switcher">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition hover:opacity-80 sm:max-w-[280px]"
        style={{ borderColor: "var(--studio-border)", color: "var(--text-primary)" }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{label}</span>
        <ChevronDown size={14} className="shrink-0 opacity-60" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border shadow-2xl"
          style={{ backgroundColor: "var(--studio-elevated)", borderColor: "var(--studio-border)" }}
          role="listbox"
        >
          <div className="max-h-72 overflow-y-auto p-1.5">
            {tasksLoading && tasks.length === 0 && (
              <div className="px-3 py-4 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                Loading tasks…
              </div>
            )}
            {!tasksLoading && tasks.length === 0 && (
              <div className="px-3 py-4 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                No tasks yet — start one below.
              </div>
            )}
            {tasks.map((task) => {
              const isActive = task.id === activeTaskId;
              const title = isPlaceholderTitle(task.title) ? "New task" : task.title;
              return (
                <div
                  key={task.id}
                  className="group flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs"
                  style={isActive ? { backgroundColor: "rgba(163,230,53,0.08)" } : undefined}
                >
                  {renamingId === task.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitRename(task.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      onBlur={() => void commitRename(task.id)}
                      className="min-w-0 flex-1 rounded border bg-transparent px-1.5 py-1 text-xs"
                      style={{ borderColor: "var(--litt-primary)", color: "var(--text-primary)" }}
                      aria-label="Rename task"
                      maxLength={160}
                    />
                  ) : (
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        void selectTask(task.id);
                        setOpen(false);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {isActive && <Check size={13} className="shrink-0" style={{ color: "var(--litt-primary)" }} />}
                      <span className="truncate font-medium">{title}</span>
                    </button>
                  )}
                  {renamingId !== task.id && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setRenameValue(isPlaceholderTitle(task.title) ? "" : task.title);
                          setRenamingId(task.id);
                        }}
                        className="shrink-0 rounded p-1 opacity-0 transition group-hover:opacity-70 hover:opacity-100"
                        style={{ color: "var(--text-muted)" }}
                        aria-label={`Rename ${title}`}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void closeTask(task.id)}
                        className="shrink-0 rounded p-1 opacity-0 transition group-hover:opacity-70 hover:opacity-100"
                        style={{ color: "var(--text-muted)" }}
                        aria-label={`Close ${title}`}
                      >
                        <X size={13} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={handleNew}
            disabled={busy}
            className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-xs font-bold transition hover:opacity-80 disabled:opacity-50"
            style={{ borderColor: "var(--studio-border)", color: "var(--litt-primary)" }}
          >
            <Plus size={14} /> New task
          </button>
        </div>
      )}
    </div>
  );
}

export function StudioTopBar() {
  const { capabilities } = useStudioShell();
  const projectLabel =
    capabilities.projectName ?? capabilities.repositoryName ?? "No project";
  const terminalLive = capabilities.terminalExecution === "available";

  return (
    <header
      className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:gap-3 sm:px-3"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      data-testid="studio-top-bar"
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] font-black"
        style={{ backgroundColor: "var(--litt-primary)", color: "#0b0f04" }}
        aria-label="LiTT"
      >
        L
      </div>

      <Link
        href="/projects"
        className="hidden max-w-[200px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition hover:opacity-80 sm:flex"
        style={{ borderColor: "var(--studio-border)", color: "var(--text-primary)" }}
        title="Open projects"
      >
        <span className="truncate">{projectLabel}</span>
        <ChevronDown size={14} className="shrink-0 opacity-60" />
      </Link>

      <TaskSwitcher />

      <div className="flex-1" />

      <div
        className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold sm:flex"
        style={{
          borderColor: terminalLive ? "rgba(163,230,53,0.35)" : "var(--studio-border)",
          color: terminalLive ? "var(--litt-primary)" : "var(--text-muted)",
        }}
        title={capabilities.connectionSummary}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: terminalLive ? "var(--litt-primary)" : "var(--text-muted)" }}
        />
        {terminalLive ? "Terminal Live" : "Terminal Idle"}
      </div>

      <OwnerTestModeIndicator placement="inline" />
    </header>
  );
}
