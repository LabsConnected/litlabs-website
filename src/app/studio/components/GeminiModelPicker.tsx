"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export type ChatModelSelection = {
  provider: "google" | "auto";
  model: string;
  label: string;
};

export const DEFAULT_GEMINI_MODEL: ChatModelSelection = {
  provider: "google",
  model: process.env.NEXT_PUBLIC_GEMINI_MODEL || "gemini-2.5-flash",
  label: "Gemini Fast",
};

export const GEMINI_MODELS: readonly ChatModelSelection[] = [
  { provider: "auto", model: "", label: "Auto Best" },
  DEFAULT_GEMINI_MODEL,
  { provider: "google", model: "gemini-2.5-pro", label: "Gemini Pro" },
];

type Props = {
  value: ChatModelSelection;
  onChange: (model: ChatModelSelection) => void;
};

export default function GeminiModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-black text-emerald-200 transition hover:bg-emerald-400/15"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
        <span className="max-w-24 truncate">{value.label}</span>
        <ChevronDown className="pointer-events-none" size={12} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Chat model"
          className="fixed left-3 right-3 top-14 z-[110] overflow-hidden rounded-2xl border border-white/10 bg-[#0b0f1a]/98 p-2 shadow-2xl backdrop-blur-xl md:absolute md:left-0 md:right-auto md:top-full md:mt-2 md:w-64"
        >
          {GEMINI_MODELS.map((model) => {
            const active = model.provider === value.provider && model.model === value.model;
            return (
              <button
                key={`${model.provider}-${model.model || "auto"}`}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(model);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-xs transition hover:bg-white/10"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
                <span className="flex-1 font-bold text-white">{model.label}</span>
                {active && <Check className="pointer-events-none text-emerald-300" size={13} aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
