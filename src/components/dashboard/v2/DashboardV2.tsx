"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useAppUser } from "@/hooks/useClerkAuth";
import { useProfile } from "@/context/ProfileContext";
import MusicPlayer from "@/components/dashboard/MusicPlayer";
import { Card } from "./DashboardV2Primitives";
import { Icon, getGreeting } from "./dashboard-v2-utils";
import { LiTTDailyBrief } from "./LiTTDailyBrief";
import { ContinueProjectCard } from "./ContinueProjectCard";
import { CurrentMissionCard } from "./CurrentMissionCard";
import { UnifiedInboxCard } from "./UnifiedInboxCard";
import { YourWorldCard } from "./YourWorldCard";
import { RecentWorkCard } from "./RecentWorkCard";
import { CommunityPulseCard } from "./CommunityPulseCard";
import { SystemHealthStrip } from "./SystemHealthStrip";
import { DashboardQuickCreate } from "./DashboardQuickCreate";
import type { DashboardData, LlmHealth, SocialPost } from "./dashboard-v2-types";

export function DashboardV2() {
  const T = useTheme().resolvedColors;
  const { user } = useAppUser();
  const { profile } = useProfile();
  const [data, setData] = useState<DashboardData | null>(null);
  const [llmHealth, setLlmHealth] = useState<LlmHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socialPosts, setSocialPosts] = useState<SocialPost[]>([]);
  const [socialLoading, setSocialLoading] = useState(true);
  const [socialError, setSocialError] = useState<string | null>(null);
  const [socialMock, setSocialMock] = useState(false);

  const fetchDashboard = useCallback(async () => {
    setError(null);
    try {
      const [dashRes, healthRes, socialRes] = await Promise.allSettled([
        fetch("/api/dashboard"),
        fetch("/api/llm/health"),
        fetch("/api/posts?limit=5"),
      ]);
      if (dashRes.status === "fulfilled" && dashRes.value.ok) {
        setData(await dashRes.value.json());
      } else if (dashRes.status === "fulfilled" && !dashRes.value.ok) {
        setError(
          dashRes.value.status === 401
            ? "Your sign-in session needs to be refreshed."
            : "Some connected workspace data is temporarily unavailable.",
        );
      }
      if (healthRes.status === "fulfilled" && healthRes.value.ok) {
        setLlmHealth(await healthRes.value.json());
      }
      if (socialRes.status === "fulfilled" && socialRes.value.ok) {
        const socialJson = await socialRes.value.json();
        if (socialJson.mock === true) {
          setSocialMock(true);
          setSocialPosts([]);
        } else {
          setSocialMock(false);
          setSocialPosts(socialJson.posts ?? socialJson ?? []);
        }
        setSocialError(null);
      } else if (socialRes.status === "fulfilled" && !socialRes.value.ok) {
        setSocialError("Failed to load community feed.");
      }
      if (socialRes.status === "rejected") {
        setSocialError("Failed to load community feed.");
      }
      if (dashRes.status === "rejected") {
        setError("Some connected workspace data is temporarily unavailable.");
      }
    } catch {
      setError("Some connected workspace data is temporarily unavailable.");
      setSocialError("Failed to load community feed.");
      setSocialMock(false);
    } finally {
      setLoading(false);
      setSocialLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const handleMarkAllRead = async () => {
    try {
      await fetch("/api/dashboard/events/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setData((prev) =>
        prev
          ? {
              ...prev,
              unreadCount: 0,
              events: prev.events.map((e) => ({
                ...e,
                read_at: e.read_at || new Date().toISOString(),
              })),
            }
          : prev,
      );
    } catch {
      /* non-fatal */
    }
  };

  const displayName =
    profile?.displayName || user?.firstName || user?.username || "Member";

  const attentionCount = useMemo(() => {
    const errorEvents = (data?.events || []).filter(
      (e) =>
        e.severity === "error" ||
        e.severity === "critical" ||
        e.severity === "warning",
    ).length;
    const accountErrors = (data?.accounts || []).filter(
      (a) =>
        a.last_error ||
        a.status === "expired" ||
        a.status === "missing_permission",
    ).length;
    return errorEvents + accountErrors;
  }, [data]);

  const greetingSubtext = loading
    ? "Loading your workspace..."
    : error
      ? error
      : attentionCount > 0
        ? `${attentionCount} item${attentionCount === 1 ? "" : "s"} need attention.`
        : "Everything is quiet. Start something new.";

  return (
    <div
      className="min-h-screen backdrop-blur-sm"
      style={{ backgroundColor: T.bgColor + "d0", color: T.textColor }}
    >
      <div className="mx-auto max-w-7xl p-4 lg:p-8">
        {/* Greeting */}
        <div
          className="mb-6 flex flex-col gap-4 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between"
          style={{
            background: `linear-gradient(135deg, ${T.accentColor}08 0%, transparent 70%)`,
            borderBottom: `1px solid ${T.borderColor}20`,
          }}
        >
          <div>
            <h1
              className="text-2xl font-black lg:text-3xl"
              style={{ color: T.headerColor }}
            >
              {getGreeting()}, {displayName}
            </h1>
            <p className="text-sm mt-1" style={{ color: T.textMuted }}>
              {greetingSubtext}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/discover"
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all hover:opacity-80"
              style={{
                background: "#ff00a015",
                color: "#ff00a0",
                border: "1px solid #ff00a030",
                minHeight: 44,
              }}
            >
              <Icon name="globe" size={14} />
              Discover
            </Link>
            <Link
              href="/studio"
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all hover:scale-[1.02]"
              style={{
                background: T.accentColor,
                color: T.bgColor,
                minHeight: 44,
              }}
            >
              <Icon name="sparkles" size={14} />
              Open Studio
            </Link>
          </div>
        </div>

        {/* Quick Create */}
        <div className="mb-6">
          <DashboardQuickCreate />
        </div>

        {error && (
          <div
            className="mb-4 rounded-xl p-3 text-sm"
            style={{
              background: "#ef444410",
              color: "#ef4444",
              border: "1px solid #ef444430",
            }}
          >
            <Icon name="alert" size={14} className="inline mr-2" />
            {error}
          </div>
        )}

        {/* Dashboard Grid — mobile-first ordering */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* 1. Daily Brief — full width */}
          <div className="lg:col-span-12">
            <LiTTDailyBrief
              data={data}
              loading={loading}
              attentionCount={attentionCount}
            />
          </div>

          {/* 2. Continue Project — large */}
          <Card title="Continue Project" icon="folder" colSpan="lg:col-span-8">
            <ContinueProjectCard data={data} loading={loading} />
          </Card>

          {/* 3. Current Mission — sidebar */}
          <Card title="Current Mission" icon="target" colSpan="lg:col-span-4">
            <CurrentMissionCard data={data} loading={loading} />
          </Card>

          {/* 4. Unified Inbox — medium */}
          <Card title="Unified Inbox" icon="inbox" colSpan="lg:col-span-8">
            <UnifiedInboxCard
              data={data}
              loading={loading}
              onMarkAllRead={handleMarkAllRead}
            />
          </Card>

          {/* 5. Your World — sidebar */}
          <Card
            title="Your World"
            icon="users"
            colSpan="lg:col-span-4"
            action={
              <Link
                href="/discover"
                className="text-xs font-bold opacity-50 hover:opacity-80"
              >
                Discover →
              </Link>
            }
          >
            <YourWorldCard />
          </Card>

          {/* 6. Recent Work — medium */}
          <Card title="Recent Work" icon="package" colSpan="lg:col-span-8">
            <RecentWorkCard data={data} loading={loading} />
          </Card>

          {/* 7. Community Pulse — sidebar */}
          <Card
            title="Community Pulse"
            icon="heart"
            colSpan="lg:col-span-4"
            action={
              <Link
                href="/discover"
                className="text-xs font-bold opacity-50 hover:opacity-80"
              >
                Open →
              </Link>
            }
          >
            <CommunityPulseCard
              socialPosts={socialPosts}
              socialLoading={socialLoading}
              socialError={socialError}
              socialMock={socialMock}
            />
          </Card>

          {/* 8. System Health — full width, collapsed */}
          <Card title="System Health" icon="activity" colSpan="lg:col-span-8">
            <SystemHealthStrip
              data={data}
              llmHealth={llmHealth}
              loading={loading}
            />
          </Card>

          {/* Compact Music Player */}
          <Card title="Now Playing" icon="music" colSpan="lg:col-span-4">
            <div className="space-y-2">
              <MusicPlayer mode="mini" />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default DashboardV2;
