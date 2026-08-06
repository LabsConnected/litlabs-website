"use client";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Loader2, X, Check, AlertCircle, KeyRound, ExternalLink } from "lucide-react";

export default function GitHubPATDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { resolvedColors: T } = useTheme();
  const { getToken } = useClerkAuth();
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [checking, setChecking] = useState(true);

  const authHeaders = useCallback(async (json = false): Promise<HeadersInit> => {
    const t = await getToken?.();
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    };
  }, [getToken]);

  const checkStatus = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/github/pat", {
        credentials: "include",
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json() as { connected: boolean; accountName?: string };
        setIsConnected(data.connected);
        setAccountName(data.accountName || null);
      }
    } catch {
      // ignore
    } finally {
      setChecking(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    if (open) {
      setToken("");
      setStatus("idle");
      setErrorMsg(null);
      void checkStatus();
    }
  }, [open, checkStatus]);

  const handleSave = async () => {
    if (!token.trim()) return;
    setStatus("saving");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/github/pat", {
        method: "POST",
        credentials: "include",
        headers: await authHeaders(true),
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json() as { error?: string; accountName?: string; success?: boolean };
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Failed to save token");
        return;
      }
      setStatus("success");
      setAccountName(data.accountName || null);
      setIsConnected(true);
      setToken("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleDisconnect = async () => {
    setStatus("saving");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/github/pat", {
        method: "DELETE",
        credentials: "include",
        headers: await authHeaders(),
      });
      if (res.ok) {
        setIsConnected(false);
        setAccountName(null);
        setStatus("idle");
      } else {
        const data = await res.json() as { error?: string };
        setStatus("error");
        setErrorMsg(data.error || "Failed to disconnect");
      }
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="relative w-full max-w-md rounded-2xl border p-6 shadow-2xl"
        style={{
          backgroundColor: T.boxBg,
          borderColor: `${T.borderColor}40`,
        }}
      >
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: `${T.accentColor}15` }}
            >
              <KeyRound size={18} style={{ color: T.accentColor }} />
            </div>
            <div>
              <h2 className="text-sm font-black" style={{ color: T.headerColor }}>
                GitHub Personal Access Token
              </h2>
              <p className="text-[10px] opacity-50">Connect via API key (alternative to GitHub App)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 opacity-50 transition hover:opacity-100"
            style={{ color: T.textColor }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Checking state */}
        {checking && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs opacity-50">
            <Loader2 size={14} className="animate-spin" /> Checking connection…
          </div>
        )}

        {/* Connected state */}
        {!checking && isConnected && (
          <div className="space-y-4">
            <div
              className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400"
            >
              <Check size={14} /> GitHub connected as <strong>{accountName}</strong>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={status === "saving"}
              className="w-full rounded-xl border border-red-500/30 bg-red-500/5 py-2.5 text-xs font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              {status === "saving" ? "Disconnecting…" : "Disconnect"}
            </button>
          </div>
        )}

        {/* Input state */}
        {!checking && !isConnected && (
          <div className="space-y-4">
            {/* Success message */}
            {status === "success" && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
                <Check size={14} /> Token saved! Connected as <strong>{accountName}</strong>
              </div>
            )}

            {/* Error message */}
            {status === "error" && errorMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                <AlertCircle size={14} className="mt-0.5 shrink-0" /> {errorMsg}
              </div>
            )}

            {/* Token input */}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold opacity-60">
                Personal Access Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="w-full rounded-xl border px-3 py-2.5 text-xs outline-none transition"
                style={{
                  borderColor: T.borderColor,
                  backgroundColor: T.bgColor,
                  color: T.textColor,
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && token.trim() && status !== "saving") {
                    void handleSave();
                  }
                }}
              />
              <p className="mt-1.5 text-[10px] opacity-40">
                Token is encrypted at rest and never exposed to the browser.
              </p>
            </div>

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={!token.trim() || status === "saving"}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black transition hover:opacity-90 disabled:opacity-30"
              style={{ backgroundColor: T.accentColor, color: "#000" }}
            >
              {status === "saving" ? (
                <><Loader2 size={12} className="animate-spin" /> Verifying & saving…</>
              ) : (
                <>Connect GitHub</>
              )}
            </button>

            {/* Help link */}
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 text-[10px] opacity-50 transition hover:opacity-80"
            >
              Create a token at github.com/settings/tokens <ExternalLink size={10} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
