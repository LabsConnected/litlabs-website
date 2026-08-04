"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useRouter } from "next/navigation";

// ── Types ──

interface N8nHealth {
  configured: boolean;
  reachable: boolean;
  responseTime?: number;
}

type HealthState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: N8nHealth; checkedAt: Date }
  | { status: "error"; message: string; checkedAt: Date };

const ADMIN_USER_ID = process.env.NEXT_PUBLIC_ADMIN_USER_ID || "user_litbit";

// ── n8n Status Card ──

function N8nStatusCard() {
  const { resolvedColors: T } = useTheme();
  const [health, setHealth] = useState<HealthState>({ status: "idle" });

  const checkHealth = useCallback(async () => {
    setHealth({ status: "loading" });
    try {
      const res = await fetch("/api/n8n/health", { cache: "no-store" });
      if (!res.ok) {
        setHealth({
          status: "error",
          message: `Health check failed (${res.status})`,
          checkedAt: new Date(),
        });
        return;
      }
      const data = (await res.json()) as N8nHealth;
      setHealth({ status: "ok", data, checkedAt: new Date() });
    } catch (err) {
      setHealth({
        status: "error",
        message: err instanceof Error ? err.message : "Request failed",
        checkedAt: new Date(),
      });
    }
  }, []);

  useEffect(() => {
    checkHealth();
  }, [checkHealth]);

  const isLoading = health.status === "loading";
  const isOk = health.status === "ok";
  const isError = health.status === "error";

  const configured = isOk ? health.data.configured : false;
  const reachable = isOk ? health.data.reachable : false;
  const responseTime = isOk ? health.data.responseTime : undefined;
  const lastCheck = isOk || isError ? health.checkedAt : null;

  // Status dot color
  const dotColor = reachable
    ? "#22c55e"
    : configured
      ? T.warning
      : "#ef4444";
  const dotGlow = reachable ? `0 0 8px #22c55e` : "none";

  const statusLabel = isLoading
    ? "Checking..."
    : reachable
      ? "Connected"
      : configured
        ? "Configured — unreachable"
        : "Not configured";

  return (
    <div
      className="rounded-3xl border p-5"
      style={{
        backgroundColor: T.boxBg + "76",
        borderColor: T.borderColor + "24",
      }}
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div
            className="text-[10px] font-black uppercase tracking-[0.24em]"
            style={{ color: T.textMuted }}
          >
            Automation Gateway
          </div>
          <div className="mt-1 text-xl font-black">n8n Status</div>
        </div>
        <button
          onClick={checkHealth}
          disabled={isLoading}
          className="rounded-xl border px-3 py-1.5 text-xs font-bold transition-opacity disabled:opacity-50"
          style={{
            backgroundColor: T.accentColor + "12",
            borderColor: T.accentColor + "28",
            color: T.accentColor,
          }}
        >
          {isLoading ? "Checking..." : "Refresh"}
        </button>
      </div>

      {/* Status indicator */}
      <div className="flex items-center gap-3 rounded-2xl border p-3" style={{ borderColor: T.borderColor + "18" }}>
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ backgroundColor: dotColor, boxShadow: dotGlow }}
        />
        <span className="text-sm font-bold" style={{ color: T.textColor }}>
          {statusLabel}
        </span>
      </div>

      {/* Detail rows */}
      <div className="mt-4 space-y-2">
        <StatusRow label="Configured" value={isLoading ? "—" : configured ? "Yes" : "No"} color={configured ? "#22c55e" : "#ef4444"} muted={T.textMuted} />
        <StatusRow
          label="Reachable"
          value={isLoading ? "—" : reachable ? "Yes" : configured ? "No" : "—"}
          color={reachable ? "#22c55e" : configured ? T.warning : T.textMuted}
          muted={T.textMuted}
        />
        <StatusRow
          label="Response time"
          value={responseTime != null ? `${responseTime}ms` : "—"}
          color={T.textColor}
          muted={T.textMuted}
        />
        <StatusRow
          label="Last check"
          value={lastCheck ? lastCheck.toLocaleTimeString() : "—"}
          color={T.textColor}
          muted={T.textMuted}
        />
      </div>

      {/* Error message */}
      {isError && (
        <div
          className="mt-4 rounded-2xl border p-3 text-xs"
          style={{
            borderColor: "#ef444433",
            backgroundColor: "#ef444408",
            color: T.textColor,
          }}
        >
          {health.message}
        </div>
      )}

      {/* Security note */}
      <div className="mt-4 text-[10px]" style={{ color: T.textMuted }}>
        n8n editor and credentials are never exposed. Status reflects a real
        health-check ping to the private automation gateway.
      </div>
    </div>
  );
}

function StatusRow({
  label,
  value,
  color,
  muted,
}: {
  label: string;
  value: string;
  color: string;
  muted: string;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span style={{ color: muted }}>{label}</span>
      <span className="font-bold" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

// ── Owner Console Page ──

export default function OwnerConsole() {
  const { resolvedColors: T } = useTheme();
  const { userId, isLoaded, isSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoaded && (!isSignedIn || userId !== ADMIN_USER_ID)) {
      router.push("/");
    }
  }, [isLoaded, isSignedIn, userId, router]);

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen grid place-items-center"
        style={{ backgroundColor: T.bgColor, color: T.textMuted }}
      >
        Loading Owner Console...
      </div>
    );
  }

  if (!isSignedIn || userId !== ADMIN_USER_ID) {
    return (
      <div
        className="min-h-screen grid place-items-center"
        style={{ backgroundColor: T.bgColor }}
      >
        <div className="text-center">
          <p style={{ color: T.textMuted }}>Access Denied — Owner Only</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen p-4 sm:p-6"
      style={{
        background: `radial-gradient(circle at 10% 0%, ${T.accentColor}14, transparent 30%), radial-gradient(circle at 90% 10%, ${T.headerColor}12, transparent 28%), linear-gradient(180deg, ${T.bgColor}, ${T.boxBg})`,
        color: T.textColor,
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4">
        <header
          className="rounded-3xl border px-5 py-4 sm:px-6"
          style={{
            backgroundColor: T.boxBg + "78",
            borderColor: T.borderColor + "24",
          }}
        >
          <div className="text-[10px] font-black uppercase tracking-[0.24em]" style={{ color: T.textMuted }}>
            Owner Console
          </div>
          <div className="mt-1 text-2xl font-black sm:text-3xl">Automation & Integrations</div>
        </header>

        <N8nStatusCard />
      </div>
    </div>
  );
}
