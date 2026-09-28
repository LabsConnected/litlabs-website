"use client";

/**
 * ChatDockSwitcher — Left / Bottom toggle for the LiTT chat dock position.
 *
 * Smallest-footprint control: two icon buttons, rendered both in the
 * LiTTPanel tab header (left-docked mode) and in the bottom strip header
 * (bottom-docked mode) so the user can always switch back.
 */

import { PanelBottom, PanelLeft } from "lucide-react";

export type ChatDockPosition = "left" | "bottom";

interface ChatDockSwitcherProps {
  position: ChatDockPosition;
  onChange: (position: ChatDockPosition) => void;
}

export default function ChatDockSwitcher({ position, onChange }: ChatDockSwitcherProps) {
  const options: {
    target: ChatDockPosition;
    label: string;
    testId: string;
    Icon: typeof PanelLeft;
  }[] = [
    { target: "left", label: "Dock chat left", testId: "chat-dock-left", Icon: PanelLeft },
    { target: "bottom", label: "Dock chat bottom", testId: "chat-dock-bottom", Icon: PanelBottom },
  ];
  return (
    <div
      className="flex items-center gap-0.5"
      role="group"
      aria-label="Chat dock position"
      data-testid="chat-dock-switcher"
    >
      {options.map(({ target, label, testId, Icon }) => (
        <button
          key={target}
          type="button"
          onClick={() => onChange(target)}
          className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10"
          style={{
            color: position === target ? "var(--color-accent)" : "var(--text-muted)",
            backgroundColor:
              position === target
                ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                : "transparent",
          }}
          aria-label={label}
          aria-pressed={position === target}
          data-testid={testId}
          title={label}
        >
          <Icon size={14} className="pointer-events-none" />
        </button>
      ))}
    </div>
  );
}
