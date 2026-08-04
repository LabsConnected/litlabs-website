"use client";

/**
 * YouTubePlayerHost — the actual YouTube IFrame player mount point.
 *
 * This component renders a <div> that the YT.Player attaches to.
 * It must be rendered ONCE and kept mounted across navigation.
 * The parent (YouTubeDock or YouTubeMiniPlayer) controls visibility.
 *
 * The player div is created in a ref and the controller is told to
 * create the player on mount. On unmount, the controller destroys it.
 */

import { useEffect, useRef } from "react";
import { useYouTubePlayer } from "@/context/YouTubePlayerContext";

export function YouTubePlayerHost({
  className,
  rounded = true,
}: {
  className?: string;
  rounded?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const { mountPlayer, unmountPlayer } = useYouTubePlayer();

  useEffect(() => {
    if (!containerRef.current) return;

    // Create the player div that YT.Player will replace
    const div = document.createElement("div");
    div.style.width = "100%";
    div.style.height = "100%";
    containerRef.current.appendChild(div);
    playerDivRef.current = div;

    // Tell the controller to create the player
    void mountPlayer(div);

    return () => {
      unmountPlayer();
      if (div.parentElement) {
        div.parentElement.removeChild(div);
      }
      playerDivRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={`${rounded ? "rounded-xl overflow-hidden" : ""} ${className ?? ""}`}
      style={{ minHeight: 200 }}
    />
  );
}
