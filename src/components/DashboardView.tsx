"use client";

import { useEffect, useState } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import {
  WorkspaceShell,
  PageHeader,
  Panel,
  Card,
  EmptyState,
  StatCard,
  StatusBadge,
  Skeleton,
} from "@/components/ui";
import {
  Search,
  Plus,
  Wrench,
  Paintbrush,
  Bug,
  Rocket,
  Folder,
  Bot,
  Image as ImageIcon,
  Users,
  ArrowRight,
  Zap,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import UsageChart from "@/components/dashboard/UsageChart";
import HologramCore from "@/components/dashboard/HologramCore";

type Project = {
  id: string;
  repository: string;
  owner: string;
  status?: string;
  updated_at: string;
};

type Artifact = {
  id: string;
  title: string;
  imageUrl: string;
  mediaType: string;
  createdAt: string;
};

type Agent = {
  id: string;
  name: string;
  role?: string;
  status?: string;
  agent?: { name?: string; role?: string };
};

type FeedAuthor = {
  name?: string | null;
  username?: string | null;
};

type FeedItem = {
  id: string;
  content: string;
  author: FeedAuthor | FeedAuthor[] | null;
  created_at: string;
};

function useAsyncData<T>(fetcher: () => Promise<{ data?: T; error?: string }>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    fetcher().then((res) => {
      if (!mounted) return;
      if (res.error) setError(res.error);
      else setData(res.data ?? null);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [fetcher]);

  return { data, loading, error };
}

async function fetchProjects(): Promise<{ data?: Project[]; error?: string }> {
  try {
    const res = await fetch("/api/projects");
    if (!res.ok) return { error: "Failed to load projects" };
    const json = await res.json();
    return { data: json.projects || [] };
  } catch {
    return { error: "Failed to load projects" };
  }
}

async function fetchArtifacts(): Promise<{
  data?: Artifact[];
  error?: string;
}> {
  try {
    const res = await fetch("/api/gallery?view=my-uploads&limit=4");
    if (!res.ok) return { error: "Failed to load artifacts" };
    const json = await res.json();
    return { data: (json.items || []).slice(0, 4) };
  } catch {
    return { error: "Failed to load artifacts" };
  }
}

async function fetchAgents(): Promise<{ data?: Agent[]; error?: string }> {
  try {
    const res = await fetch("/api/user-agents");
    if (!res.ok) return { error: "Failed to load agents" };
    const json = await res.json();
    return { data: json.agents || [] };
  } catch {
    return { error: "Failed to load agents" };
  }
}

async function fetchFeed(): Promise<{ data?: FeedItem[]; error?: string }> {
  try {
    const res = await fetch("/api/feed?limit=3");
    if (!res.ok) return { error: "Failed to load feed" };
    const json = await res.json();
    return { data: (json.posts || []).slice(0, 3) };
  } catch {
    return { error: "Failed to load feed" };
  }
}

function ActionButton({
  href,
  icon: Icon,
  label,
  color,
  onClick,
}: {
  href?: string;
  icon: React.ElementType;
  label: string;
  color: string;
  onClick?: () => void;
}) {
  const { tokens } = useTheme();
  const content = (
    <div
      className="group flex flex-col items-center gap-2.5 rounded-2xl border p-4 text-center transition-all hover:scale-[1.03] hover:-translate-y-0.5 active:scale-[0.97]"
      style={{
        backgroundColor: tokens.surface,
        borderColor: `${color}25`,
        boxShadow: `0 0 0 1px ${color}08`,
      }}
    >
      <div
        className="flex h-11 w-11 items-center justify-center rounded-xl transition-all group-hover:scale-110"
        style={{
          backgroundColor: `${color}12`,
          color,
          boxShadow: `0 0 16px ${color}20`,
        }}
      >
        <Icon size={20} />
      </div>
      <span
        className="text-xs font-black tracking-wide"
        style={{ color: tokens.text }}
      >
        {label}
      </span>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className="block w-full">
      {content}
    </button>
  );
}

function SectionTitle({
  title,
  action,
}: {
  title: string;
  action?: { label: string; href: string };
}) {
  const { tokens } = useTheme();
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2
        className="text-sm font-black sm:text-base"
        style={{ color: tokens.text }}
      >
        {title}
      </h2>
      {action && (
        <Link
          href={action.href}
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
          style={{ color: tokens.primary }}
        >
          {action.label} <ArrowRight size={10} />
        </Link>
      )}
    </div>
  );
}

export default function DashboardView() {
  const { user } = useUser();
  const { signOut } = useAuth();
  const { profile } = useProfile();
  const { tokens } = useTheme();

  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Creator";

  const projects = useAsyncData(fetchProjects);
  const artifacts = useAsyncData(fetchArtifacts);
  const agents = useAsyncData(fetchAgents);
  const feed = useAsyncData(fetchFeed);

  return (
    <WorkspaceShell>
      <PageHeader
        title={`Welcome back, ${displayName}`}
        subtitle="Your mission control. Pick up where you left off or start something new."
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => signOut?.({ redirectUrl: "/" })}
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition-all hover:opacity-90 hover:scale-[1.02]"
              style={{
                border: `1px solid ${tokens.border}50`,
                color: tokens.text,
              }}
            >
              <LogOut size={14} /> Sign Out
            </button>
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black text-black transition-all hover:opacity-90 hover:scale-[1.02]"
              style={{
                background: `linear-gradient(135deg, ${tokens.primary}, ${tokens.primary}cc)`,
                boxShadow: `0 0 20px ${tokens.primary}40`,
              }}
            >
              <Plus size={14} /> Open Studio
            </Link>
          </div>
        }
      />

      {/* Search / command bar */}
      <Panel className="mb-6 flex items-center gap-3" padding="compact">
        <Search size={15} style={{ color: tokens.textMuted }} />
        <input
          type="text"
          placeholder="Search projects, agents, artifacts..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-500"
          style={{ color: tokens.text }}
        />
        <kbd
          className="hidden rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest sm:block"
          style={{
            backgroundColor: `${tokens.border}40`,
            color: tokens.textMuted,
          }}
        >
          ⌘K
        </kbd>
      </Panel>

      {/* Continue + Activity */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card
          padding="loose"
          className="relative flex flex-col justify-between overflow-hidden"
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              background: `radial-gradient(circle at 0% 0%, ${tokens.primary}15 0%, transparent 60%)`,
            }}
          />
          <div className="relative">
            <div
              className="text-[10px] font-black uppercase tracking-widest"
              style={{ color: tokens.textMuted }}
            >
              Continue working
            </div>
            <h3
              className="mt-2 text-lg font-black"
              style={{ color: tokens.text }}
            >
              LiTT Studio
            </h3>
            <p
              className="mt-1 text-xs leading-relaxed"
              style={{ color: tokens.textMuted }}
            >
              Your AI crew is standing by. Start a mission or review pending
              work.
            </p>
          </div>
          <div className="relative mt-4 flex gap-2">
            <Link
              href="/studio"
              className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-black text-black transition-all hover:opacity-90"
              style={{
                backgroundColor: tokens.primary,
                boxShadow: `0 0 16px ${tokens.primary}40`,
              }}
            >
              Open Studio <ArrowRight size={12} />
            </Link>
            <Link
              href="/projects"
              className="inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-bold transition-all hover:opacity-80"
              style={{ borderColor: tokens.border, color: tokens.text }}
            >
              Projects
            </Link>
          </div>
        </Card>

        <Card padding="loose">
          <div
            className="text-[10px] font-black uppercase tracking-widest"
            style={{ color: tokens.textMuted }}
          >
            Live activity
          </div>
          <div className="mt-3 space-y-2.5">
            <div className="flex items-center gap-2.5 text-xs">
              <StatusBadge status="running" label="Director" />
              <span style={{ color: tokens.textMuted }}>
                Standing by for your next mission.
              </span>
            </div>
            <div className="flex items-center gap-2.5 text-xs">
              <StatusBadge status="pending" label="0 tasks" />
              <span style={{ color: tokens.textMuted }}>
                No active generations.
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Mission actions */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ActionButton
          href="/studio"
          icon={Wrench}
          label="Build"
          color={tokens.primary}
        />
        <ActionButton
          href="/studio?tool=image"
          icon={Paintbrush}
          label="Create"
          color="#ec4899"
        />
        <ActionButton href="/studio" icon={Bug} label="Fix" color="#f59e0b" />
        <ActionButton
          href="/deployments"
          icon={Rocket}
          label="Deploy"
          color="#22c55e"
        />
      </div>

      {/* Main grid */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Left + center column */}
        <div className="space-y-6 lg:col-span-2">
          {/* Recent projects */}
          <section>
            <SectionTitle
              title="Recent projects"
              action={{ label: "All projects", href: "/projects" }}
            />
            {projects.loading ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-24" />
                <Skeleton className="h-24" />
              </div>
            ) : projects.error || !projects.data?.length ? (
              <EmptyState
                icon={<Folder size={24} />}
                title="No projects yet"
                description="Connect a GitHub repo to create your first project workspace."
                action={
                  <Link
                    href="/projects"
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-black"
                    style={{ backgroundColor: tokens.primary }}
                  >
                    <Plus size={12} /> New project
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {projects.data.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects?id=${p.id}`}
                    className="block"
                  >
                    <Card interactive padding="normal">
                      <div className="flex items-start justify-between">
                        <div>
                          <div
                            className="text-sm font-bold"
                            style={{ color: tokens.text }}
                          >
                            {p.owner}/{p.repository}
                          </div>
                          <div
                            className="mt-1 text-[10px]"
                            style={{ color: tokens.textMuted }}
                          >
                            Updated{" "}
                            {new Date(p.updated_at).toLocaleDateString()}
                          </div>
                        </div>
                        <StatusBadge
                          status={p.status === "online" ? "running" : "offline"}
                          label={p.status || "offline"}
                        />
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Recent artifacts */}
          <section>
            <SectionTitle
              title="Recent artifacts"
              action={{ label: "Museum", href: "/gallery" }}
            />
            {artifacts.loading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Skeleton className="aspect-square" />
                <Skeleton className="aspect-square" />
                <Skeleton className="aspect-square" />
                <Skeleton className="aspect-square" />
              </div>
            ) : artifacts.error || !artifacts.data?.length ? (
              <EmptyState
                icon={<ImageIcon size={24} />}
                title="No artifacts yet"
                description="Generate your first image, audio, or code artifact in Studio."
                action={
                  <Link
                    href="/studio?tool=image"
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-black"
                    style={{ backgroundColor: tokens.primary }}
                  >
                    <Paintbrush size={12} /> Generate
                  </Link>
                }
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {artifacts.data.map((a) => (
                  <Link
                    key={a.id}
                    href={`/gallery/${a.id}`}
                    className="block overflow-hidden rounded-xl border"
                    style={{ borderColor: tokens.border }}
                  >
                    <div className="aspect-square bg-neutral-900">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.imageUrl}
                        alt={a.title}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div
                      className="p-2 text-[10px] font-bold truncate"
                      style={{ color: tokens.text }}
                    >
                      {a.title}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Hologram Core */}
          <section className="flex flex-col items-center">
            <Card padding="loose" className="w-full flex flex-col items-center">
              <HologramCore
                size={240}
                label="LiTT Core"
                trackCursor
                trackKeyboard
              />
              <p
                className="mt-2 text-center text-[10px]"
                style={{ color: tokens.textMuted }}
              >
                The core reacts to your voice, typing, and cursor — talk to LiTT
                Director to wake it up.
              </p>
            </Card>
          </section>

          {/* Active agents */}
          <section>
            <SectionTitle
              title="Active agents"
              action={{ label: "Agents", href: "/agents" }}
            />
            {agents.loading ? (
              <div className="space-y-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : agents.error || !agents.data?.length ? (
              <EmptyState
                icon={<Bot size={24} />}
                title="No agents yet"
                description="Create or install agents from the marketplace."
                action={
                  <Link
                    href="/agents"
                    className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold"
                    style={{ borderColor: tokens.border, color: tokens.text }}
                  >
                    Browse agents
                  </Link>
                }
              />
            ) : (
              <div className="space-y-2">
                {agents.data.slice(0, 4).map((a) => (
                  <Card key={a.id} padding="compact">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-8 w-8 items-center justify-center rounded-lg"
                        style={{
                          backgroundColor: `${tokens.primary}15`,
                          color: tokens.primary,
                        }}
                      >
                        <Bot size={14} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-xs font-bold truncate"
                          style={{ color: tokens.text }}
                        >
                          {a.agent?.name || a.name || "Agent"}
                        </div>
                        <div
                          className="text-[10px] truncate"
                          style={{ color: tokens.textMuted }}
                        >
                          {a.agent?.role || a.role || "Agent"}
                        </div>
                      </div>
                      <StatusBadge
                        status={a.status === "online" ? "running" : "idle"}
                        label={a.status || "idle"}
                      />
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {/* Usage / health */}
          <section>
            <SectionTitle title="Usage" />
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Missions" value="0" icon={<Zap size={16} />} />
              <StatCard
                label="Artifacts"
                value={artifacts.data?.length ?? 0}
                icon={<ImageIcon size={16} />}
              />
            </div>
            <div className="mt-3">
              <UsageChart />
            </div>
          </section>

          {/* Social preview */}
          <section>
            <SectionTitle
              title="Community"
              action={{ label: "Feed", href: "/social" }}
            />
            {feed.loading ? (
              <div className="space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : feed.error || !feed.data?.length ? (
              <EmptyState
                icon={<Users size={24} />}
                title="No recent activity"
                description="Follow creators or share your first artifact."
              />
            ) : (
              <div className="space-y-2">
                {feed.data.map((post) => {
                  const authorObj = Array.isArray(post.author)
                    ? post.author[0]
                    : post.author;
                  const authorName =
                    authorObj?.name || authorObj?.username || "Unknown";
                  return (
                    <Card key={post.id} padding="compact">
                      <div className="text-xs" style={{ color: tokens.text }}>
                        {post.content.slice(0, 80)}
                        {post.content.length > 80 ? "..." : ""}
                      </div>
                      <div
                        className="mt-1 text-[10px]"
                        style={{ color: tokens.textMuted }}
                      >
                        {authorName} ·{" "}
                        {new Date(post.created_at).toLocaleDateString()}
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </WorkspaceShell>
  );
}
