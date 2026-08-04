"use client";

/**
 * YouTubeMediaHost — the physical mount point for the YouTube IFrame
 * player. Renders a <div> that the adapter attaches YT.Player to.
 *
 * This component must be rendered ONCE and kept mounted across
 * navigation. The parent controls visibility via CSS.
 */

import { useEffect, useRef } from "react";
import { useMediaHub } from "../MediaHubProvider";

export function YouTubeMediaHost({
  className,
  minHeight = 270,
}: {
  className?: string;
  minHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { mountYouTube, unmountYouTube } = useMediaHub();

  useEffect(() => {
    const div = containerRef.current;
    if (!div) return;

    // Create the inner div that YT.Player will replace with an iframe
    const playerDiv = document.createElement("div");
    playerDiv.style.width = "100%";
    playerDiv.style.height = "100%";
    div.appendChild(playerDiv);

    void mountYouTube(playerDiv);

    return () => {
      unmountYouTube();
      if (playerDiv.parentNode) {
        playerDiv.parentNode.removeChild(playerDiv);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: "100%",
        height: "100%",
        minHeight,
        position: "relative",
      }}
      data-testid="youtube-media-host"
    />
  );
}
