"use client";

import { useState } from "react";

export type ActionResult = {
  title: string;
  content: string;
  type: "success" | "info" | "warning" | "error";
};

export function useJarvisActions() {
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runScan() {
    setLoading("scan");
    setError(null);
    try {
      const res = await fetch("/api/jarvis/scan");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult({
        title: "Project Scan Complete",
        content: `Found ${data.totalFiles} files, ${data.totalLines} lines. Stack: ${data.techStack?.join(", ")}. ${data.health?.buildStatus}`,
        type: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setLoading(null);
    }
  }

  async function startWorkflow() {
    setLoading("workflow");
    setError(null);
    try {
      const res = await fetch("/api/agents/task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: "jarvis", task: "review project status and suggest next steps" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult({
        title: "Workflow Started",
        content: data.message || "Jarvis workflow initiated.",
        type: "info",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Workflow failed");
    } finally {
      setLoading(null);
    }
  }

  async function deploy() {
    setLoading("deploy");
    setError(null);
    try {
      const res = await fetch("/api/deploy/trigger", { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text);
      }
      const data = await res.json();
      setResult({
        title: "Deploy Triggered",
        content: data.url ? `Production deploy started: ${data.url}` : "Production deploy queued.",
        type: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setLoading(null);
    }
  }

  async function askJarvis(question: string) {
    setLoading("ask");
    setError(null);
    try {
      const res = await fetch("/api/jarvis/think", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question, context: { route: "/agents/jarvis" } }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult({
        title: "Jarvis",
        content: data.answer || "No response.",
        type: "info",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jarvis failed");
    } finally {
      setLoading(null);
    }
  }

  function clear() {
    setResult(null);
    setError(null);
  }

  return {
    loading,
    result,
    error,
    runScan,
    startWorkflow,
    deploy,
    askJarvis,
    clear,
  };
}
