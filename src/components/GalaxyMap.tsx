"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Maximize2,
  Move,
  RotateCw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

export type GalaxyNode = {
  id: string;
  label: string;
  type: "user" | "agent" | "system" | "database" | "zone" | "alert";
  status: "active" | "idle" | "busy" | "offline";
  x: number;
  y: number;
  size: number;
  color: string;
  connections: string[];
  metric?: number;
  subtitle?: string;
};

const DEFAULT_NODES: GalaxyNode[] = [
  {
    id: "core",
    label: "LiTT Core",
    type: "system",
    status: "active",
    x: 0,
    y: 0,
    size: 34,
    color: "#22d3ee",
    connections: ["studio", "marketplace", "social", "agents"],
    subtitle: "central orbit",
    metric: 98,
  },
  {
    id: "studio",
    label: "Studio",
    type: "zone",
    status: "active",
    x: -190,
    y: -60,
    size: 26,
    color: "#f97316",
    connections: ["core", "agents"],
    subtitle: "builder activity",
    metric: 32,
  },
  {
    id: "marketplace",
    label: "Marketplace",
    type: "zone",
    status: "busy",
    x: 180,
    y: -70,
    size: 26,
    color: "#a78bfa",
    connections: ["core", "social"],
    subtitle: "sales / installs",
    metric: 18,
  },
  {
    id: "social",
    label: "Social",
    type: "zone",
    status: "active",
    x: -160,
    y: 140,
    size: 24,
    color: "#ec4899",
    connections: ["core", "users"],
    subtitle: "community flow",
    metric: 44,
  },
  {
    id: "agents",
    label: "Agents",
    type: "zone",
    status: "busy",
    x: 170,
    y: 140,
    size: 26,
    color: "#34d399",
    connections: ["core", "db"],
    subtitle: "tasks + logs",
    metric: 76,
  },
  {
    id: "users",
    label: "Users",
    type: "user",
    status: "active",
    x: -320,
    y: 30,
    size: 18,
    color: "#60a5fa",
    connections: ["social", "core"],
    subtitle: "active visitors",
    metric: 42,
  },
  {
    id: "db",
    label: "Database",
    type: "database",
    status: "active",
    x: 320,
    y: 40,
    size: 20,
    color: "#10b981",
    connections: ["agents", "core"],
    subtitle: "realtime rows",
    metric: 91,
  },
  {
    id: "alerts",
    label: "Alerts",
    type: "alert",
    status: "idle",
    x: 0,
    y: 270,
    size: 18,
    color: "#f59e0b",
    connections: ["core"],
    subtitle: "watchlist",
    metric: 2,
  },
];

export default function GalaxyMap({
  nodes = DEFAULT_NODES,
  onNodeClick,
}: {
  nodes?: GalaxyNode[];
  onNodeClick?: (node: GalaxyNode) => void;
}) {
  const { resolvedColors: T } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const displayNodes = useMemo(
    () => (nodes.length ? nodes : DEFAULT_NODES),
    [nodes],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.scale(dpr, dpr);
    const w = width / dpr;
    const h = height / dpr;

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, T.bgColor);
    bg.addColorStop(1, T.boxBg);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 140; i++) {
      const x = (i * 97) % w;
      const y = (i * 61) % h;
      const r = (i % 3) + 0.5;
      ctx.fillStyle = `rgba(255,255,255,${i % 7 === 0 ? 0.45 : 0.15})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const cx = w / 2 + offset.x;
    const cy = h / 2 + offset.y;
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.rotate((rotation * Math.PI) / 180);

    displayNodes.forEach((node) => {
      node.connections.forEach((id) => {
        const target = displayNodes.find((n) => n.id === id);
        if (!target) return;
        const gradient = ctx.createLinearGradient(
          node.x,
          node.y,
          target.x,
          target.y,
        );
        gradient.addColorStop(0, node.color + "90");
        gradient.addColorStop(1, target.color + "40");
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      });
    });

    displayNodes.forEach((node, i) => {
      const pulse = 1 + Math.sin(Date.now() / 900 + i) * 0.05;
      const glow = ctx.createRadialGradient(
        node.x,
        node.y,
        0,
        node.x,
        node.y,
        node.size * 2.6,
      );
      glow.addColorStop(0, node.color + "aa");
      glow.addColorStop(0.35, node.color + "55");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size * 2.6 * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "#ffffff22";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size * pulse, 0, Math.PI * 2);
      ctx.stroke();

      const statusColor =
        node.status === "active"
          ? "#22c55e"
          : node.status === "busy"
            ? "#f59e0b"
            : node.status === "idle"
              ? "#60a5fa"
              : "#6b7280";
      ctx.fillStyle = statusColor;
      ctx.beginPath();
      ctx.arc(
        node.x + node.size * 0.75,
        node.y - node.size * 0.75,
        3.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();

      ctx.fillStyle = T.textColor;
      ctx.font = "600 12px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText(node.label, node.x, node.y + node.size + 18);
      ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillStyle = T.textMuted;
      if (node.subtitle)
        ctx.fillText(node.subtitle, node.x, node.y + node.size + 31);
    });

    ctx.restore();
  }, [T, displayNodes, offset.x, offset.y, zoom, rotation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const resize = () => {
      canvas.width = wrapper.clientWidth * window.devicePixelRatio;
      canvas.height = wrapper.clientHeight * window.devicePixelRatio;
      canvas.style.width = `${wrapper.clientWidth}px`;
      canvas.style.height = `${wrapper.clientHeight}px`;
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrapper);
    resize();
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      draw();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  const toNode = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left - rect.width / 2 - offset.x;
    const y = clientY - rect.top - rect.height / 2 - offset.y;
    const wx = x / zoom;
    const wy = y / zoom;
    return (
      displayNodes.find((node) => {
        const dx = node.x - wx;
        const dy = node.y - wy;
        return Math.sqrt(dx * dx + dy * dy) <= node.size + 8;
      }) || null
    );
  };

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full overflow-hidden rounded-3xl border"
      style={{
        background: `radial-gradient(circle at 50% 50%, ${T.accentColor}12, transparent 30%), linear-gradient(180deg, ${T.bgColor}, ${T.boxBg})`,
        borderColor: T.borderColor + "30",
        boxShadow: `inset 0 0 0 1px ${T.borderColor}20, 0 30px 80px ${T.bgColor}80`,
      }}
      onPointerDown={(e) => {
        setDragging(true);
        dragStart.current = {
          x: e.clientX - offset.x,
          y: e.clientY - offset.y,
        };
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        setOffset({
          x: e.clientX - dragStart.current.x,
          y: e.clientY - dragStart.current.y,
        });
      }}
      onPointerUp={() => setDragging(false)}
      onPointerLeave={() => setDragging(false)}
      onWheel={(e) => {
        e.preventDefault();
        setZoom((z) =>
          Math.max(0.5, Math.min(2.6, z + (e.deltaY > 0 ? -0.08 : 0.08))),
        );
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={(e) => {
          const node = toNode(e.clientX, e.clientY);
          if (node && onNodeClick) onNodeClick(node);
        }}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      />

      <div
        className="absolute left-4 top-4 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]"
        style={{
          backgroundColor: T.boxBg + "88",
          borderColor: T.borderColor + "30",
          color: T.accentColor,
        }}
      >
        Live Galaxy Map
      </div>
      <div
        className="absolute bottom-4 left-4 flex items-center gap-2 rounded-2xl border px-3 py-2 text-xs"
        style={{
          backgroundColor: T.boxBg + "88",
          borderColor: T.borderColor + "30",
          color: T.textMuted,
        }}
      >
        <Move size={14} />
        Drag, scroll, and click nodes
      </div>
      <div className="absolute bottom-4 right-4 flex items-center gap-2">
        <button
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
          className="rounded-xl border p-2 transition-transform hover:scale-105"
          style={{
            backgroundColor: T.boxBg + "88",
            borderColor: T.borderColor + "30",
            color: T.textColor,
          }}
        >
          <ZoomOut size={14} />
        </button>
        <button
          onClick={() => setZoom(1)}
          className="rounded-xl border p-2 transition-transform hover:scale-105"
          style={{
            backgroundColor: T.boxBg + "88",
            borderColor: T.borderColor + "30",
            color: T.textColor,
          }}
        >
          <Search size={14} />
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(2.6, z + 0.1))}
          className="rounded-xl border p-2 transition-transform hover:scale-105"
          style={{
            backgroundColor: T.boxBg + "88",
            borderColor: T.borderColor + "30",
            color: T.textColor,
          }}
        >
          <ZoomIn size={14} />
        </button>
        <button
          onClick={() => setRotation((r) => r + 12)}
          className="rounded-xl border p-2 transition-transform hover:scale-105"
          style={{
            backgroundColor: T.boxBg + "88",
            borderColor: T.borderColor + "30",
            color: T.textColor,
          }}
        >
          <RotateCw size={14} />
        </button>
        <button
          onClick={() => {
            setRotation(0);
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
          className="rounded-xl border p-2 transition-transform hover:scale-105"
          style={{
            backgroundColor: T.boxBg + "88",
            borderColor: T.borderColor + "30",
            color: T.textColor,
          }}
        >
          <Maximize2 size={14} />
        </button>
      </div>
    </div>
  );
}
