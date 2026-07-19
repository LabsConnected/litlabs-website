"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Loader2, ArrowRight, AlertCircle, CheckCircle2 } from "lucide-react";

interface Installation {
  id: number;
  account: string | null;
  repositorySelection: string;
  repositoriesUrl: string;
}

export default function GitHubSetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { tokens } = useTheme();
  const [loading, setLoading] = useState(true);
  const [installations, setInstallations] = useState<Installation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  const installedParam = searchParams.get("installed");
  const errorParam = searchParams.get("error");

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace("/sign-in?redirect_url=/studio/github");
      return;
    }

    if (errorParam) {
      setError(errorParam);
      setLoading(false);
      return;
    }

    fetch("/api/github/installations")
      .then(async (res) => {
        if (res.status === 503) {
          setUnconfigured(true);
          setLoading(false);
          return;
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "GitHub connection failed");
        }
        const data = await res.json();
        setInstallations(data.installations || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Unknown error");
        setLoading(false);
      });
  }, [isLoaded, isSignedIn, router, errorParam]);

  const startInstall = () => {
    window.location.href = "/api/github/install";
  };

  return (
    <div
      className="flex min-h-dvh items-center justify-center p-6"
      style={{ backgroundColor: tokens.background }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-6 text-center"
        style={{
          backgroundColor: tokens.surface,
          borderColor: `${tokens.primary}30`,
        }}
      >
        <div
          className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ backgroundColor: `${tokens.primary}15` }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="currentColor"
            style={{ color: tokens.primary }}
          >
            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z" />
          </svg>
        </div>
        <h1 className="mb-2 text-lg font-black" style={{ color: tokens.text }}>
          Connect GitHub
        </h1>
        <p
          className="mb-6 text-xs leading-relaxed"
          style={{ color: tokens.textMuted }}
        >
          Install the LiTTree LabStudios GitHub App to let LiTT read, write, and
          deploy repositories on your behalf.
        </p>

        {installedParam && (
          <div
            className="mb-4 flex items-center justify-center gap-2 rounded-xl border p-3 text-xs font-bold"
            style={{
              borderColor: `${tokens.primary}40`,
              backgroundColor: `${tokens.primary}10`,
              color: tokens.primary,
            }}
          >
            <CheckCircle2 size={14} /> GitHub App installed (ID: {installedParam})
          </div>
        )}

        {loading && (
          <div
            className="flex items-center justify-center gap-2 text-xs"
            style={{ color: tokens.textMuted }}
          >
            <Loader2 size={14} className="animate-spin" /> Checking configuration…
          </div>
        )}

        {unconfigured && (
          <div className="space-y-4 text-left">
            <div
              className="rounded-xl border border-dashed p-4 text-xs"
              style={{ borderColor: tokens.border, color: tokens.textMuted }}
            >
              <div
                className="mb-2 flex items-center gap-2 font-bold"
                style={{ color: tokens.warning }}
              >
                <AlertCircle size={14} /> GitHub App not configured
              </div>
              The server is missing <code>GITHUB_APP_ID</code> and{" "}
              <code>GITHUB_PRIVATE_KEY</code>. Create a GitHub App and add the
              environment variables to Vercel, then redeploy.
            </div>
            <button
              onClick={() =>
                window.open("https://github.com/organizations/LabsConnected/settings/apps", "_blank")
              }
              className="w-full rounded-xl py-2.5 text-xs font-black transition hover:opacity-90"
              style={{
                backgroundColor: tokens.primary,
                color: tokens.text,
              }}
            >
              Open GitHub App Settings
            </button>
          </div>
        )}

        {!loading && !unconfigured && (
          <div className="space-y-4">
            {installations.length > 0 && (
              <div className="space-y-2 text-left">
                {installations.map((inst) => (
                  <div
                    key={inst.id}
                    className="flex items-center gap-2 rounded-xl border p-3 text-xs"
                    style={{ borderColor: `${tokens.primary}30`, color: tokens.text }}
                  >
                    <CheckCircle2 size={14} style={{ color: tokens.primary }} />
                    <span className="font-bold">{inst.account || "Unknown"}</span>
                    <span style={{ color: tokens.textMuted }}>
                      ({inst.repositorySelection})
                    </span>
                  </div>
                ))}
              </div>
            )}

            {error && (
              <div
                className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs"
                style={{ color: tokens.warning }}
              >
                {error}
              </div>
            )}

            <button
              onClick={startInstall}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black transition hover:opacity-90"
              style={{ backgroundColor: tokens.primary, color: tokens.text }}
            >
              {installations.length > 0 ? "Reinstall GitHub App" : "Install GitHub App"} <ArrowRight size={14} />
            </button>
          </div>
        )}

        <div className="mt-6 text-[10px]" style={{ color: tokens.textMuted }}>
          After installation, choose <strong>Only select repositories</strong>{" "}
          to control exactly what LiTT can access.
        </div>
      </div>
    </div>
  );
}
