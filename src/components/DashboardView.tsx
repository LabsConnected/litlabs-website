"use client";

import { useEffect, useState } from "react";
import { useUser, useAuth } from "@clerk/nextjs";
import { useProfile } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import {
  WorkspaceShell,
  PageHeader,
  Card,
  EmptyState,
  StatCard,
  StatusBadge,
  Skeleton,
} from "@/components/ui";
import {
  Plus,
  Rocket,
  MessageCircle,
  Folder,
  Bot,
  Image as ImageIcon,
  Users,
  ArrowRight,
  Zap,
  LogOut,
  ChevronDown,
} from "lucide-react";
import Link from "next/link";
import UsageChart from "@/components/dashboard/UsageChart";
import FileGalaxy from "@/components/dashboard/FileGalaxy";
import AutonomicLoopBanner from "@/components/dashboard/AutonomicLoopBanner";

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

function useSafeUser() {
  try {
    return useUser();
  } catch {
    return { user: null, isLoaded: true, isSignedIn: false } as ReturnType<
      typeof useUser
    >;
  }
}

function useSafeAuth() {
  try {
    return useAuth();
  } catch {
    return { signOut: undefined } as Partial<ReturnType<typeof useAuth>>;
  }
}

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
  primary,
  onClick,
}: {
  href?: string;
  icon: React.ElementType;
  label: string;
  primary?: boolean;
  onClick?: () => void;
}) {
  const { tokens } = useTheme();
  const content = (
    <div
      className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition-all hover:scale-[1.03] active:scale-[0.97]"
      style={
        primary
          ? {
              background: `linear-gradient(135deg, ${tokens.primary}, ${tokens.primary}cc)`,
              color: "#0a0a0f",
              boxShadow: `0 0 20px ${tokens.primary}40`,
            }
          : {
              border: `1px solid ${tokens.border}50`,
              color: tokens.text,
              backgroundColor: `${tokens.surface}80`,
            }
      }
    >
      <Icon size={14} />
      {label}
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
    <button type="button" onClick={onClick} className="block">
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

function OnboardingPanel({
  displayName,
  onTalkToLiTT,
}: {
  displayName: string;
  onTalkToLiTT: () => void;
}) {
  const { tokens } = useTheme();
  const steps = [
    {
      icon: Folder,
      label: "Create a project",
      description: "Connect a GitHub repo or start a local workspace.",
      href: "/projects",
    },
    {
      icon: ImageIcon,
      label: "Generate an artifact",
      description: "Create images, audio, or code in Studio.",
      href: "/studio?tool=image",
    },
    {
      icon: Bot,
      label: "Build your crew",
      description: "Install or create agents to automate work.",
      href: "/agents",
    },
  ];

  return (
    <Card padding="loose" className="mb-6">
      <div className="flex flex-col items-center text-center">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{
            backgroundColor: `${tokens.primary}15`,
            color: tokens.primary,
            boxShadow: `0 0 20px ${tokens.primary}20`,
          }}
        >
          <Rocket size={24} />
        </div>
        <h2 className="mt-4 text-lg font-black" style={{ color: tokens.text }}>
          Ready when you are, {displayName}
        </h2>
        <p
          className="mt-1 max-w-md text-xs"
          style={{ color: tokens.textMuted }}
        >
          Your mission control is empty. Pick a first step and LiTT Director
          will guide you.
        </p>
        <div className="mt-5 grid w-full gap-3 sm:grid-cols-3">
          {steps.map((step) => (
            <Link
              key={step.label}
              href={step.href}
              className="group flex flex-col items-center gap-2.5 rounded-2xl border p-4 text-center transition-all hover:scale-[1.02] hover:border-white/20"
              style={{ borderColor: `${tokens.border}40` }}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-xl transition-transform group-hover:scale-110"
                style={{
                  backgroundColor: `${tokens.primary}12`,
                  color: tokens.primary,
                }}
              >
                <step.icon size={18} />
              </div>
              <span
                className="text-xs font-black"
                style={{ color: tokens.text }}
              >
                {step.label}
              </span>
              <span className="text-[10px]" style={{ color: tokens.textMuted }}>
                {step.description}
              </span>
            </Link>
          ))}
        </div>
        <button
          type="button"
          onClick={onTalkToLiTT}
          className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-xs font-black transition-all hover:scale-[1.02] active:scale-[0.98]"
          style={{
            background: `linear-gradient(135deg, ${tokens.primary}, ${tokens.primary}cc)`,
            color: "#0a0a0f",
            boxShadow: `0 0 24px ${tokens.primary}40`,
          }}
        >
          <MessageCircle size={14} /> Talk to LiTT Director
        </button>
      </div>
    </Card>
  );
}

export default function DashboardView() {
  const { user } = useSafeUser();
  const { signOut } = useSafeAuth();
  const { profile } = useProfile();
  const { tokens } = useTheme();

  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Creator";

  const projects = useAsyncData(fetchProjects);
  const artifacts = useAsyncData(fetchArtifacts);
  const agents = useAsyncData(fetchAgents);
  const feed = useAsyncData(fetchFeed);

  const hasProjects = !projects.loading && (projects.data?.length ?? 0) > 0;
  const hasArtifacts = !artifacts.loading && (artifacts.data?.length ?? 0) > 0;
  const hasAgents = !agents.loading && (agents.data?.length ?? 0) > 0;
  const hasFeed = !feed.loading && (feed.data?.length ?? 0) > 0;

  const isEmpty =
    !projects.loading &&
    !artifacts.loading &&
    !agents.loading &&
    !hasProjects &&
    !hasArtifacts &&
    !hasAgents;

  const openChat = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("litt-chat-open"));
  };

  return (
    <WorkspaceShell>
      <AutonomicLoopBanner />

      <PageHeader
        title={`Welcome back, ${displayName}`}
        subtitle="Continue current mission"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton
              href="/studio"
              icon={Rocket}
              label="Open Studio"
              primary
            />
            <ActionButton href="/projects" icon={Plus} label="New Project" />
            <ActionButton
              icon={MessageCircle}
              label="Talk to LiTT"
              onClick={openChat}
            />
            <button
              onClick={() => signOut?.({ redirectUrl: "/" })}
              className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all hover:opacity-90"
              style={{ borderColor: `${tokens.border}50`, color: tokens.text }}
            >
              <LogOut size={14} /> Sign Out
            </button>
          </div>
        }
      />

      {isEmpty ? (
        <OnboardingPanel displayName={displayName} onTalkToLiTT={openChat} />
      ) : (
        <>
          {/* Middle grid */}
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Left + center column */}
            <div className="space-y-6 lg:col-span-2">
              {/* Current mission */}
              <section>
                <SectionTitle
                  title="Current mission"
                  action={
                    hasProjects
                      ? { label: "All projects", href: "/projects" }
                      : undefined
                  }
                />
                {projects.loading ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Skeleton className="h-24" />
                    <Skeleton className="h-24" />
                  </div>
                ) : hasProjects ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {projects.data?.map((p) => (
                      <Link
                        key={p.id}
                        href={`/projects?id=${p.id}`}
                        className="block min-w-0"
                      >
                        <Card interactive padding="normal">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div
                                className="truncate text-sm font-bold"
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
                              status={
                                p.status === "online" ? "running" : "offline"
                              }
                              label={p.status || "offline"}
                            />
                          </div>
                        </Card>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={<Folder size={24} />}
                    title="No projects yet"
                    description="Connect a GitHub repo or create a local project to start your first mission."
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
                )}
              </section>

              {/* Recent artifacts */}
              <section>
                <SectionTitle
                  title="Recent artifacts"
                  action={
                    hasArtifacts
                      ? { label: "Museum", href: "/gallery" }
                      : undefined
                  }
                />
                {artifacts.loading ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Skeleton className="aspect-square" />
                    <Skeleton className="aspect-square" />
                    <Skeleton className="aspect-square" />
                    <Skeleton className="aspect-square" />
                  </div>
                ) : hasArtifacts ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {artifacts.data?.map((a) => (
                      <Link
                        key={a.id}
                        href={`/gallery/${a.id}`}
                        className="block min-w-0 overflow-hidden rounded-xl border"
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
                          className="truncate p-2 text-[10px] font-bold"
                          style={{ color: tokens.text }}
                        >
                          {a.title}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
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
                        <ImageIcon size={12} /> Generate
                      </Link>
                    }
                  />
                )}
              </section>
            </div>

            {/* Right column */}
            <div className="space-y-6">
              {/* Active crew */}
              <section>
                <SectionTitle
                  title="Active crew"
                  action={
                    hasAgents ? { label: "Agents", href: "/agents" } : undefined
                  }
                />
                {agents.loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12" />
                    <Skeleton className="h-12" />
                  </div>
                ) : hasAgents ? (
                  <div className="space-y-2">
                    {agents.data?.slice(0, 4).map((a) => (
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
                              className="truncate text-xs font-bold"
                              style={{ color: tokens.text }}
                            >
                              {a.agent?.name || a.name || "Agent"}
                            </div>
                            <div
                              className="truncate text-[10px]"
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
                ) : (
                  <EmptyState
                    icon={<Bot size={24} />}
                    title="No crew yet"
                    description="Create or install agents from the marketplace."
                    action={
                      <Link
                        href="/agents"
                        className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold"
                        style={{
                          borderColor: tokens.border,
                          color: tokens.text,
                        }}
                      >
                        Browse agents
                      </Link>
                    }
                  />
                )}
              </section>

              {/* File Galaxy */}
              <section>
                <SectionTitle title="File Galaxy" />
                <div
                  className="h-72 overflow-hidden rounded-2xl border"
                  style={{ borderColor: tokens.border }}
                >
                  <FileGalaxy />
                </div>
              </section>
            </div>
          </div>

          {/* Bottom: Usage and community, collapsed by default */}
          <details
            className="group mt-6 rounded-2xl border"
            style={{ borderColor: tokens.border }}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between p-4 transition-colors hover:bg-white/5">
              <div className="flex items-center gap-2">
                <span
                  className="text-sm font-black"
                  style={{ color: tokens.text }}
                >
                  Usage and community
                </span>
                <span
                  className="text-[10px]"
                  style={{ color: tokens.textMuted }}
                >
                  {hasFeed ? `${feed.data?.length} new posts` : "No new posts"}
                </span>
              </div>
              <ChevronDown
                size={16}
                className="transition-transform group-open:rotate-180"
                style={{ color: tokens.textMuted }}
              />
            </summary>
            <div className="space-y-4 p-4 pt-0">
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Missions" value="0" icon={<Zap size={16} />} />
                <StatCard
                  label="Artifacts"
                  value={artifacts.data?.length ?? 0}
                  icon={<ImageIcon size={16} />}
                />
              </div>
              <div>
                <UsageChart />
              </div>
              <section>
                <SectionTitle
                  title="Community"
                  action={
                    hasFeed ? { label: "Feed", href: "/social" } : undefined
                  }
                />
                {feed.loading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-16" />
                    <Skeleton className="h-16" />
                  </div>
                ) : hasFeed ? (
                  <div className="space-y-2">
                    {feed.data?.map((post) => {
                      const authorObj = Array.isArray(post.author)
                        ? post.author[0]
                        : post.author;
                      const authorName =
                        authorObj?.name || authorObj?.username || "Unknown";
                      return (
                        <Card key={post.id} padding="compact">
                          <div
                            className="text-xs"
                            style={{ color: tokens.text }}
                          >
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
                ) : (
                  <EmptyState
                    icon={<Users size={24} />}
                    title="No recent activity"
                    description="Follow creators or share your first artifact."
                  />
                )}
              </section>
            </div>
          </details>
        </>
      )}
    </WorkspaceShell>
  );
}
