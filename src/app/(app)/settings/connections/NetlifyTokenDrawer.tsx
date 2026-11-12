"use client";

/**
 * NetlifyTokenDrawer — connect the user's own Netlify account with a
 * personal access token. Mirrors GitHubPATDrawer: the token goes straight
 * to /api/netlify/token, which verifies it against Netlify before
 * storing it in the shared credential store. The stored token is never
 * read back into the client.
 */
import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Loader2, X, Check, AlertCircle, KeyRound, ExternalLink } from "lucide-react";

export default function NetlifyTokenDrawer({
  open,
  onClose,
  onConnectionChange,
}: {
  open: boolean;
  onClose: () => void;
  onConnectionChange?: () => void;
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
      const res = await fetch("/api/netlify/token", {
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
      const res = await fetch("/api/netlify/token", {
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
      onConnectionChange?.();
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleDisconnect = async () => {
    setStatus("saving");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/netlify/token", {
        method: "DELETE",
        credentials: "include",
        headers: await authHeaders(),
      });
      if (res.ok) {
        setIsConnected(false);
        setAccountName(null);
        setStatus("idle");
        onConnectionChange?.();
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
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className="relative w-full max-w-md rounded-2xl border p-6 shadow-2xl"
        style={{
          backgroundColor: T.boxBg,
          borderColor: `${T.borderColor}40`,
        }}
      >
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
                Netlify Personal Access Token
              </h2>
              <p className="text-[10px] opacity-50">Publish Studio projects to your own Netlify account</p>
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

        {checking && (
          <div className="flex items-center justify-center gap-2 py-6 text-xs opacity-50">
            <Loader2 size={14} className="animate-spin" /> Checking connection…
          </div>
        )}

        {!checking && isConnected && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
              <Check size={14} /> Netlify connected as <strong>{accountName}</strong>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={status === "saving"}
              className="w-full rounded-xl border border-red-500/30 bg-red-500/5 py-2.5 text-xs font-bold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              {status === "saving" ? "Disconnecting…" : "Disconnect"}
            </button>
            <div className="rounded-xl border p-3" style={{ borderColor: `${T.borderColor}40` }}>
              <label className="mb-1.5 block text-[10px] font-bold opacity-60">
                Update Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste new token to replace the current one"
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
              <button
                onClick={() => void handleSave()}
                disabled={!token.trim() || status === "saving"}
                className="mt-2 w-full rounded-xl py-2.5 text-xs font-bold transition disabled:opacity-50"
                style={{ backgroundColor: T.accentColor, color: "#000" }}
              >
                {status === "saving" ? "Saving…" : "Save New Token"}
              </button>
              {status === "error" && errorMsg && (
                <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" /> {errorMsg}
                </div>
              )}
              {status === "success" && (
                <div className="mt-2 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
                  <Check size={14} /> Token updated!
                </div>
              )}
            </div>
          </div>
        )}

        {!checking && !isConnected && (
          <div className="space-y-4">
            {status === "success" && (
              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
                <Check size={14} /> Token saved! Connected as <strong>{accountName}</strong>
              </div>
            )}
            {status === "error" && errorMsg && (
              <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
                <AlertCircle size={14} className="mt-0.5 shrink-0" /> {errorMsg}
              </div>
            )}
            <div>
              <label className="mb-1.5 block text-[10px] font-bold opacity-60">
                Personal Access Token
              </label>
              <input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your Netlify personal access token"
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
              <a
                href="https://app.netlify.com/user/applications#personal-access-tokens"
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold underline-offset-2 hover:underline"
                style={{ color: T.accentColor }}
              >
                Create a token in Netlify <ExternalLink size={11} />
              </a>
              <p className="mt-2 text-[11px] opacity-50">
                The token is verified with Netlify, then stored in LiTT&apos;s secure
                credential store. It is used only to publish your projects to your
                own Netlify sites, and every publish still asks for your approval.
              </p>
            </div>
            <button
              onClick={() => void handleSave()}
              disabled={!token.trim() || status === "saving"}
              className="w-full rounded-xl py-2.5 text-xs font-bold transition disabled:opacity-50"
              style={{ backgroundColor: T.accentColor, color: "#000" }}
            >
              {status === "saving" ? "Verifying & Saving…" : "Connect Netlify"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
