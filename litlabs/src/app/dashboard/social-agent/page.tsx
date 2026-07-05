"use client";

import { useState, useEffect, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Rocket,
  Loader2,
  Sparkles,
  Calendar,
  UserCircle,
  ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import ApprovalQueue from "@/components/social-agent/ApprovalQueue";
import ContentCalendar from "@/components/social-agent/ContentCalendar";
import BrandProfileEditor, {
  type BrandProfile,
} from "@/components/social-agent/BrandProfileEditor";
import { type SocialPost } from "@/components/social-agent/PostCard";

type Tab = "queue" | "calendar" | "brand";

export default function SocialAgentDashboard() {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();

  const [tab, setTab] = useState<Tab>("queue");
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [brand, setBrand] = useState<BrandProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [topic, setTopic] = useState("");

  const fetchPosts = useCallback(async () => {
    try {
      const res = await fetch("/api/social-agent/posts");
      if (!res.ok) return;
      const data = await res.json();
      setPosts(data.posts ?? []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn) fetchPosts();
    else if (isLoaded) setLoading(false);
  }, [isLoaded, isSignedIn, fetchPosts]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/social-agent/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandId: brand?.id,
          topic: topic || undefined,
          campaignGoal: "Drive traffic and signups to litlabs.net",
        }),
      });
      if (res.ok) {
        setTopic("");
        await fetchPosts();
      }
    } catch {
      // silent
    } finally {
      setGenerating(false);
    }
  };

  const handleAction = async (
    postId: string,
    action: string,
    data?: Record<string, string>,
  ) => {
    try {
      const endpoint =
        action === "approve" || action === "reject" || action === "edit"
          ? "/api/social-agent/approve"
          : "/api/social-agent/schedule";

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, action, ...data }),
      });
      await fetchPosts();
    } catch {
      // silent
    }
  };

  const handleScan = async (url: string) => {
    setScanning(true);
    try {
      const res = await fetch("/api/social-agent/scan-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) setBrand(data.profile);
      }
    } catch {
      // silent
    } finally {
      setScanning(false);
    }
  };

  const handleSaveBrand = async (data: Partial<BrandProfile>) => {
    setBrand((prev) => (prev ? { ...prev, ...data } : null));
  };

  const tabs: { key: Tab; label: string; icon: typeof Calendar }[] = [
    { key: "queue", label: "Queue", icon: Sparkles },
    { key: "calendar", label: "Calendar", icon: Calendar },
    { key: "brand", label: "Brand", icon: UserCircle },
  ];

  const draftCount = posts.filter((p) => p.status === "draft").length;
  const approvedCount = posts.filter((p) => p.status === "approved").length;
  const scheduledCount = posts.filter((p) => p.status === "scheduled").length;

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: T.bgColor }}
      >
        <Loader2
          size={28}
          className="animate-spin"
          style={{ color: T.accentColor }}
        />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen py-6 px-4 sm:px-6 lg:px-8"
      style={{ backgroundColor: T.bgColor }}
    >
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="flex items-center gap-1 text-xs hover:opacity-70 transition-opacity"
              style={{ color: T.textMuted }}
            >
              <ArrowLeft size={14} /> Dashboard
            </Link>
            <div
              className="w-px h-5"
              style={{ backgroundColor: T.borderColor + "40" }}
            />
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{
                  background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
                }}
              >
                <Rocket size={18} className="text-white" />
              </div>
              <div>
                <h1
                  className="text-lg font-black tracking-tight"
                  style={{ color: T.textColor }}
                >
                  SocialPilot
                </h1>
                <p className="text-[11px] font-medium" style={{ color: T.textMuted }}>
                  AI content generation & scheduling
                </p>
              </div>
            </div>
          </div>

          {/* Generate button */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Topic or focus (optional)"
              className="flex-1 sm:w-56 px-3 py-2 rounded-lg text-xs outline-none"
              style={{
                backgroundColor: T.boxBg,
                color: T.textColor,
                border: `1px solid ${T.borderColor}30`,
              }}
            />
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
              style={{
                background: "linear-gradient(135deg, #8b5cf6, #ec4899)",
                color: "#fff",
              }}
            >
              {generating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles size={14} />
              )}
              {generating ? "Generating..." : "Generate Posts"}
            </button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {[
            { label: "Drafts", count: draftCount, color: "#fbbf24" },
            { label: "Approved", count: approvedCount, color: "#22c55e" },
            { label: "Scheduled", count: scheduledCount, color: "#3b82f6" },
            { label: "Total", count: posts.length, color: T.accentColor },
          ].map((stat) => (
            <div
              key={stat.label}
              className="glass-card rounded-xl px-4 py-3 min-w-[100px] shrink-0"
              style={{ borderColor: stat.color + "20" }}
            >
              <div
                className="text-xl font-black"
                style={{ color: stat.color }}
              >
                {stat.count}
              </div>
              <div
                className="text-[10px] font-bold uppercase tracking-wider"
                style={{ color: T.textMuted }}
              >
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div
          className="flex gap-1 p-1 rounded-xl"
          style={{ backgroundColor: T.boxBg }}
        >
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all flex-1"
                style={{
                  backgroundColor: active ? T.accentColor + "18" : "transparent",
                  color: active ? T.accentColor : T.textMuted,
                }}
              >
                <Icon size={14} />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {tab === "queue" && (
          <ApprovalQueue
            posts={posts.filter(
              (p) => p.status === "draft" || p.status === "approved",
            )}
            onAction={handleAction}
            loading={loading}
          />
        )}
        {tab === "calendar" && <ContentCalendar posts={posts} />}
        {tab === "brand" && (
          <BrandProfileEditor
            profile={brand}
            onSave={handleSaveBrand}
            onScan={handleScan}
            scanning={scanning}
          />
        )}
      </div>
    </div>
  );
}
