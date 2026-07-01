"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { ZoomIn, ZoomOut, RotateCw, Maximize2, Filter } from "lucide-react";

export interface GalaxyNode {
  id: string;
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  type: "agent" | "user" | "server" | "database" | "post";
  status: "active" | "idle" | "offline";
  connections: string[];
  data?: Record<string, unknown>;
}

interface GalaxyMapProps {
  nodes?: GalaxyNode[];
  onNodeClick?: (node: GalaxyNode) => void;
  interactive?: boolean;
  filterType?: string;
}

export default function GalaxyMap({ 
  nodes = [], 
  onNodeClick, 
  interactive = true,
  filterType = "all"
}: GalaxyMapProps) {
  const { resolvedColors: T } = useTheme();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const animationRef = useRef<number>();

  // Filter nodes by type
  const filteredNodes = filterType === "all" 
    ? nodes 
    : nodes.filter(node => node.type === filterType);

  // Generate default nodes if none provided
  const defaultNodes: GalaxyNode[] = [
    { id: "center", x: 0, y: 0, size: 40, color: "#f97316", label: "Core", type: "server", status: "active", connections: [] },
    { id: "jarvis", x: -100, y: -50, size: 25, color: "#00ffff", label: "JARVIS", type: "agent", status: "active", connections: ["center"] },
    { id: "forge", x: 100, y: -50, size: 25, color: "#22d3ee", label: "Forge", type: "agent", status: "active", connections: ["center"] },
    { id: "pulse", x: -50, y: 100, size: 25, color: "#f472b6", label: "Pulse", type: "agent", status: "idle", connections: ["center"] },
    { id: "visionary", x: 50, y: 100, size: 25, color: "#e879f9", label: "Visionary", type: "agent", status: "active", connections: ["center"] },
    { id: "nexus", x: 0, y: 150, size: 25, color: "#34d399", label: "Nexus", type: "agent", status: "active", connections: ["center"] },
    { id: "db", x: -150, y: 0, size: 20, color: "#10b981", label: "Database", type: "database", status: "active", connections: ["center"] },
    { id: "users", x: 150, y: 0, size: 20, color: "#8b5cf6", label: "Users", type: "user", status: "active", connections: ["center"] },
  ];

  const displayNodes = filteredNodes.length > 0 ? filteredNodes : defaultNodes;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;

    // Clear canvas
    ctx.fillStyle = T.bgColor + "00";
    ctx.fillRect(0, 0, width, height);

    // Draw background stars
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const size = Math.random() * 2;
      const opacity = Math.random() * 0.5;
      ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(centerX + offset.x, centerY + offset.y);
    ctx.scale(zoom, zoom);
    ctx.rotate((rotation * Math.PI) / 180);

    // Draw connections
    displayNodes.forEach((node) => {
      node.connections.forEach((targetId) => {
        const target = displayNodes.find(n => n.id === targetId);
        if (target) {
          ctx.beginPath();
          ctx.moveTo(node.x, node.y);
          ctx.lineTo(target.x, target.y);
          ctx.strokeStyle = node.color + "40";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    });

    // Draw nodes
    displayNodes.forEach((node) => {
      // Glow effect
      const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, node.size * 2);
      gradient.addColorStop(0, node.color + "40");
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size * 2, 0, Math.PI * 2);
      ctx.fill();

      // Main node
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.size, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();

      // Status indicator
      const statusColor = node.status === "active" ? "#22c55e" : node.status === "idle" ? "#f59e0b" : "#6b7280";
      ctx.beginPath();
      ctx.arc(node.x + node.size * 0.7, node.y - node.size * 0.7, 4, 0, Math.PI * 2);
      ctx.fillStyle = statusColor;
      ctx.fill();

      // Label
      ctx.fillStyle = T.textColor;
      ctx.font = "10px Inter";
      ctx.textAlign = "center";
      ctx.fillText(node.label, node.x, node.y + node.size + 15);
    });

    ctx.restore();
  }, [displayNodes, T, offset, zoom, rotation]);

  useEffect(() => {
    draw();
    animationRef.current = requestAnimationFrame(animate);
  }, [draw]);

  const animate = () => {
    // Subtle animation for active nodes
    displayNodes.forEach((node, i) => {
      if (node.status === "active") {
        node.size = 25 + Math.sin(Date.now() / 1000 + i) * 2;
      }
    });
    draw();
    animationRef.current = requestAnimationFrame(animate);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!interactive) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom((prev) => Math.max(0.5, Math.min(3, prev + delta)));
  };

  const handleNodeClick = (e: React.MouseEvent, node: GalaxyNode) => {
    if (interactive && onNodeClick) {
      onNodeClick(node);
    }
  };

  return (
    <div className="relative w-full h-full" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onWheel={handleWheel}>
      <canvas
        ref={canvasRef}
        onClick={(e) => {
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) return;
          const x = e.clientX - rect.left - rect.width / 2 - offset.x;
          const y = e.clientY - rect.top - rect.height / 2 - offset.y;
          const clickedNode = displayNodes.find(node => {
            const dx = node.x - x / zoom;
            const dy = node.y - y / zoom;
            return Math.sqrt(dx * dx + dy * dy) < node.size;
          });
          if (clickedNode) handleNodeClick(e, clickedNode);
        }}
        style={{ width: "100%", height: "100%" }}
      />
      
      {/* Controls */}
      <div className="absolute bottom-4 left-4 flex items-center gap-2">
        <button
          onClick={() => setZoom((prev) => Math.max(0.5, prev - 0.2))}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ backgroundColor: T.boxBg + "80", color: T.textColor }}
        >
          <ZoomOut size={16} />
        </button>
        <div className="px-3 py-1 rounded-lg text-xs font-bold" style={{ backgroundColor: T.boxBg + "80", color: T.textColor }}>
          {Math.round(zoom * 100)}%
        </div>
        <button
          onClick={() => setZoom((prev) => Math.min(3, prev + 0.2))}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ backgroundColor: T.boxBg + "80", color: T.textColor }}
        >
          <ZoomIn size={16} />
        </button>
        <button
          onClick={() => setRotation((prev) => prev + 15)}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ backgroundColor: T.boxBg + "80", color: T.textColor }}
        >
          <RotateCw size={16} />
        </button>
        <button
          onClick={() => { setZoom(1); setRotation(0); setOffset({ x: 0, y: 0 }); }}
          className="p-2 rounded-lg transition-all hover:scale-110"
          style={{ backgroundColor: T.boxBg + "80", color: T.textColor }}
        >
          <Maximize2 size={16} />
        </button>
      </div>
      
      {/* Filter indicator */}
      {filterType !== "all" && (
        <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ backgroundColor: T.accentColor + "20", color: T.accentColor }}
        >
          <Filter size={14} />
          <span className="text-xs font-bold capitalize">{filterType}</span>
        </div>
      )}
    </div>
  );
}
