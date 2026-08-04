"use client";

/**
 * DirectAudioMediaHost — the mount point for the DirectAudioAdapter.
 * The adapter creates a hidden <audio> element inside this container.
 * No visible iframe — playback is controlled entirely through the
 * MediaHubProvider UI (mini player / expanded drawer).
 */

import { useEffect, useRef } from "react";
import { useMediaHub } from "../MediaHubProvider";

export function DirectAudioMediaHost({
  className,
}: {
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { mountDirectAudio, unmountDirectAudio } = useMediaHub();

  useEffect(() => {
    const div = containerRef.current;
    if (!div) return;

    void mountDirectAudio(div);

    return () => {
      unmountDirectAudio();
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
      data-testid="direct-audio-media-host"
    />
  );
}
