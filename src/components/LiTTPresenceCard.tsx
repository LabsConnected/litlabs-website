"use client";

import Image from "next/image";

export function LiTTPresenceCard({
  status = "online",
  activeAgent = "litt",
  onCloseAction,
}: {
  status?: "online" | "offline" | "busy";
  activeAgent?: "litt" | "spark";
  onCloseAction?: () => void;
}) {
  const statusColor =
    status === "online" ? "#22c55e" : status === "busy" ? "#f59e0b" : "#64748b";

  return (
    <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-white/8 bg-black/30 p-2.5">
      <div className="relative shrink-0">
        <Image
          src="/brand/litt-mascot-avatar.png"
          alt="LiTT"
          width={36}
          height={36}
          className="rounded-lg"
          unoptimized
        />
        <span
          className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-black"
          style={{ backgroundColor: statusColor }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-black text-white">
          {activeAgent === "spark" ? "Spark" : "LiTT"}
        </p>
        <p className="truncate text-[9px] text-white/40">
          {status === "online" ? "Ready to help" : status === "busy" ? "Working…" : "Offline"}
        </p>
      </div>
      {onCloseAction && (
        <button
          onClick={onCloseAction}
          className="shrink-0 rounded-lg p-1 text-white/30 hover:bg-white/8 hover:text-white"
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
