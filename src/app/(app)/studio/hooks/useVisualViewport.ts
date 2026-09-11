"use client";

import { useEffect, useState } from "react";

interface VisualViewportSnapshot {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  scale: number;
  /** Pixels hidden below the visual viewport (keyboard, bottom chrome, etc.). */
  bottomInset: number;
}

function getSnapshot(): VisualViewportSnapshot {
  if (typeof window === "undefined" || !window.visualViewport) {
    return { width: 0, height: 0, offsetTop: 0, offsetLeft: 0, scale: 1, bottomInset: 0 };
  }
  const vv = window.visualViewport;
  const bottomInset = Math.max(
    0,
    window.innerHeight - vv.height - vv.offsetTop,
  );
  return {
    width: vv.width,
    height: vv.height,
    offsetTop: vv.offsetTop,
    offsetLeft: vv.offsetLeft,
    scale: vv.scale,
    bottomInset,
  };
}

/**
 * useVisualViewport — SSR-safe wrapper around the Visual Viewport API.
 *
 * On mobile, opening the virtual keyboard shrinks the visual viewport and
 * raises `bottomInset`. Studio uses this to keep fixed sheets (LiTT chat,
 * terminal drawer) above the keyboard instead of letting the OS cover them.
 */
export function useVisualViewport(): VisualViewportSnapshot {
  const [snapshot, setSnapshot] = useState<VisualViewportSnapshot>(getSnapshot);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => setSnapshot(getSnapshot());
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return snapshot;
}
