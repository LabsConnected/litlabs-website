"use client";

import { Plus, X } from "lucide-react";
import type { StudioTask } from "@/lib/studio/task-types";

const STATUS_LABEL: Record<StudioTask["status"], string> = {
  working: "Working",
  ready: "Ready",
  waiting_approval: "Waiting for approval",
  needs_verification: "Needs verification",
  failed: "Failed",
  complete: "Complete",
  closed: "Closed",
};

const STATUS_COLOR: Record<StudioTask["status"], string> = {
  working: "var(--color-accent)",
  ready: "var(--text-muted)",
  waiting_approval: "#e3b341",
  needs_verification: "#e3b341",
  failed: "#ef4444",
  complete: "#6ee7b7",
  closed: "var(--text-muted)",
};

export default function StudioTaskRail({
  tasks,
  activeTaskId,
  onSelect,
  onCreate,
  onClose,
  closedTasks = [],
  onReopen,
}: {
  tasks: StudioTask[];
  activeTaskId: string | null;
  onSelect: (task: StudioTask) => void;
  onCreate: () => void;
  onClose: (task: StudioTask) => void;
  closedTasks?: StudioTask[];
  onReopen?: (task: StudioTask) => void;
}) {
  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5 [scrollbar-width:none]"
      style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-surface)" }}
      data-testid="studio-task-rail"
      aria-label="Project tasks"
    >
      {tasks.map((task) => {
        const active = task.id === activeTaskId;
        return (
          <div key={task.id} className="group flex min-w-0 shrink-0 items-center">
            <button
              type="button"
              onClick={() => onSelect(task)}
              className="flex min-h-9 max-w-52 items-center gap-2 rounded-l-lg border px-2.5 text-left text-[10px] font-bold"
              style={{
                borderColor: active ? "color-mix(in srgb, var(--color-accent) 45%, transparent)" : "var(--studio-border)",
                backgroundColor: active ? "color-mix(in srgb, var(--color-accent) 10%, transparent)" : "transparent",
                color: active ? "var(--text-primary)" : "var(--text-secondary)",
              }}
              aria-current={active ? "page" : undefined}
              title={`${task.title} · ${STATUS_LABEL[task.status]}`}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLOR[task.status] }} aria-hidden />
              <span className="truncate">{task.title}</span>
              <span className="sr-only">{STATUS_LABEL[task.status]}</span>
            </button>
            <button
              type="button"
              onClick={() => onClose(task)}
              className="grid min-h-9 min-w-8 place-items-center rounded-r-lg border border-l-0"
              style={{ borderColor: active ? "color-mix(in srgb, var(--color-accent) 45%, transparent)" : "var(--studio-border)", color: "var(--text-muted)" }}
              aria-label={`Close task ${task.title}`}
              title="Close task (work is retained)"
            >
              <X size={12} className="pointer-events-none" />
            </button>
          </div>
        );
      })}
      {closedTasks.length > 0 && onReopen && (
        <select
          className="min-h-9 max-w-40 rounded-lg border bg-transparent px-2 text-[10px] font-bold"
          style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
          aria-label="Reopen closed task"
          value=""
          onChange={(event) => {
            const task = closedTasks.find((item) => item.id === event.target.value);
            if (task) onReopen(task);
          }}
        >
          <option value="">Reopen task…</option>
          {closedTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
        </select>
      )}
      <button
        type="button"
        onClick={onCreate}
        className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg border"
        style={{ borderColor: "var(--studio-border)", color: "var(--text-muted)" }}
        aria-label="Create new task"
        title="Create new task"
      >
        <Plus size={14} className="pointer-events-none" />
      </button>
    </div>
  );
}
