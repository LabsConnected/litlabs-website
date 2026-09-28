"use client";

/**
 * RunChangesPanel — the inspector's Changes tab.
 *
 * Shows what the latest LiTT run changed (files + readable diff between
 * its persisted before/after checkpoints) with Accept / Revert. Everything
 * comes from durable checkpoint rows, so it survives a refresh.
 */
import { useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, GitCommit, RotateCcw } from "lucide-react";
import { useRunCheckpoints } from "../hooks/useRunCheckpoints";

interface DiffFile {
  path: string;
  additions: number | null;
  deletions: number | null;
}

type Decision = "accepted" | "reverted" | null;

function decisionKey(projectId: string) {
  return `litt:run-decision:${projectId}`;
}

function readDecision(projectId: string, afterSha: string): Decision {
  try {
    const raw = window.localStorage.getItem(decisionKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { sha?: string; decision?: Decision };
    return parsed.sha === afterSha ? parsed.decision ?? null : null;
  } catch {
    return null;
  }
}

function writeDecision(projectId: string, afterSha: string, decision: Decision) {
  try {
    window.localStorage.setItem(decisionKey(projectId), JSON.stringify({ sha: afterSha, decision }));
  } catch {
    // best-effort
  }
}

/** Split a unified diff into per-file chunks keyed by the b/ path. */
function splitDiff(diff: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = diff.split(/^diff --git /m).filter(Boolean);
  for (const part of parts) {
    const m = part.match(/^a\/(.+?) b\/(.+?)\n/);
    const path = m?.[2] ?? m?.[1];
    if (path) out[path] = `diff --git ${part}`;
  }
  return out;
}

function lineColor(line: string): string | undefined {
  if (line.startsWith("+++") || line.startsWith("---")) return "var(--text-muted)";
  if (line.startsWith("+")) return "#86efac";
  if (line.startsWith("-")) return "#fca5a5";
  if (line.startsWith("@@")) return "#67e8f9";
  return undefined;
}

export default function RunChangesPanel({
  projectId,
  busy,
  refreshKey,
}: {
  projectId: string | null;
  busy: boolean;
  refreshKey: unknown;
}) {
  // Re-read once a run finishes (busy → false) or files change.
  const { before, after, loading, error, reload } = useRunCheckpoints(projectId, `${busy}:${String(refreshKey)}`);
  const [files, setFiles] = useState<DiffFile[] | null>(null);
  const [chunks, setChunks] = useState<Record<string, string>>({});
  const [truncated, setTruncated] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>(null);
  const [reverting, setReverting] = useState(false);

  useEffect(() => {
    if (!projectId || !after) return;
    setDecision(readDecision(projectId, after.gitSha));
  }, [projectId, after]);

  useEffect(() => {
    setFiles(null);
    setChunks({});
    setDiffError(null);
    if (!projectId || !before || !after) return;
    let cancelled = false;
    const q = new URLSearchParams({ from: before.gitSha, to: after.gitSha });
    fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/checkpoints/diff?${q}`, {
      credentials: "include",
      cache: "no-store",
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Diff unavailable (${res.status})`);
        if (cancelled) return;
        setFiles(data.files ?? []);
        setChunks(splitDiff(data.diff ?? ""));
        setTruncated(!!data.truncated);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDiffError(err instanceof Error ? err.message : "Diff unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, before, after]);

  if (!projectId) {
    return <Empty text="Open a project to see its changes." />;
  }
  if (loading && !after && !before) {
    return <Empty text="Loading changes…" />;
  }
  if (error) {
    return <Empty text={error} />;
  }
  if (!after) {
    return <Empty text={busy ? "LiTT is working — changes appear here when the run saves them." : "No LiTT changes yet. Every change LiTT makes is saved as a checkpoint you can accept or revert."} />;
  }

  const accept = () => {
    writeDecision(projectId, after.gitSha, "accepted");
    setDecision("accepted");
  };

  const revert = async () => {
    if (!before) return;
    setReverting(true);
    try {
      const res = await fetch("/api/studio/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, sha: before.gitSha }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Revert failed (${res.status})`);
      }
      writeDecision(projectId, after.gitSha, "reverted");
      setDecision("reverted");
      window.dispatchEvent(new CustomEvent("studio:files-changed", { detail: { projectId, source: "rollback" } }));
      reload();
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : "Revert failed");
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="run-changes-panel">
      <div className="flex items-start gap-2">
        <GitCommit size={14} className="mt-0.5 shrink-0" style={{ color: "var(--color-accent)" }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-bold" style={{ color: "var(--text-main)" }} title={after.label}>
            {after.label}
          </div>
          <div className="font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
            {before ? `${before.gitSha.slice(0, 8)} → ` : ""}{after.gitSha.slice(0, 8)}
          </div>
        </div>
      </div>

      {decision === null ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-opacity duration-100 disabled:opacity-40"
            style={{ backgroundColor: "var(--color-accent)", color: "#0b0f0a" }}
          >
            <Check size={13} /> Accept
          </button>
          <button
            type="button"
            onClick={() => void revert()}
            disabled={busy || reverting || !before}
            title={before ? `Restore ${before.gitSha.slice(0, 8)}` : "No baseline checkpoint to restore"}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-opacity duration-100 disabled:opacity-40"
            style={{ backgroundColor: "rgba(255,255,255,0.06)", color: "var(--text-main)" }}
          >
            <RotateCcw size={13} /> {reverting ? "Reverting…" : "Revert"}
          </button>
        </div>
      ) : (
        <p className="text-[11px]" style={{ color: decision === "accepted" ? "var(--color-accent)" : "#e3b341" }}>
          {decision === "accepted" ? "Accepted — these changes are kept." : `Reverted to ${before?.gitSha.slice(0, 8) ?? "the previous checkpoint"}.`}
        </p>
      )}

      {diffError && <p className="text-[11px]" style={{ color: "#fca5a5" }}>{diffError}</p>}

      {files && files.length === 0 && <Empty text="The run's checkpoint recorded no file differences." />}
      {files && files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => {
            const isOpen = open === f.path;
            const chunk = chunks[f.path];
            return (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : f.path)}
                  className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] hover:bg-white/5"
                  aria-expanded={isOpen}
                >
                  {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <span className="min-w-0 flex-1 truncate font-mono" style={{ color: "var(--text-secondary)" }} title={f.path}>{f.path}</span>
                  <span className="shrink-0 font-mono" style={{ color: "#86efac" }}>{f.additions === null ? "bin" : `+${f.additions}`}</span>
                  <span className="shrink-0 font-mono" style={{ color: "#fca5a5" }}>{f.deletions === null ? "" : `-${f.deletions}`}</span>
                </button>
                {isOpen && chunk && (
                  <pre className="mt-1 max-h-72 overflow-auto rounded-md p-2 text-[10px] leading-4" style={{ backgroundColor: "rgba(0,0,0,0.35)" }}>
                    {chunk.split("\n").map((line, i) => (
                      <div key={i} style={{ color: lineColor(line) }}>{line || " "}</div>
                    ))}
                  </pre>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {truncated && <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>Diff truncated — open Code to see the full change.</p>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[11px] leading-4" style={{ color: "var(--text-muted)" }}>{text}</p>;
}
