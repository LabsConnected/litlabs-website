"use client";

import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { CircleDollarSign, Coins, Bot, Zap, Image, Clock, ArrowRight } from "lucide-react";
import { LC } from "@/components/lit-console/lit-console-theme";

export type InspectorTab = "credits";

/**
 * StudioInspector — right rail wallet/status panel.
 *
 * On mobile this same component is rendered inside a slide-up sheet
 * controlled by the parent. The "variant" prop switches between
 * inline-aside and sheet.
 */
export default function StudioInspector({
  variant = "aside",
  onClose,
  T,
}: {
  variant?: "aside" | "sheet";
  onClose?: () => void;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const isSheet = variant === "sheet";

  return (
    <div
      className={
        isSheet
          ? "flex flex-col w-full max-h-[80vh]"
          : "hidden lg:flex flex-col w-[340px] shrink-0 border-l h-full"
      }
      style={
        isSheet
          ? {}
          : {
              backgroundColor: T.boxBg + "70",
              borderColor: T.borderColor + "20",
              backdropFilter: "blur(14px) saturate(180%)",
            }
      }
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-4 h-12 shrink-0"
        style={{ borderBottom: `1px solid ${T.borderColor}18` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <CircleDollarSign size={15} style={{ color: T.accentColor }} />
          <span
            className="text-xs font-black uppercase tracking-[0.18em] truncate"
            style={{ color: T.headerColor }}
          >
            Credits
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-white/10"
            style={{ color: T.textMuted }}
            aria-label="Close inspector"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <CreditsTab T={T} />

        {/* Active Agent */}
        <div
          className="rounded-2xl border p-4 space-y-3"
          style={{ backgroundColor: T.boxBg + "60", borderColor: T.borderColor + "25" }}
        >
          <div className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: T.textMuted }}>
            Active Agent
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-xl border"
              style={{ backgroundColor: T.accentColor + "15", borderColor: T.accentColor + "30", color: T.accentColor }}
            >
              <Bot size={20} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-black" style={{ color: T.textColor }}>
                LiTTree
              </div>
              <div className="text-[10px] truncate" style={{ color: T.textMuted }}>
                Core OS Agent · Always Free
              </div>
            </div>
            <div className="ml-auto flex h-2 w-2 rounded-full" style={{ backgroundColor: "#22c55e" }} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["Build", "Image", "Code", "Deploy"].map((skill) => (
              <span
                key={skill}
                className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                style={{ backgroundColor: T.accentColor + "12", color: T.accentColor, border: `1px solid ${T.accentColor}25` }}
              >
                {skill}
              </span>
            ))}
          </div>
        </div>

        {/* Recent outputs */}
        <div
          className="rounded-2xl border p-4 space-y-3"
          style={{ backgroundColor: T.boxBg + "60", borderColor: T.borderColor + "25" }}
        >
          <div className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: T.textMuted }}>
            Recent Outputs
          </div>
          {[
            { icon: Image, label: "Last image", status: "No recent image", color: "#e879f9" },
            { icon: Zap, label: "Last build", status: "No recent build", color: "#fbbf24" },
            { icon: Clock, label: "Last run", status: "No recent run", color: LC.accentCyan },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex items-center gap-3">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ backgroundColor: `${item.color}10`, color: item.color }}
                >
                  <Icon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold" style={{ color: T.textColor }}>
                    {item.label}
                  </div>
                  <div className="text-[10px]" style={{ color: T.textMuted }}>
                    {item.status}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Next best action */}
        <div
          className="rounded-2xl border p-4 relative overflow-hidden"
          style={{ background: `linear-gradient(135deg, ${T.linkColor}15, ${T.accentColor}08)`, borderColor: `${T.linkColor}40` }}
        >
          <div className="text-[9px] font-black uppercase tracking-[0.18em] mb-2" style={{ color: T.textMuted }}>
            Suggested Next Step
          </div>
          <div className="text-sm font-black mb-1" style={{ color: T.textColor }}>
            Generate a hero image
          </div>
          <div className="text-[11px] mb-3" style={{ color: T.textMuted }}>
            Start with a visual so LiTTree can brand your next build.
          </div>
          <button
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
            style={{ color: T.linkColor }}
          >
            Try it <ArrowRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Credits tab ─────────────────────────────────────────────── */
function CreditsTab({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const { balance, isLoading } = useWallet();
  return (
    <div className="space-y-3">
      <div
        className="rounded-2xl border p-4 relative overflow-hidden"
        style={{
          background: `linear-gradient(135deg, ${T.accentColor}20, ${T.linkColor}10)`,
          borderColor: T.accentColor + "40",
        }}
      >
        <div
          className="text-[9px] font-bold uppercase tracking-[0.2em]"
          style={{ color: T.textMuted }}
        >
          LiTBit Coins
        </div>
        <div className="flex items-baseline gap-1.5 mt-1">
          <Coins size={16} style={{ color: T.accentColor }} />
          <span className="text-2xl font-black" style={{ color: T.textColor }}>
            {isLoading ? "—" : balance.toLocaleString()}
          </span>
          <span
            className="text-[10px] uppercase tracking-wider opacity-60"
            style={{ color: T.textMuted }}
          >
            LBC
          </span>
        </div>
      </div>
    </div>
  );
}
