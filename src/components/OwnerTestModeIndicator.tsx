"use client";

/**
 * OwnerTestModeIndicator — a floating badge + dropdown that lets the
 * platform owner switch between testing as OWNER, Starter, Creator,
 * Pro Builder, or Zero-BITS.
 *
 * Only renders for the platform owner. Fetches state from
 * /api/owner/test-mode and POSTs to change simulation.
 *
 * The simulation sets a cookie that only affects entitlement resolution —
 * it NEVER modifies Stripe or the real subscription.
 */

import { useEffect, useState, useRef } from "react";
import { FlaskConical, ChevronDown, Check, X } from "lucide-react";

type SimulatedPlan = "owner" | "starter" | "creator_beta" | "pro_builder_beta" | "zero_bits";

interface TestModeState {
  isOwner: boolean;
  simulation: SimulatedPlan | null;
  options: { value: SimulatedPlan; label: string; description: string }[];
}

export function OwnerTestModeIndicator() {
  const [state, setState] = useState<TestModeState | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/owner/test-mode", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.isOwner) {
          setState(data);
        }
      })
      .catch(() => {
        // Not owner or not authenticated — silently hide
      });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!state?.isOwner) return null;

  const activeSim = state.simulation ?? "owner";
  const isTestMode = state.simulation !== null && state.simulation !== "owner";

  async function changeSimulation(sim: SimulatedPlan) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/owner/test-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ simulation: sim }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to change simulation");
      }
      const data = await res.json();
      setState((prev) => (prev ? { ...prev, simulation: data.simulation } : prev));
      setOpen(false);
      // Reload to ensure all server components pick up the new cookie
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  const badgeColor = isTestMode ? "#f59e0b" : "#10b981";
  const badgeBg = isTestMode ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.15)";

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        fontFamily: "inherit",
      }}
    >
      {/* Badge button */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px",
          borderRadius: 8,
          border: `1px solid ${badgeColor}40`,
          background: badgeBg,
          color: badgeColor,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          backdropFilter: "blur(8px)",
        }}
      >
        <FlaskConical size={14} />
        {isTestMode ? `TEST: ${activeSim.toUpperCase()}` : "OWNER"}
        <ChevronDown size={12} style={{ opacity: 0.6 }} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            right: 0,
            marginBottom: 8,
            minWidth: 280,
            borderRadius: 12,
            border: "1px solid var(--studio-border, #333)",
            background: "var(--studio-bg, #1a1a1a)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            padding: 8,
            backdropFilter: "blur(12px)",
          }}
        >
          <div
            style={{
              padding: "8px 12px 4px",
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              opacity: 0.5,
              letterSpacing: 0.5,
            }}
          >
            Testing as
          </div>
          {(state.options ?? []).map((opt) => {
            const isActive = activeSim === opt.value;
            const isZeroBits = opt.value === "zero_bits";
            return (
              <button
                key={opt.value}
                onClick={() => changeSimulation(opt.value)}
                disabled={loading}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: isActive
                    ? isZeroBits
                      ? "rgba(239,68,68,0.15)"
                      : "rgba(168,85,247,0.15)"
                    : "transparent",
                  color: "inherit",
                  cursor: loading ? "wait" : "pointer",
                  textAlign: "left",
                  fontSize: 13,
                  opacity: loading ? 0.6 : 1,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                    {opt.label}
                    {isActive && <Check size={12} style={{ opacity: 0.7 }} />}
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>{opt.description}</div>
                </div>
              </button>
            );
          })}
          {error && (
            <div
              style={{
                padding: "8px 12px",
                margin: "4px 0",
                fontSize: 11,
                color: "#ef4444",
                background: "rgba(239,68,68,0.1)",
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <X size={12} />
              {error}
            </div>
          )}
          <div
            style={{
              padding: "6px 12px",
              marginTop: 4,
              fontSize: 10,
              opacity: 0.4,
              borderTop: "1px solid var(--studio-border, #333)",
            }}
          >
            Simulation never modifies Stripe. Reload to apply.
          </div>
        </div>
      )}
    </div>
  );
}
