"use client";

import Link from "next/link";
import { Sparkles, FolderPlus, Bot, Image as ImageIcon } from "lucide-react";

const ACTIONS = [
  { label: "New Project", href: "/projects/new", icon: FolderPlus, color: "#a855f7" },
  { label: "Generate", href: "/studio?tool=image", icon: ImageIcon, color: "#30e7ff" },
  { label: "Create Agent", href: "/agents/new", icon: Bot, color: "#ec4899" },
  { label: "Open Studio", href: "/studio", icon: Sparkles, color: "#34d399" },
];

export function CreatorActionPanel() {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: "18px",
        border: "1px solid rgba(168,85,247,0.2)",
        background:
          "linear-gradient(145deg, rgba(168,85,247,0.08), rgba(48,231,255,0.04) 50%, transparent), rgba(16,16,20,0.9)",
        padding: "28px",
        boxShadow: "0 18px 50px rgba(0,0,0,0.26)",
      }}
    >
      {/* Subtle grid pattern */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
          maskImage: "radial-gradient(ellipse at 60% 50%, black 20%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(ellipse at 60% 50%, black 20%, transparent 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <Sparkles size={16} style={{ color: "#a855f7" }} />
          <h3 style={{ fontSize: "18px", fontWeight: 750, color: "#f5f5f7", letterSpacing: "-0.01em" }}>
            Build what comes next.
          </h3>
        </div>
        <p style={{ fontSize: "13px", color: "#71717a", marginBottom: "20px", maxWidth: "400px", lineHeight: 1.6 }}>
          Launch a project, generate media, or create a specialized agent directly from your profile.
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          {ACTIONS.map(({ label, href, icon: Icon, color }) => (
            <Link
              key={label}
              href={href}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "10px 18px",
                borderRadius: "12px",
                border: `1px solid ${color}30`,
                background: `${color}0e`,
                color: color,
                fontSize: "13px",
                fontWeight: 700,
                textDecoration: "none",
                transition: "transform 180ms, background 180ms",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
                (e.currentTarget as HTMLElement).style.background = `${color}18`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.transform = "";
                (e.currentTarget as HTMLElement).style.background = `${color}0e`;
              }}
            >
              <Icon size={14} />
              {label}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
