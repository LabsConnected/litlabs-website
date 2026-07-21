"use client";

/**
 * LiTT Base Station — StationViewport (Phase 5: 2.5D)
 *
 * The 2.5D DOM/CSS canvas where LiTT and Spark live. Phase 5 layers in
 * perspective + a CSS-only starfield so the flat Phase 4 canvas now reads
 * as a small room viewed from above-and-slightly-forward:
 *
 *   - perspective on the parent gives agents real 3D depth on the Z axis
 *   - the starfield is a fixed pseudo-element behind the floor grid
 *   - agent tiles cast a soft shadow (box-shadow with negative spread)
 *   - a subtle parallax reaction to the pointer makes the room feel alive
 *   - in "edit" mode, the dragged tile gets a 1.04 scale and a brighter
 *     glow so the user can see what they're moving
 *
 * R3F (React Three Fiber) is intentionally deferred to a later phase; the
 * user feedback loop is "DOM first, 3D later" so we can validate the
 * product behavior before investing in a Three.js render loop.
 */

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS } from "@/lib/agents";
import {
  useStationStore,
  moveAgent,
  type AgentId,
  type StationMode,
  type AgentPlacement,
} from "../store/stationStore";

const AGENT_IDS: AgentId[] = ["litt", "spark"];

// 60 deterministic pseudo-stars. We avoid `Math.random` so the starfield is
// stable across renders (no flicker, no hydration mismatches).
const STARS: ReadonlyArray<{ x: number; y: number; size: number; delay: number }> = Array.from({ length: 60 }, (_, i) => {
  // simple deterministic pseudo-random based on index — good enough for a backdrop
  const r1 = Math.sin(i * 12.9898) * 43758.5453;
  const r2 = Math.sin(i * 78.233) * 43758.5453;
  return {
    x: (r1 - Math.floor(r1)) * 100,
    y: (r2 - Math.floor(r2)) * 100,
    size: ((r1 * 7) % 1) > 0.5 ? 2 : 1,
    delay: (i * 0.13) % 4,
  };
});

interface StationViewportProps {
  mode: StationMode;
  onSelectAgent: (id: AgentId) => void;
  selectedAgent: AgentId | null;
}

export default function StationViewport({
  mode,
  onSelectAgent,
  selectedAgent,
}: StationViewportProps) {
  const { resolvedColors: T } = useTheme();
  const layout = useStationStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [parallax, setParallax] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<{
    id: AgentId;
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Pointer-driven parallax (Explore mode). Throttled via rAF so we don't
  // run setState on every mousemove.
  useEffect(() => {
    if (mode !== "explore") return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const vp = viewportRef.current;
        if (!vp) return;
        const r = vp.getBoundingClientRect();
        const cx = (e.clientX - r.left) / r.width - 0.5;
        const cy = (e.clientY - r.top) / r.height - 0.5;
        setParallax({ x: cx, y: cy });
      });
    };
    window.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, [mode]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: AgentId) => {
      if (mode !== "edit") return;
      const rect = e.currentTarget.getBoundingClientRect();
      setDragging({
        id,
        pointerId: e.pointerId,
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top,
      });
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [mode],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const vRect = viewport.getBoundingClientRect();
      const x = Math.max(40, Math.min(vRect.width - 40, e.clientX - vRect.left - dragging.offsetX));
      const y = Math.max(40, Math.min(vRect.height - 40, e.clientY - vRect.top - dragging.offsetY));
      moveAgent(dragging.id, { x, y });
    },
    [dragging],
  );

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(dragging.pointerId);
    setDragging(null);
  }, [dragging]);

  // Cancel the drag if the user tabs away mid-drag.
  useEffect(() => {
    if (!dragging) return;
    const cancel = () => setDragging(null);
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, [dragging]);

  // Compose the per-tile transform: x/y + scale (drag-emphasis) + rotation +
  // 2.5D depth shift. We push dragged tiles slightly forward (Z) so they
  // hover over their stationary neighbours.
  const tileTransform = useCallback(
    (id: AgentId, placement: AgentPlacement) => {
      const isDragging = dragging?.id === id;
      const baseScale = placement.scale ?? 1;
      const scale = isDragging ? baseScale * 1.06 : baseScale;
      const rot = placement.rotation ?? 0;
      return `translate(-50%, -50%) scale(${scale}) rotate(${rot}deg) translateZ(${isDragging ? 12 : 0}px)`;
    },
    [dragging],
  );

  // Parallax: rotate the entire scene a few degrees around its center so
  // the agent tiles appear to lean toward the cursor. Clamped to a small
  // range to avoid motion sickness.
  const sceneRotate = useMemo(() => {
    const rx = (-parallax.y * 4).toFixed(2);
    const ry = (parallax.x * 4).toFixed(2);
    return `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
  }, [parallax]);

  return (
    <div
      ref={viewportRef}
      className="relative h-full w-full overflow-hidden rounded-3xl border"
      style={{
        borderColor: `${T.accentColor}30`,
        background: `radial-gradient(ellipse at 50% 100%, ${T.accentColor}22, transparent 65%), ${T.boxBg}`,
        perspective: "900px",
        perspectiveOrigin: "50% 60%",
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {/* Starfield — fixed pseudo-element behind everything. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ transform: sceneRotate, transformStyle: "preserve-3d" }}
      >
        {STARS.map((s, i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `${s.x}%`,
              top: `${s.y}%`,
              width: s.size,
              height: s.size,
              backgroundColor: "#ffffff",
              opacity: 0.55,
              boxShadow: "0 0 4px rgba(255,255,255,0.45)",
              animation: `lit-station-twinkle 4s ease-in-out ${s.delay}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Grid floor — gives the 2D canvas a sense of depth. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          maskImage: "radial-gradient(ellipse at 50% 60%, black 30%, transparent 80%)",
          transform: "rotateX(60deg) translateZ(-50px)",
          transformOrigin: "50% 100%",
          opacity: 0.45,
        }}
      />

      {/* Scene root — picks up the parallax rotation. */}
      <div
        className="relative h-full w-full"
        style={{
          transform: sceneRotate,
          transformStyle: "preserve-3d",
        }}
      >
        {AGENT_IDS.map((id) => {
          const agent = AGENTS[id];
          if (!agent) return null;
          const placement: AgentPlacement = layout.placements[id] ?? { x: 200, y: 200 };
          const color = layout.colors[id] ?? agent.color;
          const isSelected = selectedAgent === id;
          const isDragging = dragging?.id === id;
          return (
            <div
              key={id}
              role="button"
              tabIndex={0}
              aria-label={`${agent.name} — ${agent.role}`}
              onPointerDown={(e) => onPointerDown(e, id)}
              onClick={() => onSelectAgent(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelectAgent(id);
              }}
              className="absolute flex select-none flex-col items-center gap-1 rounded-2xl border p-3 transition-shadow"
              style={{
                left: placement.x,
                top: placement.y,
                transform: tileTransform(id, placement),
                transformStyle: "preserve-3d",
                borderColor: isSelected ? color : `${color}55`,
                backgroundColor: `${color}1f`,
                boxShadow: isDragging
                  ? `0 18px 36px ${color}55, 0 0 32px ${color}88, inset 0 0 0 1px ${color}66`
                  : isSelected
                    ? `0 8px 24px ${color}44, 0 0 18px ${color}55`
                    : `0 6px 16px ${color}28, inset 0 0 0 1px ${color}33`,
                cursor: mode === "edit" ? "grabbing" : "pointer",
                touchAction: "none",
                transitionDuration: "160ms",
              }}
            >
              {/* 2.5D badge: a small floating glyph that sits slightly above the tile. */}
              <div
                className="grid h-12 w-12 place-items-center rounded-xl text-[11px] font-black"
                style={{
                  backgroundColor: `${color}40`,
                  color: "#fff",
                  transform: "translateZ(8px)",
                  boxShadow: `inset 0 0 8px ${color}66, 0 0 12px ${color}55`,
                }}
              >
                {agent.tag}
              </div>
              <div
                className="text-[10px] font-black"
                style={{
                  color,
                  textShadow: `0 0 8px ${color}55`,
                  transform: "translateZ(4px)",
                }}
              >
                {agent.name}
              </div>
              <div
                className="max-w-[10rem] truncate text-[9px] opacity-70"
                style={{ color: T.textMuted, transform: "translateZ(2px)" }}
              >
                {agent.role}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mode hint */}
      {mode === "edit" && (
        <div
          className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-[.16em]"
          style={{ borderColor: `${T.accentColor}40`, backgroundColor: `${T.bgColor}cc`, color: T.accentColor }}
        >
          Drag to position · click to inspect
        </div>
      )}

      {/* Embedded keyframes for the starfield twinkle. */}
      <style jsx>{`
        @keyframes lit-station-twinkle {
          0%, 100% { opacity: 0.25; }
          50% { opacity: 0.75; }
        }
      `}</style>
    </div>
  );
}
