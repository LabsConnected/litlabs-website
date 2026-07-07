"use client";

import { useTheme } from "@/context/ThemeContext";
import { useWallet } from "@/context/WalletContext";
import { CircleDollarSign, Coins } from "lucide-react";

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
