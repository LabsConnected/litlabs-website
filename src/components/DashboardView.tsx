"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
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
} from "lucide-react";
import Link from "next/link";

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
      className="flex flex-col items-center gap-2 rounded-xl sm:rounded-2xl border p-4 text-center transition-all hover:scale-[1.02] active:scale-[0.98]"
      style={{
        backgroundColor: tokens.surface,
        borderColor: `${color}30`,
      }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-lg"
        style={{ backgroundColor: `${color}15`, color }}
      >
        <Icon size={20} />
      </div>
      <span className="text-xs font-bold" style={{ color: tokens.text }}>
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
        title={`Good to see you, ${displayName}`}
        subtitle="Your daily overview. Pick up where you left off or start something new."
        actions={
          <Link
            href="/studio"
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-black transition-opacity hover:opacity-90"
            style={{ backgroundColor: tokens.primary }}
          >
            <Plus size={14} /> Create
          </Link>
        }
      />

      {/* Search / command bar */}
      <Panel className="mb-6 flex items-center gap-3" padding="compact">
        <Search size={16} style={{ color: tokens.textMuted }} />
        <input
          type="text"
          placeholder="Search projects, agents, artifacts..."
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-500"
          style={{ color: tokens.text }}
        />
      </Panel>

      {/* Continue + Activity */}
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card padding="loose" className="flex flex-col justify-between">
          <div>
            <div
              className="text-[10px] font-bold uppercase tracking-wider"
              style={{ color: tokens.textMuted }}
            >
              Continue working
            </div>
            <h3
              className="mt-2 text-lg font-black"
              style={{ color: tokens.text }}
            >
              LiTT Code Workspace
            </h3>
            <p className="mt-1 text-xs" style={{ color: tokens.textMuted }}>
              Last active today. 3 pending changes ready for review.
            </p>
          </div>
          <div className="mt-4 flex gap-2">
            <Link
              href="/studio"
              className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold text-black"
              style={{ backgroundColor: tokens.primary }}
            >
              Open Studio <ArrowRight size={12} />
            </Link>
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold"
              style={{ borderColor: tokens.border, color: tokens.text }}
            >
              View projects
            </Link>
          </div>
        </Card>

        <Card padding="loose">
          <div
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: tokens.textMuted }}
          >
            Live activity
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2 text-xs">
              <StatusBadge status="running" label="Director idle" />
              <span style={{ color: tokens.textMuted }}>
                Waiting for your next mission.
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <StatusBadge status="pending" label="0 running" />
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
            <div
              className="mt-3 rounded-lg border p-3 text-[10px]"
              style={{ borderColor: tokens.border, color: tokens.textMuted }}
            >
              Usage tracking is in beta. Credits and detailed spend will appear
              here once billing is connected.
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
