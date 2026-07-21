"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useTheme } from "@/context/ThemeContext";
import { AGENTS } from "@/lib/agents";
import {
  useStationStore,
  moveAgent,
  type AgentId,
  type StationMode,
  type AgentPlacement,
} from "@/app/agents/store/stationStore";

const AGENT_IDS = ["litt", "spark"] as const satisfies readonly AgentId[];
const EDGE_PADDING = 56;
const DRAG_THRESHOLD = 4;

interface Star {
  x: number;
  y: number;
  size: 1 | 2;
  delay: number;
  duration: number;
}

// Deterministic stars prevent hydration mismatch and visual flicker.
const STARS: readonly Star[] = Array.from({ length: 60 }, (_, index) => {
  const seedX = Math.sin(index * 12.9898) * 43758.5453;
  const seedY = Math.sin(index * 78.233) * 43758.5453;
  const normalizedX = seedX - Math.floor(seedX);
  const normalizedY = seedY - Math.floor(seedY);

  return {
    x: normalizedX * 100,
    y: normalizedY * 100,
    size: normalizedX > 0.72 ? 2 : 1,
    delay: (index * 0.13) % 4,
    duration: 3.2 + normalizedY * 2.4,
  };
});

interface StationViewportProps {
  mode: StationMode;
  onSelectAgent: (id: AgentId) => void;
  selectedAgent: AgentId | null;
}

interface DragState {
  id: AgentId;
  pointerId: number;
  grabOffsetX: number;
  grabOffsetY: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
}

export default function StationViewport({
  mode,
  onSelectAgent,
  selectedAgent,
}: StationViewportProps) {
  const { resolvedColors: T } = useTheme();
  const layout = useStationStore();
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef<AgentId | null>(null);
  const parallaxFrameRef = useRef<number | null>(null);

  const [draggingId, setDraggingId] = useState<AgentId | null>(null);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(media.matches);

    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  useEffect(() => {
    if (mode !== "explore" || prefersReducedMotion) {
      setParallax({ x: 0, y: 0 });
      return;
    }

    const viewport = viewportRef.current;
    if (!viewport) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;

      if (parallaxFrameRef.current !== null) {
        cancelAnimationFrame(parallaxFrameRef.current);
      }

      parallaxFrameRef.current = requestAnimationFrame(() => {
        const rect = viewport.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const x = Math.max(-0.5, Math.min(0.5, (event.clientX - rect.left) / rect.width - 0.5));
        const y = Math.max(-0.5, Math.min(0.5, (event.clientY - rect.top) / rect.height - 0.5));
        setParallax({ x, y });
      });
    };

    const resetParallax = () => setParallax({ x: 0, y: 0 });

    viewport.addEventListener("pointermove", handlePointerMove, { passive: true });
    viewport.addEventListener("pointerleave", resetParallax);

    return () => {
      if (parallaxFrameRef.current !== null) {
        cancelAnimationFrame(parallaxFrameRef.current);
        parallaxFrameRef.current = null;
      }
      viewport.removeEventListener("pointermove", handlePointerMove);
      viewport.removeEventListener("pointerleave", resetParallax);
    };
  }, [mode, prefersReducedMotion]);

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag?.moved) suppressClickRef.current = drag.id;
    dragRef.current = null;
    setDraggingId(null);
  }, []);

  useEffect(() => {
    if (!draggingId) return;

    const cancelDrag = () => finishDrag();
    window.addEventListener("blur", cancelDrag);
    window.addEventListener("pointerup", cancelDrag);
    window.addEventListener("pointercancel", cancelDrag);

    return () => {
      window.removeEventListener("blur", cancelDrag);
      window.removeEventListener("pointerup", cancelDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [draggingId, finishDrag]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, id: AgentId) => {
      if (mode !== "edit" || event.button !== 0) return;

      const tileRect = event.currentTarget.getBoundingClientRect();
      const tileCenterX = tileRect.left + tileRect.width / 2;
      const tileCenterY = tileRect.top + tileRect.height / 2;

      dragRef.current = {
        id,
        pointerId: event.pointerId,
        grabOffsetX: event.clientX - tileCenterX,
        grabOffsetY: event.clientY - tileCenterY,
        startClientX: event.clientX,
        startClientY: event.clientY,
        moved: false,
      };

      suppressClickRef.current = null;
      setDraggingId(id);
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [mode],
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const viewport = viewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;

    const rect = viewport.getBoundingClientRect();
    const deltaX = event.clientX - drag.startClientX;
    const deltaY = event.clientY - drag.startClientY;

    if (!drag.moved && Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) {
      drag.moved = true;
    }

    if (!drag.moved) return;

    const x = Math.max(
      EDGE_PADDING,
      Math.min(rect.width - EDGE_PADDING, event.clientX - rect.left - drag.grabOffsetX),
    );
    const y = Math.max(
      EDGE_PADDING,
      Math.min(rect.height - EDGE_PADDING, event.clientY - rect.top - drag.grabOffsetY),
    );

    moveAgent(drag.id, { x, y });
  }, []);

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      finishDrag();
    },
    [finishDrag],
  );

  const handleAgentClick = useCallback(
    (id: AgentId) => {
      if (suppressClickRef.current === id) {
        suppressClickRef.current = null;
        return;
      }
      onSelectAgent(id);
    },
    [onSelectAgent],
  );

  const handleAgentKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, id: AgentId) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelectAgent(id);
    },
    [onSelectAgent],
  );

  const sceneTransform = useMemo(() => {
    if (prefersReducedMotion) return "rotateX(0deg) rotateY(0deg)";
    const rotateX = (-parallax.y * 4).toFixed(2);
    const rotateY = (parallax.x * 4).toFixed(2);
    return `rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  }, [parallax, prefersReducedMotion]);

  const getTileTransform = useCallback(
    (id: AgentId, placement: AgentPlacement) => {
      const isDragging = draggingId === id;
      const scale = (placement.scale ?? 1) * (isDragging ? 1.06 : 1);
      const rotation = placement.rotation ?? 0;
      const depth = isDragging ? 18 : selectedAgent === id ? 8 : 0;

      return `translate3d(-50%, -50%, ${depth}px) rotate(${rotation}deg) scale(${scale})`;
    },
    [draggingId, selectedAgent],
  );

  return (
    <div
      ref={viewportRef}
      className="relative h-full min-h-[360px] w-full overflow-hidden rounded-3xl border"
      style={{
        borderColor: `${T.accentColor}30`,
        background: `radial-gradient(ellipse at 50% 100%, ${T.accentColor}22, transparent 65%), ${T.boxBg}`,
        perspective: "900px",
        perspectiveOrigin: "50% 60%",
        touchAction: mode === "edit" ? "none" : "pan-x pan-y",
      }}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {STARS.map((star, index) => (
          <span
            key={index}
            className="absolute rounded-full motion-reduce:animate-none"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: star.size,
              height: star.size,
              backgroundColor: "#fff",
              opacity: 0.5,
              boxShadow: "0 0 5px rgba(255,255,255,.5)",
              animation: `lit-station-twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`,
            }}
          />
        ))}
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[-12%] bottom-[-38%] h-[115%]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.075) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.075) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 4%, black 38%, transparent 92%)",
          maskImage: "linear-gradient(to bottom, transparent 4%, black 38%, transparent 92%)",
          transform: "rotateX(63deg) translateZ(-70px)",
          transformOrigin: "50% 100%",
          opacity: 0.5,
        }}
      />

      <div
        className="relative h-full w-full will-change-transform"
        style={{
          transform: sceneTransform,
          transformStyle: "preserve-3d",
          transition: draggingId ? "none" : "transform 180ms ease-out",
        }}
      >
        {AGENT_IDS.map((id) => {
          const agent = AGENTS[id];
          if (!agent) return null;

          const placement: AgentPlacement = layout.placements[id] ?? { x: 200, y: 200 };
          const color = layout.colors[id] ?? agent.color;
          const isSelected = selectedAgent === id;
          const isDragging = draggingId === id;

          return (
            <div
              key={id}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              aria-label={`${agent.name} — ${agent.role}`}
              onPointerDown={(event) => handlePointerDown(event, id)}
              onClick={() => handleAgentClick(id)}
              onKeyDown={(event) => handleAgentKeyDown(event, id)}
              className="absolute z-10 flex min-w-[108px] select-none flex-col items-center gap-1 rounded-2xl border p-3 outline-none transition-[box-shadow,border-color,background-color] duration-150 focus-visible:ring-2"
              style={{
                left: placement.x,
                top: placement.y,
                transform: getTileTransform(id, placement),
                transformStyle: "preserve-3d",
                borderColor: isSelected ? color : `${color}55`,
                backgroundColor: `${color}${isSelected ? "2b" : "1f"}`,
                boxShadow: isDragging
                  ? `0 20px 42px ${color}55, 0 0 34px ${color}88, inset 0 0 0 1px ${color}66`
                  : isSelected
                    ? `0 10px 28px ${color}44, 0 0 20px ${color}55`
                    : `0 6px 18px ${color}28, inset 0 0 0 1px ${color}33`,
                cursor: mode === "edit" ? (isDragging ? "grabbing" : "grab") : "pointer",
                touchAction: "none",
                willChange: isDragging ? "transform, left, top" : "auto",
                // Tailwind focus ring cannot consume a runtime theme color reliably.
                "--tw-ring-color": color,
              } as CSSProperties}
            >
              <div
                className="grid h-12 w-12 place-items-center rounded-xl text-[11px] font-black"
                style={{
                  backgroundColor: `${color}40`,
                  color: "#fff",
                  transform: "translateZ(10px)",
                  boxShadow: `inset 0 0 8px ${color}66, 0 0 14px ${color}55`,
                }}
              >
                {agent.tag}
              </div>

              <div
                className="text-[10px] font-black"
                style={{
                  color,
                  textShadow: `0 0 8px ${color}55`,
                  transform: "translateZ(6px)",
                }}
              >
                {agent.name}
              </div>

              <div
                className="max-w-[10rem] truncate text-[9px] opacity-70"
                style={{ color: T.textMuted, transform: "translateZ(3px)" }}
              >
                {agent.role}
              </div>
            </div>
          );
        })}
      </div>

      {mode === "edit" && (
        <div
          className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border px-3 py-1 text-[9px] font-black uppercase tracking-[.16em]"
          style={{
            borderColor: `${T.accentColor}40`,
            backgroundColor: `${T.bgColor}dd`,
            color: T.accentColor,
            backdropFilter: "blur(10px)",
          }}
        >
          Drag to position · click to inspect
        </div>
      )}

      <style jsx>{`
        @keyframes lit-station-twinkle {
          0%,
          100% {
            opacity: 0.2;
            transform: scale(0.85);
          }
          50% {
            opacity: 0.78;
            transform: scale(1.15);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          span {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}