"use client";

import { useEffect } from "react";
import { X, Gamepad2, Keyboard } from "lucide-react";

const SYSTEM_CONTROLS: Record<
  string,
  {
    name: string;
    controls: { keys: string; action: string }[];
    xbox: { button: string; action: string }[];
  }
> = {
  nes: {
    name: "NES / Famicom",
    controls: [
      { keys: "Arrow Keys", action: "D-Pad" },
      { keys: "Z", action: "A (B)" },
      { keys: "X", action: "B (A)" },
      { keys: "Enter", action: "Start" },
      { keys: "Shift", action: "Select" },
    ],
    xbox: [
      { button: "A", action: "A (B)" },
      { button: "X", action: "B (A)" },
      { button: "Start", action: "Start" },
      { button: "Back", action: "Select" },
      { button: "D-Pad", action: "D-Pad" },
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
    xbox: [
      { button: "A", action: "A" },
      { button: "B", action: "B" },
      { button: "X", action: "Y" },
      { button: "Y", action: "X" },
      { button: "LB", action: "L" },
      { button: "RB", action: "R" },
      { button: "Start", action: "Start" },
      { button: "Back", action: "Select" },
      { button: "D-Pad", action: "D-Pad" },
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
    xbox: [
      { button: "A", action: "A" },
      { button: "X", action: "B" },
      { button: "Start", action: "Start" },
      { button: "Back", action: "Select" },
      { button: "D-Pad", action: "D-Pad" },
    ],
  },
  gbc: {
    name: "Game Boy Color",
    controls: [
      { keys: "Arrow Keys", action: "D-Pad" },
      { keys: "Z", action: "A" },
      { keys: "X", action: "B" },
      { keys: "Enter", action: "Start" },
      { keys: "Shift", action: "Select" },
    ],
    xbox: [
      { button: "A", action: "A" },
      { button: "X", action: "B" },
      { button: "Start", action: "Start" },
      { button: "Back", action: "Select" },
      { button: "D-Pad", action: "D-Pad" },
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
    xbox: [
      { button: "A", action: "A" },
      { button: "X", action: "B" },
      { button: "LB", action: "L" },
      { button: "RB", action: "R" },
      { button: "Start", action: "Start" },
      { button: "Back", action: "Select" },
      { button: "D-Pad", action: "D-Pad" },
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
    xbox: [
      { button: "A", action: "A" },
      { button: "B", action: "B" },
      { button: "X", action: "C" },
      { button: "Y", action: "Y" },
      { button: "LB", action: "X" },
      { button: "Start", action: "Start" },
      { button: "D-Pad", action: "D-Pad" },
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#0a0b12] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10">
              <Gamepad2 size={16} className="text-fuchsia-300" />
            </div>
            <div>
              <div className="text-sm font-black text-white">
                {controls.name} controls
              </div>
              <div className="text-[10px] text-white/45">
                Keyboard mapping · {systemShort}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
            aria-label="Close controls"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 space-y-1.5">
          {controls.controls.map((c) => (
            <div
              key={c.action}
              className="flex items-center justify-between rounded-xl border border-white/8 bg-white/3 px-3 py-2"
            >
              <span className="text-xs font-bold text-white/85">
                {c.action}
              </span>
              <span className="flex items-center gap-1 rounded-md border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[10px] font-bold text-fuchsia-300">
                <Keyboard size={10} />
                {c.keys}
              </span>
            </div>
          ))}
        </div>

        {/* ─── Xbox Controller Section ────────────────────────── */}
        <div className="mt-4 flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md border border-indigo-400/30 bg-indigo-400/10">
            <Gamepad2 size={13} className="text-indigo-300" />
          </div>
          <span className="text-[10px] font-black uppercase tracking-wider text-indigo-200/80">
            Xbox Controller
          </span>
        </div>
        <div className="mt-2 space-y-1.5">
          {controls.xbox.map((c) => (
            <div
              key={c.action}
              className="flex items-center justify-between rounded-xl border border-white/8 bg-white/3 px-3 py-2"
            >
              <span className="text-xs font-bold text-white/85">
                {c.action}
              </span>
              <span className="flex items-center gap-1 rounded-md border border-white/10 bg-indigo-950/60 px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-300">
                <Gamepad2 size={10} />
                {c.button}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
