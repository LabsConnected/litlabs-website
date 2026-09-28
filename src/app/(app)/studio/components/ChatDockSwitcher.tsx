import React from "react";

export type ChatDockPosition = "left" | "bottom";

interface ChatDockSwitcherProps {
  /** Current dock position of the chat panel. */
  position: ChatDockPosition;
  /** Called when the user picks a different dock position. */
  onChange: (position: ChatDockPosition) => void;
  className?: string;
}

const OPTIONS: { position: ChatDockPosition; label: string; hint: string }[] = [
  { position: "left", label: "Left", hint: "Dock chat on the left side" },
  { position: "bottom", label: "Bottom", hint: "Dock chat on the bottom strip" },
];

/**
 * ChatDockSwitcher — segmented control that moves the LiTT chat panel
 * between the left dock and the bottom command strip.
 *
 * Purely presentational: the shell decides which surface mounts and keeps
 * chat state (transcript, draft, Chat/Live tab) mounted across switches.
 */
export default function ChatDockSwitcher({ position, onChange, className = "" }: ChatDockSwitcherProps) {
  return (
    <div
      data-testid="chat-dock-switcher"
      role="group"
      aria-label="Chat dock position"
      className={`flex items-center gap-0.5 rounded-lg border border-white/10 bg-black/30 p-0.5 ${className}`}
    >
      {OPTIONS.map((opt) => {
        const active = position === opt.position;
        return (
          <button
            key={opt.position}
            type="button"
            data-testid={`chat-dock-${opt.position}`}
            aria-pressed={active}
            title={opt.hint}
            onClick={() => {
              if (!active) onChange(opt.position);
            }}
            className={`rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
              active
                ? "bg-lime-400/20 text-lime-300"
                : "text-white/50 hover:bg-white/10 hover:text-white/80"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
