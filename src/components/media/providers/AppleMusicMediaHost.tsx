"use client";

/**
 * AppleMusicMediaHost — the physical mount point for Apple MusicKit JS.
 * MusicKit doesn't use an iframe; it creates its own audio element.
 * This host provides a container div for the adapter.
 */

import { useEffect, useRef } from "react";
import { useMediaHub } from "../MediaHubProvider";

export function AppleMusicMediaHost({
  className,
  minHeight = 100,
}: {
  className?: string;
  minHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { mountAppleMusic, unmountAppleMusic } = useMediaHub();

  useEffect(() => {
    const div = containerRef.current;
    if (!div) return;

    void mountAppleMusic(div);

    return () => {
      unmountAppleMusic();
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
      data-testid="apple-music-media-host"
    />
  );
}
