"use client";

/**
 * SpotifyMediaHost — the physical mount point for the Spotify Embed
 * iFrame controller. Renders a <div> that the adapter attaches the
 * Spotify embed to.
 */

import { useEffect, useRef } from "react";
import { useMediaHub } from "../MediaHubProvider";

export function SpotifyMediaHost({
  className,
  minHeight = 272,
}: {
  className?: string;
  minHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { mountSpotify, unmountSpotify } = useMediaHub();

  useEffect(() => {
    const div = containerRef.current;
    if (!div) return;

    const embedDiv = document.createElement("div");
    embedDiv.style.width = "100%";
    embedDiv.style.height = "100%";
    div.appendChild(embedDiv);

    void mountSpotify(embedDiv);

    return () => {
      unmountSpotify();
      if (embedDiv.parentNode) {
        embedDiv.parentNode.removeChild(embedDiv);
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
      data-testid="spotify-media-host"
    />
  );
}
