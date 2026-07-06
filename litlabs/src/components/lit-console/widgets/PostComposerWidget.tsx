"use client";

import Link from "next/link";
import { Send } from "lucide-react";
import { LC } from "../lit-console-theme";

export function PostComposerWidget() {
  return (
    <div
      className="rounded-xl border p-3"
      style={{
        borderColor: `${LC.border}40`,
        backgroundColor: LC.bgPanel,
      }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div
          className="rounded-full flex items-center justify-center font-black shrink-0 text-[10px]"
          style={{
            width: 32,
            height: 32,
            background: `hsl(210,60%,35%)`,
            color: `hsl(210,80%,85%)`,
          }}
        >
          U
        </div>
        <input
          readOnly
          placeholder="Neural broadcast..."
          onClick={() => (window.location.href = "/social")}
          className="flex-1 px-3 py-2 rounded-lg text-sm cursor-pointer outline-none"
          style={{
            backgroundColor: LC.bgSecondary,
            border: `1px solid ${LC.border}40`,
            color: LC.textMuted,
          }}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          {[
            { label: "Focused", color: LC.accentCyan },
            { label: "Broadcast", color: LC.accentOrange },
          ].map((b) => (
            <button
              key={b.label}
              onClick={() => (window.location.href = "/social")}
              className="px-2.5 py-1 rounded text-[10px] font-bold border transition-all hover:scale-105"
              style={{
                borderColor: `${b.color}30`,
                color: b.color,
                backgroundColor: `${b.color}08`,
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
        <Link
          href="/social"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black transition-all hover:scale-105"
          style={{ backgroundColor: LC.accentCyan, color: "#000" }}
        >
          <Send size={10} /> Post
        </Link>
      </div>
    </div>
  );
}
