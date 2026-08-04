"use client";

/**
 * SoundCloudMediaHost — the physical mount point for the SoundCloud
 * Widget iframe. Renders a <div> that the adapter attaches the iframe to.
 */

import { useEffect, useRef } from "react";
import { useMediaHub } from "../MediaHubProvider";

export function SoundCloudMediaHost({
  className,
  minHeight = 166,
}: {
  className?: string;
  minHeight?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { mountSoundCloud, unmountSoundCloud } = useMediaHub();

  useEffect(() => {
    const div = containerRef.current;
    if (!div) return;

    void mountSoundCloud(div);

    return () => {
      unmountSoundCloud();
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
      data-testid="soundcloud-media-host"
    />
  );
}
