"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Star,
  Lock,
  GitBranch,
  RefreshCw,
  ExternalLink,
  X,
  Folder,
  FolderGit2,
} from "lucide-react";

type GalaxyItem = {
  id: string;
  label: string;
  type: "system" | "repo" | "project" | "folder";
  system: string;
  parent?: string;
  meta?: {
    language?: string;
    stars?: number;
    private?: boolean;
    branch?: string;
    status?: string;
    url?: string;
    updated?: string;
  };
};

type Systems = Array<{
  id: string;
  label: string;
  type: "system" | "project";
  color: string;
}>;

type ApiResponse = {
  systems?: Systems;
  items?: GalaxyItem[];
  count?: number;
  error?: string;
};

type PositionedNode = GalaxyItem & {
  x: number;
  y: number;
  size: number;
  color: string;
  connections: string[];
};

/* Language → color mapping for repo nodes */
const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f7df1e",
  Python: "#3776ab",
  Rust: "#dea584",
  Go: "#00add8",
  Java: "#ed8b00",
  "C++": "#00599c",
  C: "#a8b9cc",
  "C#": "#178600",
  Ruby: "#cc342d",
  PHP: "#777bb4",
  Swift: "#f05138",
  Kotlin: "#7f52ff",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Shell: "#89e051",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Dart: "#00b4ab",
  Lua: "#000080",
  Haskell: "#5e5086",
  Scala: "#c22d40",
  Clojure: "#db5855",
  Elixir: "#6e4a7e",
  Zig: "#ec915c",
  Nim: "#ffc200",
};

function langColor(lang?: string): string {
  if (!lang) return "#8b5cf6";
  return LANG_COLORS[lang] || "#8b5cf6";
}

/**
 * FileGalaxy
 *
 * An interactive galaxy map of the user's GitHub repos and local
 * projects. Each GitHub installation is a "star system" (central star)
 * with repos orbiting it as planets. Local projects form a separate
 * system. The user can drag to pan, scroll to zoom, rotate, and click
 * nodes to see details.
 *
 * Data is fetched from /api/galaxy/files.
 */
export default function FileGalaxy() {
  const { resolvedColors: T } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<GalaxyItem | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const dragStart = useRef({ x: 0, y: 0 });
  const timeRef = useRef(0);

  /* Fetch data */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/galaxy/files", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      if (res.ok) setData(json);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  /* Convert items to positioned nodes with orbital layout */
  const nodes = useMemo<PositionedNode[]>(() => {
    const items = data?.items || [];
    const systems = data?.systems || [];
    if (items.length === 0) return [];

    const result: PositionedNode[] = [];
    const systemIds = systems.map((s) => s.id);

    // Position systems in a ring around the center
    const systemCount = systemIds.length;
    systemIds.forEach((sid, i) => {
      const sys = systems.find((s) => s.id === sid);
      const angle = (i / systemCount) * Math.PI * 2 - Math.PI / 2;
      const dist = systemCount > 1 ? 280 : 0;
      result.push({
        ...items.find((it) => it.id === sid)!,
        x: Math.cos(angle) * dist,
        y: Math.sin(angle) * dist,
        size: 30,
        color: sys?.color || "#22d3ee",
        connections: [],
      });
    });

    // Position child items (repos/projects) orbiting their system
    items
      .filter((it) => it.parent && systemIds.includes(it.parent))
      .forEach((it) => {
        const parent = result.find((n) => n.id === it.parent);
        if (!parent) return;

        // Count siblings for orbital distribution
        const siblings = items.filter((i) => i.parent === it.parent);
        const sibIdx = siblings.indexOf(it);
        const orbitAngle = (sibIdx / siblings.length) * Math.PI * 2;
        const orbitRadius = 80 + (sibIdx % 3) * 35;

        const color =
          it.type === "repo" ? langColor(it.meta?.language) : "#22d3ee";

        result.push({
          ...it,
          x: parent.x + Math.cos(orbitAngle) * orbitRadius,
          y: parent.y + Math.sin(orbitAngle) * orbitRadius,
          size:
            it.type === "repo"
              ? 12 + Math.min(8, (it.meta?.stars || 0) / 5)
              : 14,
          color,
          connections: [it.parent!],
        });
      });

    // Connect systems to each other
    systemIds.forEach((sid, i) => {
      const next = systemIds[(i + 1) % systemIds.length];
      const node = result.find((n) => n.id === sid);
      if (node) node.connections.push(next);
    });

    return result;
  }, [data]);

  /* Draw loop */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }

    timeRef.current += 0.016;
    const t = timeRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Background gradient
    const bg = ctx.createRadialGradient(
      w / 2,
      h / 2,
      0,
      w / 2,
      h / 2,
      Math.max(w, h),
    );
    bg.addColorStop(0, T.bgColor);
    bg.addColorStop(0.6, T.boxBg);
    bg.addColorStop(1, "#050510");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Starfield
    for (let i = 0; i < 200; i++) {
      const sx = (i * 137.5) % w;
      const sy = (i * 73.3) % h;
      const sr = (i % 3) * 0.5 + 0.3;
      const twinkle = 0.3 + Math.sin(t * 2 + i) * 0.2;
      ctx.fillStyle = `rgba(255,255,255,${(i % 5 === 0 ? 0.6 : 0.15) * twinkle})`;
      ctx.beginPath();
      ctx.arc(sx, sy, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // Apply camera transform
    const cx = w / 2 + offset.x;
    const cy = h / 2 + offset.y;
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.rotate((rotation * Math.PI) / 180);

    // Draw connections (orbit lines + links)
    nodes.forEach((node) => {
      node.connections.forEach((targetId) => {
        const target = nodes.find((n) => n.id === targetId);
        if (!target) return;

        // Orbit line (dashed for parent-child, solid for system links)
        const isParentLink = node.parent === targetId;
        if (isParentLink) {
          ctx.strokeStyle = `${node.color}30`;
          ctx.lineWidth = 0.8;
          ctx.setLineDash([4, 4]);
        } else {
          ctx.strokeStyle = `${T.accentColor}25`;
          ctx.lineWidth = 1;
          ctx.setLineDash([]);
        }
        ctx.beginPath();
        ctx.moveTo(node.x, node.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      });
    });
    ctx.setLineDash([]);

    // Draw orbit rings around systems
    nodes
      .filter((n) => n.type === "system")
      .forEach((sys) => {
        const children = nodes.filter((n) => n.parent === sys.id);
        const maxOrbit = Math.max(
          ...children.map((c) => {
            const dx = c.x - sys.x;
            const dy = c.y - sys.y;
            return Math.sqrt(dx * dx + dy * dy);
          }),
          80,
        );

        for (let ring = 0; ring < 3; ring++) {
          const r = maxOrbit * (0.5 + ring * 0.25);
          ctx.strokeStyle = `${sys.color}10`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.arc(sys.x, sys.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      });

    // Draw nodes
    nodes.forEach((node, i) => {
      const pulse = 1 + Math.sin(t * 1.5 + i * 0.5) * 0.06;
      const isHovered = hovered === node.id;
      const isSelected = selected?.id === node.id;
      const glowMult = isHovered || isSelected ? 3.5 : 2.6;

      // Glow
      const glow = ctx.createRadialGradient(
        node.x,
        node.y,
        0,
        node.x,
        node.y,
        node.size * glowMult,
      );
      glow.addColorStop(0, node.color + "aa");
      glow.addColorStop(0.3, node.color + "55");
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size * glowMult * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Core
      ctx.fillStyle = node.color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Ring
      ctx.strokeStyle = isHovered || isSelected ? "#ffffff80" : "#ffffff22";
      ctx.lineWidth = isHovered || isSelected ? 2 : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size * pulse, 0, Math.PI * 2);
      ctx.stroke();

      // System nodes get an extra outer ring
      if (node.type === "system") {
        ctx.strokeStyle = `${node.color}40`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.size * 1.5 * pulse, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Labels (only when zoomed in enough or hovered)
      const showLabel =
        zoom > 0.8 || isHovered || isSelected || node.type === "system";
      if (showLabel) {
        ctx.fillStyle = T.textColor;
        ctx.font =
          node.type === "system"
            ? "700 13px ui-sans-serif, system-ui"
            : "500 11px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText(node.label, node.x, node.y + node.size + 16);

        if (node.meta?.language && zoom > 1) {
          ctx.font = "9px ui-monospace, monospace";
          ctx.fillStyle = T.textMuted;
          ctx.fillText(node.meta.language, node.x, node.y + node.size + 28);
        }
      }
    });

    ctx.restore();
  }, [T, nodes, offset.x, offset.y, zoom, rotation, hovered, selected]);

  /* Animation loop */
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      draw();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  /* Resize observer */
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [draw]);

  /* Hit test for click */
  const toNode = (clientX: number, clientY: number): GalaxyItem | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left - rect.width / 2 - offset.x;
    const y = clientY - rect.top - rect.height / 2 - offset.y;
    const wx = x / zoom;
    const wy = y / zoom;
    // Reverse rotation
    const rad = -(rotation * Math.PI) / 180;
    const rx = wx * Math.cos(rad) - wy * Math.sin(rad);
    const ry = wx * Math.sin(rad) + wy * Math.cos(rad);

    return (
      nodes.find((node) => {
        const dx = node.x - rx;
        const dy = node.y - ry;
        return Math.sqrt(dx * dx + dy * dy) <= node.size + 6;
      }) || null
    );
  };

  return (
    <div
      ref={wrapperRef}
      className="relative h-full w-full overflow-hidden rounded-2xl border"
      style={{
        background: `radial-gradient(circle at 50% 50%, ${T.accentColor}08, transparent 40%), linear-gradient(180deg, ${T.bgColor}, #050510)`,
        borderColor: `${T.borderColor}30`,
      }}
      onPointerDown={(e) => {
        setDragging(true);
        dragStart.current = {
          x: e.clientX - offset.x,
          y: e.clientY - offset.y,
        };
      }}
      onPointerMove={(e) => {
        if (dragging) {
          setOffset({
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y,
          });
        } else {
          const node = toNode(e.clientX, e.clientY);
          setHovered(node?.id || null);
        }
      }}
      onPointerUp={() => setDragging(false)}
      onPointerLeave={() => {
        setDragging(false);
        setHovered(null);
      }}
      onWheel={(e) => {
        e.preventDefault();
        setZoom((z) =>
          Math.max(0.3, Math.min(4, z + (e.deltaY > 0 ? -0.1 : 0.1))),
        );
      }}
    >
      <canvas
        ref={canvasRef}
        onClick={(e) => {
          const node = toNode(e.clientX, e.clientY);
          if (node) setSelected(node);
        }}
        className="absolute inset-0 cursor-grab active:cursor-grabbing"
      />

      {/* Header badge */}
      <div
        className="absolute left-3 top-3 flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em]"
        style={{
          backgroundColor: `${T.boxBg}cc`,
          borderColor: `${T.borderColor}30`,
          color: T.accentColor,
          backdropFilter: "blur(8px)",
        }}
      >
        <FolderGit2 size={11} /> File Galaxy
        {data?.count != null && (
          <span style={{ color: T.textMuted }}>· {data.count} nodes</span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div
          className="absolute left-3 top-12 flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[10px]"
          style={{
            backgroundColor: `${T.boxBg}cc`,
            borderColor: `${T.borderColor}30`,
            color: T.textMuted,
          }}
        >
          <RefreshCw size={10} className="animate-spin" /> Scanning systems...
        </div>
      )}

      {/* Hint */}
      <div
        className="absolute bottom-3 left-3 flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[10px]"
        style={{
          backgroundColor: `${T.boxBg}cc`,
          borderColor: `${T.borderColor}30`,
          color: T.textMuted,
          backdropFilter: "blur(8px)",
        }}
      >
        Drag to pan · Scroll to zoom · Click nodes to inspect
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
        <button
          onClick={() => setZoom((z) => Math.max(0.3, z - 0.15))}
          className="rounded-lg border p-1.5 transition-transform hover:scale-110"
          style={{
            backgroundColor: `${T.boxBg}cc`,
            borderColor: `${T.borderColor}30`,
            color: T.textColor,
          }}
          title="Zoom out"
        >
          <ZoomOut size={13} />
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setRotation(0);
            setOffset({ x: 0, y: 0 });
          }}
          className="rounded-lg border p-1.5 transition-transform hover:scale-110"
          style={{
            backgroundColor: `${T.boxBg}cc`,
            borderColor: `${T.borderColor}30`,
            color: T.textColor,
          }}
          title="Reset view"
        >
          <Maximize2 size={13} />
        </button>
        <button
          onClick={() => setZoom((z) => Math.min(4, z + 0.15))}
          className="rounded-lg border p-1.5 transition-transform hover:scale-110"
          style={{
            backgroundColor: `${T.boxBg}cc`,
            borderColor: `${T.borderColor}30`,
            color: T.textColor,
          }}
          title="Zoom in"
        >
          <ZoomIn size={13} />
        </button>
        <button
          onClick={() => setRotation((r) => r + 15)}
          className="rounded-lg border p-1.5 transition-transform hover:scale-110"
          style={{
            backgroundColor: `${T.boxBg}cc`,
            borderColor: `${T.borderColor}30`,
            color: T.textColor,
          }}
          title="Rotate"
        >
          <RotateCw size={13} />
        </button>
        <button
          onClick={() => void load()}
          className="rounded-lg border p-1.5 transition-transform hover:scale-110"
          style={{
            backgroundColor: `${T.boxBg}cc`,
            borderColor: `${T.borderColor}30`,
            color: T.textColor,
          }}
          title="Refresh data"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Detail panel */}
      {selected && (
        <div
          className="absolute right-3 top-3 w-64 rounded-xl border p-3 shadow-2xl"
          style={{
            backgroundColor: `${T.boxBg}f0`,
            borderColor: `${T.borderColor}50`,
            backdropFilter: "blur(12px)",
          }}
        >
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              {selected.type === "system" ? (
                <FolderGit2 size={14} style={{ color: T.accentColor }} />
              ) : selected.type === "repo" ? (
                <Folder
                  size={14}
                  style={{ color: langColor(selected.meta?.language) }}
                />
              ) : (
                <Folder size={14} style={{ color: "#22d3ee" }} />
              )}
              <span
                className="text-sm font-black truncate max-w-[140px]"
                style={{ color: T.textColor }}
              >
                {selected.label}
              </span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="opacity-50 hover:opacity-100 transition-opacity"
              style={{ color: T.textMuted }}
            >
              <X size={14} />
            </button>
          </div>

          <div
            className="text-[10px] font-mono uppercase tracking-wider mb-2"
            style={{ color: T.textMuted }}
          >
            {selected.type}
            {selected.meta?.private && " · private"}
          </div>

          {selected.meta?.language && (
            <div
              className="flex items-center gap-1.5 mb-1.5 text-[11px]"
              style={{ color: T.textColor }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: langColor(selected.meta.language) }}
              />
              {selected.meta.language}
            </div>
          )}

          {selected.meta?.stars != null && selected.meta.stars > 0 && (
            <div
              className="flex items-center gap-1.5 mb-1.5 text-[11px]"
              style={{ color: T.textColor }}
            >
              <Star size={11} style={{ color: "#fbbf24" }} />
              {selected.meta.stars} stars
            </div>
          )}

          {selected.meta?.branch && (
            <div
              className="flex items-center gap-1.5 mb-1.5 text-[11px]"
              style={{ color: T.textColor }}
            >
              <GitBranch size={11} style={{ color: T.textMuted }} />
              {selected.meta.branch}
            </div>
          )}

          {selected.meta?.status && (
            <div
              className="flex items-center gap-1.5 mb-1.5 text-[11px]"
              style={{ color: T.textColor }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{
                  backgroundColor:
                    selected.meta.status === "online"
                      ? "#22c55e"
                      : selected.meta.status === "building"
                        ? "#f59e0b"
                        : "#6b7280",
                }}
              />
              {selected.meta.status}
            </div>
          )}

          {selected.meta?.private && (
            <div
              className="flex items-center gap-1.5 mb-1.5 text-[11px]"
              style={{ color: T.textMuted }}
            >
              <Lock size={11} /> Private repo
            </div>
          )}

          {selected.meta?.url && (
            <a
              href={selected.meta.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[11px] font-bold mt-2 transition-opacity hover:opacity-80"
              style={{ color: T.accentColor }}
            >
              <ExternalLink size={11} /> Open on GitHub
            </a>
          )}

          {selected.meta?.updated && (
            <div className="text-[10px] mt-2" style={{ color: T.textMuted }}>
              Updated {new Date(selected.meta.updated).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && data && data.count === 1 && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center max-w-xs px-4">
            <div className="text-3xl mb-2">🌌</div>
            <p
              className="text-sm font-bold mb-1"
              style={{ color: T.textColor }}
            >
              Your galaxy is waiting
            </p>
            <p className="text-[11px]" style={{ color: T.textMuted }}>
              Connect a GitHub account in{" "}
              <a
                href="/settings?tab=integrations"
                className="underline"
                style={{ color: T.accentColor }}
              >
                Settings → Integrations
              </a>{" "}
              to populate your file galaxy.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
