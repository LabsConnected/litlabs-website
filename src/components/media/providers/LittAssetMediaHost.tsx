"use client";

/**
 * LittAssetMediaHost — the mount point for the LittAssetAdapter.
 * Same as DirectAudioMediaHost but for LiTT-generated R2 assets.
 * The adapter creates a hidden <audio> element inside this container.
 */

import { useEffect, useRef } from "react";
import { useMediaHub } from "../MediaHubProvider";

export function LittAssetMediaHost({
  className,
}: {
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { mountLittAsset, unmountLittAsset } = useMediaHub();

  useEffect(() => {
    const div = containerRef.current;
    if (!div) return;

    void mountLittAsset(div);

    return () => {
      unmountLittAsset();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: "0",
        height: "0",
        overflow: "hidden",
        position: "absolute",
        pointerEvents: "none",
      }}
      aria-hidden="true"
      data-testid="litt-asset-media-host"
    />
  );
}
