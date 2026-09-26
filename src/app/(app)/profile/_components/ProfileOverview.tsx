"use client";

import Link from "next/link";
import {
  Bot,
  FolderOpen,
  Image as ImageIcon,
  Plus,
  Activity,
} from "lucide-react";

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`ov-card ${className}`}
      style={{
        background:
          "linear-gradient(145deg, rgba(168,85,247,0.035), transparent 42%), rgba(16,16,20,0.88)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "18px",
        padding: "22px",
        boxShadow: "0 18px 50px rgba(0,0,0,0.26)",
        backdropFilter: "blur(14px)",
        transition: "transform 180ms ease, border-color 180ms ease",
      }}
    >
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  action,
  actionHref,
}: {
  title: string;
  action?: string;
  actionHref?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "16px",
      }}
    >
      <h2
        style={{
          fontSize: "16px",
          fontWeight: 700,
          color: "#f5f5f7",
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>
      {action && actionHref && (
        <Link
          href={actionHref}
          style={{
            fontSize: "12px",
            color: "#a855f7",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          {action} →
        </Link>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  desc,
  actionLabel,
  actionHref,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  actionLabel: string;
  actionHref: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "36px 20px",
        textAlign: "center",
        gap: "10px",
        border: "1px dashed rgba(255,255,255,0.08)",
        borderRadius: "14px",
        background: "rgba(255,255,255,0.01)",
      }}
    >
      <div style={{ color: "#3f3f46", marginBottom: "4px" }}>{icon}</div>
      <p style={{ fontSize: "14px", fontWeight: 600, color: "#a1a1aa" }}>
        {title}
      </p>
      <p
        style={{
          fontSize: "12px",
          color: "#52525b",
          maxWidth: "280px",
          lineHeight: 1.5,
        }}
      >
        {desc}
      </p>
      <Link
        href={actionHref}
        style={{
          marginTop: "6px",
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 16px",
          borderRadius: "10px",
          background: "rgba(168,85,247,0.12)",
          border: "1px solid rgba(168,85,247,0.3)",
          color: "#c084fc",
          fontSize: "12px",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        <Plus size={12} />
        {actionLabel}
      </Link>
    </div>
  );
}

export function ProfileOverview() {
  return (
    <div className="ov-grid">
      {/* === MAIN COLUMN === */}
      <div className="ov-main">
        {/* Recent Projects */}
        <Card>
          <SectionHeader
            title="Recent Projects"
            action="View all"
            actionHref="/projects"
          />
          <EmptyState
            icon={<FolderOpen size={36} />}
            title="No projects yet"
            desc="Start with a prompt, a repository, or a template."
            actionLabel="Start a project"
            actionHref="/create"
          />
        </Card>

        {/* Published Agents */}
        <Card>
          <SectionHeader
            title="Published Agents"
            action="View all"
            actionHref="/studio?tool=workflows"
          />
          <EmptyState
            icon={<Bot size={36} />}
            title="No agents published yet"
            desc="Build a specialized AI worker and add it to your profile."
            actionLabel="Open Mission Forge"
            actionHref="/studio?tool=workflows"
          />
        </Card>

        {/* Recent Artifacts */}
        <Card>
          <SectionHeader
            title="Recent Artifacts"
            action="View all"
            actionHref="/library/files"
          />
          <EmptyState
            icon={<ImageIcon size={36} />}
            title="Your generated work will appear here"
            desc="Use Studio to generate images, code, documents, and more."
            actionLabel="Open Studio"
            actionHref="/studio"
          />
        </Card>

        {/* Recent Activity */}
        <Card>
          <SectionHeader title="Recent Activity" />
          <EmptyState
            icon={<Activity size={36} />}
            title="No recent activity yet"
            desc="Your work across Studio will show up here as you build."
            actionLabel="Open Studio"
            actionHref="/studio"
          />
        </Card>
      </div>

      <style>{`
        .ov-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
        }
        .ov-main {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .ov-card:hover {
          transform: translateY(-2px);
          border-color: rgba(168,85,247,0.28) !important;
        }
      `}</style>
    </div>
  );
}
