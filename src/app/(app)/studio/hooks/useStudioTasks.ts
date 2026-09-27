"use client";

import { useCallback, useEffect, useState } from "react";
import type { StudioTask } from "@/lib/studio/task-types";
import { useClerkAuth } from "@/hooks/useClerkAuth";

export function useStudioTasks(projectId: string | null) {
  const { getToken } = useClerkAuth();
  const [tasks, setTasks] = useState<StudioTask[]>([]);
  const [closedTasks, setClosedTasks] = useState<StudioTask[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const headers = useCallback(async (json = false): Promise<HeadersInit> => {
    const token = await getToken?.();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, [getToken]);

  const refresh = useCallback(async () => {
    if (!projectId) {
      setTasks([]);
      setClosedTasks([]);
      setActiveTaskId(null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/studio/tasks?projectId=${encodeURIComponent(projectId)}&includeClosed=true`, {
        cache: "no-store",
        credentials: "include",
        headers: await headers(),
      });
      if (!res.ok) return;
      const data = await res.json() as { tasks?: StudioTask[]; closedTasks?: StudioTask[] };
      const next = Array.isArray(data.tasks) ? data.tasks : [];
      setTasks(next);
      setClosedTasks(Array.isArray(data.closedTasks) ? data.closedTasks : []);
      setActiveTaskId((current) => current && next.some((task) => task.id === current)
        ? current
        : next[0]?.id ?? null);
    } catch {
      // Task persistence may be unavailable during an unauthenticated/local
      // shell mount. Existing conversation/runtime state remains authoritative.
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [headers, projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const createTask = useCallback(async (input: {
    title?: string;
    taskType?: StudioTask["taskType"];
    conversationId?: string | null;
  }) => {
    if (!projectId) return null;
    let res: Response;
    try {
      res = await fetch("/api/studio/tasks", {
        method: "POST",
        credentials: "include",
        headers: await headers(true),
        body: JSON.stringify({ projectId, ...input }),
      });
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json() as { task?: StudioTask };
    if (!data.task) return null;
    setTasks((current) => [data.task!, ...current.filter((task) => task.id !== data.task!.id)]);
    setActiveTaskId(data.task.id);
    return data.task;
  }, [headers, projectId]);

  const activateTask = useCallback(async (taskId: string, surface = "studio") => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return null;
    setActiveTaskId(task.id);
    const res = await fetch(`/api/studio/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      credentials: "include",
      headers: await headers(true),
      body: JSON.stringify({ lastOpenedSurface: surface }),
    });
    if (res.ok) {
      const data = await res.json() as { task?: StudioTask };
      if (data.task) setTasks((current) => current.map((item) => item.id === task.id ? data.task! : item));
    }
    return task;
  }, [headers, tasks]);

  const closeTask = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/studio/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: await headers(true),
      body: JSON.stringify({ status: "closed" }),
    });
    if (!res.ok) return false;
    const closed = tasks.find((task) => task.id === taskId);
    setTasks((current) => current.filter((task) => task.id !== taskId));
    if (closed) setClosedTasks((current) => [closed, ...current.filter((task) => task.id !== taskId)]);
    setActiveTaskId((current) => current === taskId ? null : current);
    return true;
  }, [headers, tasks]);

  const reopenTask = useCallback(async (taskId: string) => {
    const res = await fetch(`/api/studio/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      credentials: "include",
      headers: await headers(true),
      body: JSON.stringify({ reopen: true }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { task?: StudioTask };
    if (data.task) {
      setTasks((current) => [data.task!, ...current.filter((task) => task.id !== taskId)]);
      setClosedTasks((current) => current.filter((task) => task.id !== taskId));
      setActiveTaskId(taskId);
    }
    return data.task ?? null;
  }, [headers]);

  return {
    tasks,
    closedTasks,
    activeTaskId,
    activeTask: tasks.find((task) => task.id === activeTaskId) ?? null,
    loading,
    refresh,
    createTask,
    activateTask,
    closeTask,
    reopenTask,
    setActiveTaskId,
  };
}
