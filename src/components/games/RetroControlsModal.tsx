"use client";

import { useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { X, Gamepad2, Keyboard } from "lucide-react";

const SYSTEM_CONTROLS: Record<
  string,
  { name: string; controls: { keys: string; action: string }[] }
> = {
  nes: {
    name: "NES / Famicom",
    controls: [
      { keys: "Arrow Keys", action: "D-Pad" },
      { keys: "Z", action: "A" },
      { keys: "X", action: "B" },
      { keys: "Enter", action: "Start" },
      { keys: "Shift", action: "Select" },
    ],
  },
  snes: {
    name: "SNES / Super Famicom",
    controls: [
      { keys: "Arrow Keys", action: "D-Pad" },
      { keys: "Z", action: "A" },
      { keys: "X", action: "B" },
      { keys: "A", action: "Y" },
      { keys: "S", action: "X" },
      { keys: "Q", action: "L" },
      { keys: "W", action: "R" },
      { keys: "Enter", action: "Start" },
      { keys: "Shift", action: "Select" },
    ],
  },
  gb: {
    name: "Game Boy",
    controls: [
      { keys: "Arrow Keys", action: "D-Pad" },
      { keys: "Z", action: "A" },
      { keys: "X", action: "B" },
      { keys: "Enter", action: "Start" },
      { keys: "Shift", action: "Select" },
    ],
  },
  gba: {
    name: "Game Boy Advance",
    controls: [
      { keys: "Arrow Keys", action: "D-Pad" },
      { keys: "Z", action: "A" },
      { keys: "X", action: "B" },
      { keys: "A", action: "L" },
      { keys: "S", action: "R" },
      { keys: "Enter", action: "Start" },
      { keys: "Shift", action: "Select" },
    ],
  },
  segaMD: {
    name: "Genesis / Mega Drive",
    controls: [
      { keys: "Arrow Keys", action: "D-Pad" },
      { keys: "Z", action: "A" },
      { keys: "X", action: "B" },
      { keys: "C", action: "C" },
      { keys: "A", action: "Y" },
      { keys: "S", action: "X" },
      { keys: "Enter", action: "Start" },
    ],
  },
};

export function RetroControlsModal({
  systemId,
  systemName,
  systemShort,
  open,
  onClose,
}: {
  systemId: string;
  systemName: string;
  systemShort: string;
  open: boolean;
  onClose: () => void;
}) {
  const { resolvedColors: T } = useTheme();
  const controls = SYSTEM_CONTROLS[systemId] ?? {
    name: systemName,
    controls: [
      { keys: "Arrow Keys", action: "D-Pad" },
      { keys: "Z / X", action: "Action buttons" },
      { keys: "Enter", action: "Start" },
    ],
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border p-5 shadow-2xl"
        style={{
          backgroundColor: `${T.bgColor}f5`,
          borderColor: `${T.borderColor}30`,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                backgroundColor: `${T.accentColor}15`,
                border: `1px solid ${T.accentColor}30`,
              }}
            >
              <Gamepad2 size={16} style={{ color: T.accentColor }} />
            </div>
            <div>
              <div className="text-sm font-black" style={{ color: T.textColor }}>
                {controls.name} controls
              </div>
              <div className="text-[10px]" style={{ color: T.textMuted }}>
                Keyboard mapping · {systemShort}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 transition hover:bg-white/10"
            style={{ color: T.textMuted }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-1.5">
          {controls.controls.map((c) => (
            <div
              key={c.action}
              className="flex items-center justify-between rounded-xl border px-3 py-2"
              style={{
                backgroundColor: `${T.boxBg}60`,
                borderColor: `${T.borderColor}20`,
              }}
            >
              <span className="text-xs font-bold" style={{ color: T.textColor }}>
                {c.action}
              </span>
              <span
                className="flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-mono font-bold"
                style={{
                  backgroundColor: `${T.boxBg}80`,
                  border: `1px solid ${T.borderColor}30`,
                  color: T.accentColor,
                }}
              >
                <Keyboard size={10} />
                {c.keys}
              </span>
            </div>
          ))}
        </div>

        <p className="mt-4 text-[10px] leading-relaxed" style={{ color: T.textMuted }}>
          Gamepad is also supported. Press the controller icon in the emulator menu to remap buttons.
        </p>
      </div>
    </div>
  );
}
