"use client";

/**
 * MediaProviderTabs — provider switcher for all supported media sources.
 *
 * Switching tabs pauses the current provider and activates the
 * selected one. Never allows simultaneous playback.
 */

import { useMediaHub } from "./MediaHubProvider";
import type { MediaProviderId } from "./media-types";

const TABS: { id: MediaProviderId; label: string; icon: string }[] = [
  { id: "youtube", label: "YouTube", icon: "▶" },
  { id: "spotify", label: "Spotify", icon: "♫" },
  { id: "soundcloud", label: "SoundCloud", icon: "☁" },
  { id: "apple-music", label: "Apple", icon: "" },
  { id: "direct", label: "Audio", icon: "♪" },
  { id: "litt", label: "LiTT", icon: "✦" },
];

export function MediaProviderTabs() {
  const { activeProvider, switchProvider } = useMediaHub();

  return (
    <div className="flex shrink-0 items-center gap-1">
      {TABS.map((tab) => {
        const isActive = activeProvider === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => switchProvider(tab.id)}
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-bold transition-all"
            style={{
              color: isActive ? "var(--text-primary)" : "var(--text-muted)",
              backgroundColor: isActive ? "rgba(155,77,255,0.12)" : "transparent",
            }}
            aria-label={`Switch to ${tab.label}`}
            aria-pressed={isActive}
          >
            <span className="text-[11px]" aria-hidden>{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
