"use client";

import { useEffect, type ReactNode } from "react";
import { LittAppStoreProvider } from "@/lib/litt-client/store-context";

/**
 * Tracks the on-screen keyboard via `visualViewport` and exposes the
 * overlap as `--litt-keyboard-inset`. Listener only — no interval.
 * Removed on unmount so a later Studio navigation does not inherit it.
 */
function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const apply = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty("--litt-keyboard-inset", `${Math.round(inset)}px`);
    };

    apply();
    viewport.addEventListener("resize", apply);
    viewport.addEventListener("scroll", apply, { passive: true });
    return () => {
      viewport.removeEventListener("resize", apply);
      viewport.removeEventListener("scroll", apply);
      document.documentElement.style.removeProperty("--litt-keyboard-inset");
    };
  }, []);
}

/**
 * LiTT App frame. Own background, safe-area padding, and store.
 * It does not mount wallet, music, YouTube, or the site shell.
 */
export function LittAppFrame({ children }: { children: ReactNode }) {
  useKeyboardInset();

  return (
    <LittAppStoreProvider>
      <div data-litt-app="" className="flex min-h-dvh flex-col bg-[#070b14] text-[#eef4ff]">
        {children}
      </div>
    </LittAppStoreProvider>
  );
}
