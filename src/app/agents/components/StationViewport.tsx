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
  const [draggingId, setDraggingId] = useState<AgentId | null>(null);
  const dragRef = useRef<{
    id: AgentId;
    pointerId: number;
    startX: number;
    startY: number;
    grabOffsetX: number;
    grabOffsetY: number;
    tile: HTMLDivElement | null;
    moved: boolean;
    vRect: DOMRect;
  } | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const tileRefs = useRef<Record<AgentId, HTMLDivElement | null>>({} as Record<AgentId, HTMLDivElement | null>);
  const suppressClickRef = useRef(false);

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

  const handleAgentClick = useCallback(
    (id: AgentId) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onSelectAgent(id);
    },
    [onSelectAgent],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: AgentId) => {
      if (mode !== "edit") return;
      const tile = tileRefs.current[id];
      const viewport = viewportRef.current;
      if (!tile || !viewport) return;
      const tileRect = tile.getBoundingClientRect();
      const vRect = viewport.getBoundingClientRect();
      const centerX = tileRect.left + tileRect.width / 2;
      const centerY = tileRect.top + tileRect.height / 2;

      dragRef.current = {
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        grabOffsetX: e.clientX - centerX,
        grabOffsetY: e.clientY - centerY,
        tile,
        moved: false,
        vRect,
      };
      pendingRef.current = { x: centerX - vRect.left, y: centerY - vRect.top };
      suppressClickRef.current = false;
      setDraggingId(id);
      viewport.setPointerCapture(e.pointerId);
      e.preventDefault();
    },
    [mode],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const viewport = viewportRef.current;
      if (!viewport) return;
      const vRect = viewport.getBoundingClientRect();
      const x = Math.max(56, Math.min(vRect.width - 56, e.clientX - vRect.left - drag.grabOffsetX));
      const y = Math.max(56, Math.min(vRect.height - 56, e.clientY - vRect.top - drag.grabOffsetY));

      if (!drag.moved) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
      }

      pendingRef.current = { x, y };
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const pos = pendingRef.current;
          const tile = dragRef.current?.tile;
          if (tile && pos) {
            tile.style.left = `${pos.x}px`;
            tile.style.top = `${pos.y}px`;
          }
        });
      }
    },
    [],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      const viewport = viewportRef.current;
      if (viewport) {
        try {
          viewport.releasePointerCapture(drag.pointerId);
        } catch {
          /* ignore */
        }
      }
      const vRect = viewport?.getBoundingClientRect() ?? drag.vRect;
      const x = Math.max(56, Math.min(vRect.width - 56, e.clientX - vRect.left - drag.grabOffsetX));
      const y = Math.max(56, Math.min(vRect.height - 56, e.clientY - vRect.top - drag.grabOffsetY));
      const tile = drag.tile;
      if (tile) {
        tile.style.left = `${x}px`;
        tile.style.top = `${y}px`;
      }
      moveAgent(drag.id, { x, y });
      suppressClickRef.current = drag.moved;
      dragRef.current = null;
      setDraggingId(null);
    },
    [],
  );

  // Cancel the drag if the user tabs away mid-drag.
  useEffect(() => {
    if (!draggingId) return;
    const cancel = () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      dragRef.current = null;
      setDraggingId(null);
    };
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, [draggingId]);

  // Compose the per-tile transform: x/y + scale (drag-emphasis) + rotation +
  // 2.5D depth shift. We push dragged tiles slightly forward (Z) so they
  // hover over their stationary neighbours.
  const tileTransform = useCallback(
    (id: AgentId, placement: AgentPlacement) => {
      const isDragging = draggingId === id;
      const baseScale = placement.scale ?? 1;
      const scale = isDragging ? baseScale * 1.06 : baseScale;
      const rot = placement.rotation ?? 0;
      return `translate(-50%, -50%) scale(${scale}) rotate(${rot}deg) translateZ(${isDragging ? 12 : 0}px)`;
    },
    [draggingId],
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

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[8%] top-[7%] h-[30%] rounded-b-[48%] border border-white/10"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,0))",
          boxShadow: "inset 0 -24px 44px rgba(0,0,0,.35)",
          transform: "translateZ(-40px)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[60%]"
        style={{
          background: `linear-gradient(180deg, transparent, ${T.bgColor}66 78%), radial-gradient(ellipse at 50% 100%, ${T.accentColor}2b, transparent 64%)`,
        }}
      />
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
      <div
        aria-hidden
        className="pointer-events-none absolute left-[14%] top-[42%] h-28 w-28 rounded-full border"
        style={{
          borderColor: `${layout.colors.litt ?? AGENTS.litt?.color ?? T.accentColor}55`,
          background: `radial-gradient(circle, ${layout.colors.litt ?? AGENTS.litt?.color ?? T.accentColor}18, transparent 68%)`,
          boxShadow: `0 0 44px ${layout.colors.litt ?? AGENTS.litt?.color ?? T.accentColor}25`,
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-[14%] top-[52%] h-28 w-28 rounded-full border"
        style={{
          borderColor: `${layout.colors.spark ?? AGENTS.spark?.color ?? T.linkColor}55`,
          background: `radial-gradient(circle, ${layout.colors.spark ?? AGENTS.spark?.color ?? T.linkColor}18, transparent 68%)`,
          boxShadow: `0 0 44px ${layout.colors.spark ?? AGENTS.spark?.color ?? T.linkColor}25`,
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
          return (
            <div
              key={id}
              ref={(el) => { tileRefs.current[id] = el; }}
              role="button"
              tabIndex={0}
              aria-label={`${agent.name} — ${agent.role}`}
              onPointerDown={(e) => onPointerDown(e, id)}
              onClick={() => handleAgentClick(id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleAgentClick(id);
              }}
              className="group absolute flex select-none flex-col items-center gap-2 outline-none"
              style={{
                left: placement.x,
                top: placement.y,
                transform: tileTransform(id, placement),
                transformStyle: "preserve-3d",
                cursor: mode === "edit" ? "grabbing" : "pointer",
                touchAction: "none",
                transition: "box-shadow 160ms ease, transform 160ms ease",
              }}
            >
              <div
                className="relative h-20 w-20 rounded-full"
                style={{ transform: "translateZ(8px)" }}
              >
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: `radial-gradient(circle, ${color}35 0%, transparent 70%)`,
                    boxShadow: `inset 0 0 24px ${color}45, 0 0 32px ${color}45`,
                  }}
                />
                <div
                  className="absolute inset-2 grid place-items-center rounded-full text-lg font-black text-white"
                  style={{
                    background: `radial-gradient(circle at 40% 30%, ${color}, ${color}99)`,
                    boxShadow: `0 0 20px ${color}99`,
                    animation: "lit-float 3s ease-in-out infinite",
                  }}
                >
                  {agent.tag}
                </div>
                <div
                  className="pointer-events-none absolute -inset-1 rounded-full border-2 transition-opacity"
                  style={{
                    borderColor: color,
                    opacity: isSelected ? 1 : 0.5,
                    boxShadow: isSelected
                      ? `0 0 18px ${color}`
                      : `0 0 8px ${color}55`,
                  }}
                />
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
        @keyframes lit-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}</style>
    </div>
  );
}
