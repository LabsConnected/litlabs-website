"use client";

import { DirectManipulationCanvas } from "@/app/(app)/studio/components/canvas/DirectManipulationCanvas";

/** Auth-free harness for the Studio canvas selection chrome. */
export default function CanvasDirectHarnessPage() {
  return (
    <main style={{ height: "100dvh", background: "#0a0b10", color: "#fff" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <strong style={{ fontSize: 14 }}>Studio canvas</strong>
        <span style={{ fontSize: 12, opacity: 0.65 }}>
          Click an element, drag to move, drag a handle to resize. Arrows nudge. Space-drag or middle-mouse pans. Ctrl/Cmd-wheel zooms.
        </span>
      </header>
      <div style={{ height: "calc(100dvh - 46px)" }}>
        <DirectManipulationCanvas />
      </div>
    </main>
  );
}
