"use client";

import { useState } from "react";
import { Rocket, Loader2, CheckCircle, AlertCircle } from "lucide-react";

export function DeployButton() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const deploy = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/deploy/trigger", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setStatus({ type: "success", message: `Production deployment started: ${data.id}` });
      } else {
        setStatus({ type: "error", message: data.error || "Deploy failed" });
      }
    } catch (err) {
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Deploy failed" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={deploy}
        disabled={loading}
        className="flex items-center gap-2 rounded-lg bg-orange-600 px-5 py-2 font-bold text-white hover:bg-orange-500 disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
        {loading ? "Deploying..." : "Deploy"}
      </button>

      {status && (
        <div
          className={`flex max-w-[260px] items-center gap-2 rounded-lg px-3 py-2 text-xs ${
            status.type === "success" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
          }`}
        >
          {status.type === "success" ? <CheckCircle className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          <span className="truncate">{status.message}</span>
        </div>
      )}
    </div>
  );
}
