"use client";

import Link from "next/link";
import {
  ExternalLink,
  Bot,
  FolderOpen,
  Image as ImageIcon,
  Rocket,
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

function ProjectCard({
  name,
  desc,
  status,
  tags,
}: {
  name: string;
  desc: string;
  status: "live" | "building" | "draft";
  tags: string[];
}) {
  const statusColor =
    status === "live"
      ? "#34d399"
      : status === "building"
        ? "#f59e0b"
        : "#71717a";
  return (
    <div
      className="proj-card"
      style={{
        background: "rgba(16,16,20,0.7)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "14px",
        padding: "18px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        transition: "transform 180ms, border-color 180ms",
        cursor: "pointer",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "10px",
            background:
              "linear-gradient(135deg, rgba(168,85,247,0.25), rgba(48,231,255,0.1))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <FolderOpen size={18} style={{ color: "#a855f7" }} />
        </div>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            color: statusColor,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "2px 8px",
            borderRadius: "999px",
            border: `1px solid ${statusColor}40`,
            background: `${statusColor}12`,
          }}
        >
          {status}
        </span>
      </div>
      <div>
        <p
          style={{
            fontSize: "14px",
            fontWeight: 700,
            color: "#f5f5f7",
            marginBottom: "4px",
          }}
        >
          {name}
        </p>
        <p style={{ fontSize: "12px", color: "#71717a", lineHeight: 1.5 }}>
          {desc}
        </p>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
        {tags.map((t) => (
          <span
            key={t}
            style={{
              fontSize: "10px",
              padding: "2px 7px",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#71717a",
            }}
          >
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function AgentCard({
  name,
  role,
  desc,
  runs,
  isPublic,
}: {
  name: string;
  role: string;
  desc: string;
  runs: number;
  isPublic: boolean;
}) {
  return (
    <div
      style={{
        background: "rgba(16,16,20,0.7)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "14px",
        padding: "18px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        transition: "transform 180ms, border-color 180ms",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            width: "40px",
            height: "40px",
            borderRadius: "10px",
            background:
              "linear-gradient(135deg, rgba(236,72,153,0.2), rgba(168,85,247,0.15))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Bot size={18} style={{ color: "#ec4899" }} />
        </div>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            color: isPublic ? "#30e7ff" : "#71717a",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "2px 8px",
            borderRadius: "999px",
            border: `1px solid ${isPublic ? "#30e7ff40" : "rgba(255,255,255,0.08)"}`,
            background: isPublic
              ? "rgba(48,231,255,0.08)"
              : "rgba(255,255,255,0.03)",
          }}
        >
          {isPublic ? "Public" : "Private"}
        </span>
      </div>
      <div>
        <p
          style={{
            fontSize: "14px",
            fontWeight: 700,
            color: "#f5f5f7",
            marginBottom: "2px",
          }}
        >
          {name}
        </p>
        <p
          style={{
            fontSize: "11px",
            color: "#a855f7",
            fontWeight: 600,
            marginBottom: "4px",
          }}
        >
          {role}
        </p>
        <p style={{ fontSize: "12px", color: "#71717a", lineHeight: 1.5 }}>
          {desc}
        </p>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          fontSize: "11px",
          color: "#52525b",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
          <Rocket size={11} /> {runs.toLocaleString()} runs
        </span>
      </div>
    </div>
  );
}

function ActivityItem({
  icon,
  text,
  time,
}: {
  icon: React.ReactNode;
  text: string;
  time: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
      <div
        style={{
          width: "32px",
          height: "32px",
          borderRadius: "999px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: "13px", color: "#a1a1aa", lineHeight: 1.5 }}>
          {text}
        </p>
        <p style={{ fontSize: "11px", color: "#52525b", marginTop: "2px" }}>
          {time}
        </p>
      </div>
    </div>
  );
}

const SAMPLE_PROJECTS = [
  {
    name: "LiTTree Studio",
    desc: "AI-powered workspace for creators. Build, deploy, and manage AI agents.",
    status: "live" as const,
    tags: ["Next.js", "Supabase", "AI Agent"],
  },
  {
    name: "Agent Marketplace",
    desc: "Discover, install, and publish specialized AI workers.",
    status: "building" as const,
    tags: ["OpenRouter", "Stripe", "React"],
  },
];

const SAMPLE_AGENTS = [
  {
    name: "Forge",
    role: "Engineering Agent",
    desc: "Builds, debugs, tests, and deploys applications autonomously.",
    runs: 1204,
    isPublic: true,
  },
  {
    name: "Litt",
    role: "Creative Director",
    desc: "Generates visual content, writes copy, and manages creative campaigns.",
    runs: 843,
    isPublic: false,
  },
];

const SAMPLE_ACTIVITY = [
  {
    icon: <Rocket size={14} style={{ color: "#34d399" }} />,
    text: "Deployed LiTTree Studio to production",
    time: "2 hours ago",
  },
  {
    icon: <Bot size={14} style={{ color: "#a855f7" }} />,
    text: "Published the Forge agent to marketplace",
    time: "1 day ago",
  },
  {
    icon: <ImageIcon size={14} style={{ color: "#30e7ff" }} />,
    text: "Generated 6 new visual artifacts in Studio",
    time: "2 days ago",
  },
  {
    icon: <Activity size={14} style={{ color: "#f59e0b" }} />,
    text: "Earned Agent Architect achievement",
    time: "3 days ago",
  },
];

export function ProfileOverview({
  hasProjects = false,
  hasAgents = false,
}: {
  hasProjects?: boolean;
  hasAgents?: boolean;
}) {
  return (
    <div className="ov-grid">
      {/* === MAIN COLUMN === */}
      <div className="ov-main">
        {/* Featured Work */}
        <Card>
          <SectionHeader title="Featured Work" />
          <div
            style={{
              borderRadius: "12px",
              overflow: "hidden",
              background:
                "linear-gradient(135deg, rgba(168,85,247,0.15), rgba(48,231,255,0.08))",
              border: "1px solid rgba(168,85,247,0.2)",
              padding: "28px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              minHeight: "160px",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    color: "#34d399",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    padding: "2px 8px",
                    borderRadius: "999px",
                    border: "1px solid rgba(52,211,153,0.3)",
                    background: "rgba(52,211,153,0.08)",
                  }}
                >
                  Live
                </span>
                <span style={{ fontSize: "11px", color: "#52525b" }}>
                  Flagship Project
                </span>
              </div>
              <h3
                style={{
                  fontSize: "22px",
                  fontWeight: 800,
                  color: "#f5f5f7",
                  letterSpacing: "-0.02em",
                }}
              >
                LiTTree LabStudios
              </h3>
              <p
                style={{
                  fontSize: "13px",
                  color: "#a1a1aa",
                  marginTop: "6px",
                  lineHeight: 1.6,
                  maxWidth: "480px",
                }}
              >
                A full-stack AI operating system for creators. Build agents,
                generate content, manage projects, and deploy — all in one
                platform.
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Link
                href="/studio"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 16px",
                  borderRadius: "10px",
                  background: "linear-gradient(135deg, #a855f7, #c084fc)",
                  color: "#09090b",
                  fontSize: "12px",
                  fontWeight: 700,
                  textDecoration: "none",
                }}
              >
                <ExternalLink size={12} /> Open Studio
              </Link>
            </div>
          </div>
        </Card>

        {/* Recent Projects */}
        <Card>
          <SectionHeader
            title="Recent Projects"
            action="View all"
            actionHref="/projects"
          />
          {hasProjects ? (
            <div className="proj-grid">
              {SAMPLE_PROJECTS.map((p) => (
                <ProjectCard key={p.name} {...p} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<FolderOpen size={36} />}
              title="No projects yet"
              desc="Start with a prompt, a repository, or a template."
              actionLabel="Start a project"
              actionHref="/projects/new"
            />
          )}
        </Card>

        {/* Published Agents */}
        <Card>
          <SectionHeader
            title="Published Agents"
            action="View all"
            actionHref="/agents"
          />
          {hasAgents ? (
            <div className="proj-grid">
              {SAMPLE_AGENTS.map((a) => (
                <AgentCard key={a.name} {...a} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Bot size={36} />}
              title="No agents published yet"
              desc="Build a specialized AI worker and add it to your profile."
              actionLabel="Create agent"
              actionHref="/agents/new"
            />
          )}
        </Card>

        {/* Recent Artifacts */}
        <Card>
          <SectionHeader
            title="Recent Artifacts"
            action="View all"
            actionHref="/gallery?source=user"
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
          <div
            style={{ display: "flex", flexDirection: "column", gap: "16px" }}
          >
            {SAMPLE_ACTIVITY.map((a, i) => (
              <ActivityItem key={i} {...a} />
            ))}
          </div>
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
        .proj-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        .proj-card:hover {
          transform: translateY(-2px);
          border-color: rgba(168,85,247,0.25) !important;
        }
        @media (max-width: 600px) {
          .proj-grid { grid-template-columns: 1fr; }
        }
      `}</style>
    </div>
  );
}
