"use client";
export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect, Suspense } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AGENT_AVATARS,
  AGENT_AVATAR_META,
  type AgentAvatarMeta,
} from "@/lib/avatars";
import {
  Check,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Coins,
  WandSparkles,
  Terminal,
  Copy,
} from "lucide-react";

function formatPrice(cents: number): string {
  if (cents === 0) return "FREE";
  return cents + " LBC";
}

// Category color mapping for consistent theming
function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    developer: "#818cf8", // Indigo
    marketing: "#34d399", // Emerald
    analytics: "#a78bfa", // Purple
    content: "#f472b6", // Pink
    general: "#fbbf24", // Amber
    orchestrator: "#fb923c", // Orange
    music: "#22d3ee", // Cyan
    design: "#ec4899", // Rose
    research: "#60a5fa", // Blue
    legal: "#94a3b8", // Slate
  };
  return colors[category] || "#fbbf24";
}

// TIER PACKAGES — Stripe price_id required for each (create in Stripe Dashboard)
// All prices created in test mode: Starter($5), Pro($19.99), Elite($50)
const TIER_PACKAGES: {
  id: string;
  coins: number;
  price: number;
  priceId: string;
  productId?: string;
  label: string;
  tier: string;
  popular: boolean;
  features: string[];
}[] = [
  {
    id: "tier-free",
    coins: 500,
    price: 0,
    priceId: "",
    label: "Starter",
    tier: "free",
    popular: false,
    features: ["500 credits/mo", "3 agent slots", "All games", "LiT Chat"],
  },
  {
    id: "tier-basic",
    coins: 1500,
    price: 9.99,
    priceId: "price_1TqeW9J53kgx4fp5dyxzyN0N",
    productId: "prod_UqLClkd2zQbOBc",
    label: "Basic",
    tier: "basic",
    popular: false,
    features: ["1,500 credits/mo", "5 agent slots", "All games", "LiT Chat", "Priority support"],
  },
  {
    id: "tier-creator",
    coins: 5000,
    price: 12,
    priceId: "price_1TogVaJ53kgx4fp5pclmzUZv",
    label: "Creator",
    tier: "creator",
    popular: true,
    features: ["5K credits/mo", "10 agent slots", "Flow Studio", "Terminal", "Daily bonus +500"],
  },
  {
    id: "tier-elite",
    coins: 15000,
    price: 39,
    priceId: "price_1TogWpJ53kgx4fp5D5qi1ld8",
    productId: "prod_UoIJ3gU5CzKIWn",
    label: "Elite",
    tier: "elite",
    popular: false,
    features: ["Unlimited credits", "Unlimited agents", "Sell agents", "API access", "Daily bonus +2000", "Early access"],
  },
];

// SPEND COINS — interactive features with real coin deduction
const SPEND_FEATURES: {
  id: string;
  title: string;
  desc: string;
  cost: number;
  action: string;
}[] = [
  {
    id: "generate",
    title: "AI Generate",
    desc: "Generate an image, music track, or video with AI",
    cost: 50,
    action: "Generate",
  },
  {
    id: "slot",
    title: "Extra Agent Slot",
    desc: "Expand your dock to run +1 agent simultaneously",
    cost: 200,
    action: "Unlock",
  },
  {
    id: "boost",
    title: "Social Boost",
    desc: "Feature your post at the top of the social feed for 24h",
    cost: 100,
    action: "Boost",
  },
  {
    id: "priority",
    title: "Priority Mode",
    desc: "Get faster agent responses and higher rate limits",
    cost: 150,
    action: "Activate",
  },
  {
    id: "theme",
    title: "Rare Theme",
    desc: "Unlock an exclusive limited-edition UI skin",
    cost: 300,
    action: "Unlock",
  },
  {
    id: "workflow",
    title: "Workflow Run",
    desc: "Execute a multi-agent orchestrated workflow",
    cost: 75,
    action: "Run",
  },
];

type Agent = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  avatar_url: string;
  price_cents: number;
  features: string[];
  is_featured: boolean;
  personality: string;
  rating?: number;
  installs?: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  developer: "Developer",
  marketing: "Marketing",
  analytics: "Analytics",
  content: "Content",
  general: "General",
  orchestrator: "Orchestrator",
  music: "Music",
  design: "Design",
  research: "Research",
  legal: "Legal",
  "smart-home": "Smart Home",
};

// AGENT PRICING TIERS (in LiTBit Coins 🪙)
// Free: Core agents everyone gets
// Budget (50-150): Basic specialized agents
// Pro (200-500): Advanced agents with premium features
// Elite (1000+): Enterprise-grade specialized agents
const DEMO_AGENTS: Agent[] = [
  {
    id: "1",
    slug: "director",
    name: "LiTTree",
    description:
      "Your core AI copilot. Plans, routes tasks, navigates the platform, and grows your ideas across every domain.",
    category: "orchestrator",
    avatar_url: AGENT_AVATARS.director,
    price_cents: 0,
    features: ["Task routing", "Strategy planning", "Platform navigation"],
    is_featured: true,
    personality: "Strategic, decisive, concise",
    rating: 4.9,
    installs: 1240,
  },
  {
    id: "2",
    slug: "code-champion",
    name: "Forge",
    description:
      "Full-stack engineer. Writes, reviews, debugs, and ships production-ready TypeScript, React, and Next.js code.",
    category: "developer",
    avatar_url: AGENT_AVATARS["code-champion"],
    price_cents: 0,
    features: ["Code generation", "Debugging", "Architecture"],
    is_featured: true,
    personality: "Precise, clean, practical",
    rating: 4.9,
    installs: 1567,
  },
  {
    id: "3",
    slug: "social-dominator",
    name: "Pulse",
    description:
      "Growth, content & analytics. Builds growth loops, viral mechanics, content calendars, and data-driven decisions.",
    category: "marketing",
    avatar_url: AGENT_AVATARS["social-dominator"],
    price_cents: 0,
    features: ["Growth strategy", "Content calendars", "Analytics"],
    is_featured: true,
    personality: "Bold, creative, results-driven",
    rating: 4.7,
    installs: 890,
  },
  {
    id: "4",
    slug: "pixel-forge",
    name: "Visionary",
    description:
      "Creative director & visual AI. Crafts image prompts, brand identities, UI direction, and creative campaigns.",
    category: "design",
    avatar_url: AGENT_AVATARS["pixel-forge"],
    price_cents: 200,
    features: ["Image prompts", "Brand identity", "UI direction"],
    is_featured: true,
    personality: "Visionary, artistic, detailed",
    rating: 4.8,
    installs: 921,
  },
  {
    id: "5",
    slug: "social-pilot",
    name: "SocialPilot",
    description:
      "Social media growth agent. Platform-native content for Instagram, X, TikTok, LinkedIn, Reddit, and Bluesky.",
    category: "marketing",
    avatar_url: AGENT_AVATARS["social-dominator"],
    price_cents: 250,
    features: ["Platform content", "Growth tactics", "Scheduling"],
    is_featured: true,
    personality: "Energetic, native, platform-savvy",
    rating: 4.8,
    installs: 743,
  },
];

// Build slug→demo lookup for metadata enrichment
const DEMO_BY_SLUG = Object.fromEntries(DEMO_AGENTS.map((a) => [a.slug, a]));

function MarketplaceInner() {
  const { isLoaded, isSignedIn, userId } = useClerkAuth();
  const { resolvedColors: T } = useTheme();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>(DEMO_AGENTS);
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(
    new Set(),
  );
  const [installedAgentDbIds, setInstalledAgentDbIds] = useState<
    Map<string, string>
  >(new Map());
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("featured");
  const [previewAgent, setPreviewAgent] = useState<Agent | null>(null);
  const [litBitCoins, setLitBitCoins] = useState(500);
  const [toast, setToast] = useState<{
    msg: string;
    type: "success" | "error" | "info";
  } | null>(null);
  const [sellModalAgent, setSellModalAgent] = useState<Agent | null>(null);
  const [sellPrice, setSellPrice] = useState("");
  const [listedAgents, setListedAgents] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"tiers" | "agents">("tiers");
  const [currentPlan, setCurrentPlan] = useState<string>("free");

  const showToast = (
    msg: string,
    type: "success" | "error" | "info" = "success",
  ) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Load agents from /api/agents, enrich with local metadata
  const loadAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const data = await res.json();
      if (Array.isArray(data.agents) && data.agents.length > 0) {
        const merged: Agent[] = data.agents.map(
          (a: Record<string, unknown>) => {
            const demo = DEMO_BY_SLUG[(a.slug as string) || ""];
            return {
              id: String(a.id || demo?.id || a.slug || ""),
              slug: String(a.slug || ""),
              name: String(a.name || a.display_name || demo?.name || ""),
              description: String(a.description || demo?.description || ""),
              category: String(a.category || demo?.category || "general"),
              avatar_url: String(demo?.avatar_url || a.avatar_url || ""),
              price_cents:
                demo?.price_cents ??
                (typeof a.price_cents === "number" ? a.price_cents : 0),
              features:
                demo?.features ??
                (Array.isArray(a.features) ? (a.features as string[]) : []),
              is_featured: Boolean(a.is_featured ?? demo?.is_featured ?? false),
              personality: String(demo?.personality ?? a.personality ?? ""),
              rating: demo?.rating,
              installs: demo?.installs,
            };
          },
        );
        setAgents(merged);
      }
    } catch {
      // keep DEMO_AGENTS default on error
    }
  }, []);

  // Fetch wallet from API (source of truth)
  const fetchWallet = useCallback(async () => {
    try {
      const res = await fetch("/api/wallet");
      const data = await res.json();
      if (typeof data.balance === "number") {
        setLitBitCoins(data.balance);
      }
    } catch {
      // silent fail
    }
  }, []);

  // Load which agents the signed-in user has installed
  const loadInstalledAgents = async () => {
    try {
      const res = await fetch("/api/user-agents");
      const data = await res.json();
      if (Array.isArray(data.agents)) {
        const ids = new Set<string>();
        const dbIdMap = new Map<string, string>();
        for (const ua of data.agents) {
          const agentId: string = ua.agent?.id || ua.agent_id || "";
          const agentSlug: string = ua.agent?.slug || "";
          if (agentId) {
            ids.add(agentId);
            dbIdMap.set(agentId, ua.agent_id || agentId);
          }
          if (agentSlug) {
            ids.add(agentSlug);
            const demoMatch = DEMO_AGENTS.find((d) => d.slug === agentSlug);
            if (demoMatch) ids.add(demoMatch.id);
          }
        }
        setInstalledAgents(ids);
        setInstalledAgentDbIds(dbIdMap);
      }
    } catch {
      // silent fail
    }
  };

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      loadAgents();
      fetchWallet();
      if (isSignedIn && userId) {
        fetch(`/api/users/${userId}/plan`)
          .then((r) => (r.ok ? r.json() : { plan: "free" }))
          .then((data) => {
            if (data.plan) setCurrentPlan(data.plan);
          })
          .catch(() => {});
      }

      // Stripe return detection
      const success = searchParams.get("success");
      const canceled = searchParams.get("canceled");
      if (success === "true") {
        showToast(
          "Payment successful! Your LiTBit Coins will be credited shortly.",
          "success",
        );
      } else if (canceled === "true") {
        showToast("Payment canceled. No coins were charged.", "info");
      }

      // Tab from URL (?tab=discover|agents|tiers)
      const tab = searchParams.get("tab");
      if (tab === "discover" || tab === "agents") {
        setActiveTab("agents");
      } else if (tab === "tiers" || tab === "coins") {
        setActiveTab("tiers");
      }
    });
    return () => cancelAnimationFrame(id);
  }, [loadAgents, fetchWallet, searchParams, isSignedIn, userId]);

  useEffect(() => {
    if (isSignedIn) {
      const id = requestAnimationFrame(() => loadInstalledAgents());
      return () => cancelAnimationFrame(id);
    }
  }, [isSignedIn]);

  const buyPack = async (pack: (typeof TIER_PACKAGES)[0]) => {
    if (!isSignedIn || !userId) {
      showToast("Please sign in to purchase.", "error");
      return;
    }
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "subscription",
          priceId: pack.priceId,
          metadata: { clerk_id: userId, tier: pack.tier, coin_amount: String(pack.coins) },
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.assign(data.url);
      } else {
        showToast(data.error || "Checkout failed. Try again.", "error");
      }
    } catch {
      showToast("Network error during checkout.", "error");
    }
  };

  const [claimLoading, setClaimLoading] = useState(false);

  const earnCoins = async () => {
    if (claimLoading) return;
    setClaimLoading(true);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "daily" }),
      });
      const data = await res.json();
      if (res.ok) {
        setLitBitCoins(data.balance);
        showToast(
          `+50 LBC Daily bonus claimed. Balance: ${data.balance}`,
          "success",
        );
      } else {
        showToast(data.error || "Failed to claim daily bonus.", "error");
      }
    } catch {
      showToast("Network error. Try again.", "error");
    } finally {
      setClaimLoading(false);
    }
  };

  const categories = Array.from(new Set(agents.map((a) => a.category)));

  const filteredAgents = agents
    .filter((a) => !selectedCategory || a.category === selectedCategory)
    .filter(
      (a) =>
        !searchQuery ||
        a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        a.description.toLowerCase().includes(searchQuery.toLowerCase()),
    )
    .sort((a, b) => {
      if (sortBy === "featured")
        return (
          (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0) ||
          (b.installs || 0) - (a.installs || 0)
        );
      if (sortBy === "popular") return (b.installs || 0) - (a.installs || 0);
      if (sortBy === "rating") return (b.rating || 0) - (a.rating || 0);
      if (sortBy === "price") return a.price_cents - b.price_cents;
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return 0;
    });

  const syncWallet = async (amount: number) => {
    try {
      const res = await fetch("/api/wallet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (res.ok && typeof data.balance === "number") {
        setLitBitCoins(data.balance);
        return data.balance;
      }
    } catch {
      // silent fail
    }
    return null;
  };

  const installAgent = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;

      if (agent.price_cents > 0) {
        // Paid agents: redirect to Stripe checkout
        if (!isSignedIn || !userId) {
          showToast("Please sign in to purchase this agent.", "error");
          return;
        }
        try {
          const res = await fetch("/api/stripe/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: "payment",
              priceData: {
                amount: agent.price_cents * 100, // 1 LBC = $0.01 → price_cents * 100 = USD cents
                currency: "usd",
                name: `${agent.name} — Agent License`,
                description: `One-time purchase: ${agent.name} (${agent.price_cents} LBC)`,
              },
              metadata: {
                clerk_id: userId,
                agent_slug: agent.slug,
                agent_id: agent.id,
                type: "agent_purchase",
              },
            }),
          });
          const data = await res.json();
          if (data.url) {
            window.location.href = data.url;
          } else {
            showToast(data.error || "Checkout failed. Try again.", "error");
          }
        } catch {
          showToast("Network error during checkout.", "error");
        }
        return;
      }

      // Free agent — install via API
      try {
        const res = await fetch("/api/user-agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: agent.id, slug: agent.slug }),
        });
        const data = await res.json();
        if (res.ok || res.status === 200) {
          setInstalledAgents((prev) => {
            const n = new Set(prev);
            n.add(agent.id);
            n.add(agent.slug);
            return n;
          });
          showToast(`✅ ${agent.name} installed!`, "success");
        } else {
          showToast(data.error || "Install failed.", "error");
        }
      } catch {
        // Optimistic fallback
        setInstalledAgents((prev) => {
          const n = new Set(prev);
          n.add(agent.id);
          n.add(agent.slug);
          return n;
        });
        showToast(`✅ ${agent.name} installed for free!`, "success");
      }
    },
    [agents, isSignedIn, userId],
  );

  const uninstallAgent = useCallback(
    async (agentId: string) => {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) return;
      const dbId = installedAgentDbIds.get(agentId) || agentId;
      try {
        await fetch(`/api/user-agents?agentId=${dbId}`, { method: "DELETE" });
      } catch {
        // silent — still remove from local state
      }
      setInstalledAgents((prev) => {
        const n = new Set(prev);
        n.delete(agent.id);
        n.delete(agent.slug);
        return n;
      });
      showToast(`🗑️ ${agent.name} removed from dock.`, "info");
    },
    [agents, installedAgentDbIds],
  );

  const listForSale = useCallback(async (agentId: string, price: number) => {
    const earned = Math.floor(price * 0.1);
    const newBal = await syncWallet(earned);
    if (newBal === null) {
      showToast("Listing failed. Could not credit bonus. Try again.", "error");
      return;
    }
    setListedAgents((prev) => new Set([...prev, agentId]));
    showToast(
      `🏪 Agent listed! You earned ${earned} 🪙 listing bonus.`,
      "info",
    );
    setSellModalAgent(null);
    setSellPrice("");
  }, []);

  // Auth redirect
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      router.push("/sign-in?redirect_url=/marketplace");
    }
  }, [isLoaded, isSignedIn, router]);

  // Require authentication (after all hooks to respect Rules of Hooks)
  if (!isLoaded) {
    return (
      <div
        style={{
          backgroundColor: T?.bgColor || "#0a0a0f",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: T?.textColor || "#00ff41",
          fontFamily: "monospace",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "32px", marginBottom: "16px" }}>⏳</div>
          <div>Loading marketplace...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
        <p className="text-sm opacity-60">
          Please sign in to view the marketplace.
        </p>
        <Link
          href="/sign-in?redirect_url=/marketplace"
          className="px-4 py-2 rounded-lg text-sm font-bold"
          style={{ backgroundColor: "#6366f1", color: "#fff" }}
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: "#08080c", color: "#f0f0f6" }}>
      {/* Toast */}
      {toast && (
        <div className="fixed top-20 right-5 px-5 py-3 rounded-xl text-xs font-bold max-w-xs border"
          style={{
            zIndex: 200,
            backgroundColor: toast.type === "success" ? "#0d2e1a" : toast.type === "error" ? "#2e0d0d" : "#0d1a2e",
            borderColor: toast.type === "success" ? "#4ade80" : toast.type === "error" ? "#f87171" : "#22d3ee",
            color: toast.type === "success" ? "#4ade80" : toast.type === "error" ? "#f87171" : "#22d3ee",
            boxShadow: `0 8px 32px ${toast.type === "success" ? "#4ade8030" : toast.type === "error" ? "#f8717130" : "#22d3ee30"}`,
          }}
        >
          {toast.msg}
        </div>
      )}

      {/* ── PAGE HEADER ── */}
      <div className="border-b px-6 pt-8 pb-6" style={{ borderColor: "#1e1e2e", background: "linear-gradient(180deg,#101018 0%,#08080c 100%)" }}>
        <div className="mx-auto max-w-5xl">
          {/* Title row */}
          <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-2xl font-black tracking-tight" style={{ color: "#f0f0f6" }}>Agent Marketplace</h1>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider" style={{ background: "#22d3ee15", color: "#22d3ee", border: "1px solid #22d3ee30" }}>Beta</span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider"
                  style={{
                    background: currentPlan === "elite" ? "#a3f5460a" : currentPlan === "creator" || currentPlan === "pro" ? "#a78bfa0a" : "#22d3ee08",
                    color: currentPlan === "elite" ? "#a3f546" : currentPlan === "creator" || currentPlan === "pro" ? "#a78bfa" : "#22d3ee",
                    border: `1px solid ${currentPlan === "elite" ? "#a3f54630" : currentPlan === "creator" || currentPlan === "pro" ? "#a78bfa30" : "#22d3ee30"}`,
                  }}>
                  {currentPlan === "elite" ? "Elite" : currentPlan === "creator" || currentPlan === "pro" ? "Creator" : "Starter"}
                </span>
              </div>
              <p className="text-sm" style={{ color: "#6b7280", maxWidth: 520 }}>
                LiTTree is your core OS agent — all specialists route through him. Browse, install, and unlock agents to extend your AI workspace.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-black" style={{ background: "#fbbf2415", border: "1px solid #fbbf2430", color: "#fbbf24" }}>
                <Coins size={14} /> {litBitCoins.toLocaleString()} LBC
              </div>
              <button onClick={earnCoins} disabled={claimLoading}
                className="px-4 py-2.5 rounded-xl text-xs font-black transition-all hover:scale-[1.02] disabled:opacity-50"
                style={{ background: "#22d3ee15", border: "1px solid #22d3ee40", color: "#22d3ee" }}>
                {claimLoading ? "Claiming..." : "⚡ Daily Bonus"}
              </button>
            </div>
          </div>

          {/* LiTTree hero banner */}
          <div className="flex items-center gap-4 p-4 rounded-2xl mb-6" style={{ background: "#a3f54608", border: "1px solid #a3f54620" }}>
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0" style={{ background: "linear-gradient(135deg,#6366f1,#22d3ee)" }}>🌳</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-sm font-black" style={{ color: "#f0f0f6" }}>LiTTree</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase" style={{ background: "#a3f54620", color: "#a3f546" }}>Core OS Agent · Always Free</span>
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              </div>
              <p className="text-xs" style={{ color: "#6b7280" }}>Your primary AI — every installed agent extends LiTTree with new skills. Specialist agents defer to LiTTree for orchestration.</p>
            </div>
            <Link href="/studio?tool=chat" className="px-4 py-2 rounded-xl text-xs font-black shrink-0 transition-all hover:scale-[1.02]" style={{ background: "linear-gradient(135deg,#6366f1,#22d3ee)", color: "#fff" }}>
              Open LiTTree <ArrowRight className="inline h-3 w-3 ml-1" />
            </Link>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: "Total Agents", value: agents.length, color: "#22d3ee", icon: Sparkles },
              { label: "Free Agents", value: agents.filter(a => a.price_cents === 0).length, color: "#4ade80", icon: ShieldCheck },
              { label: "Installed", value: installedAgents.size, color: "#a78bfa", icon: WandSparkles },
              { label: "LBC Balance", value: litBitCoins.toLocaleString(), color: "#fbbf24", icon: Coins },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: `${s.color}08`, border: `1px solid ${s.color}20` }}>
                <s.icon size={16} style={{ color: s.color }} />
                <div>
                  <div className="text-base font-black" style={{ color: "#f0f0f6" }}>{s.value}</div>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: "#6b7280" }}>{s.label}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Tab bar */}
          <div className="flex gap-2">
            {[
              { id: "tiers", label: "Tiers & Coins", badge: null },
              { id: "agents", label: "Agents", badge: String(agents.length) },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id as "tiers" | "agents")}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-black transition-all"
                style={{
                  background: activeTab === tab.id ? "#22d3ee18" : "transparent",
                  border: `1px solid ${activeTab === tab.id ? "#22d3ee50" : "#1e1e2e"}`,
                  color: activeTab === tab.id ? "#22d3ee" : "#6b7280",
                }}>
                {tab.label}
                {tab.badge && (
                  <span className="px-1.5 py-0.5 rounded-md text-[9px] font-black" style={{ background: activeTab === tab.id ? "#22d3ee" : "#1e1e2e", color: activeTab === tab.id ? "#08080c" : "#6b7280" }}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {activeTab === "agents" && (
        <div className="flex-1 flex flex-col">
          {/* Filter + search bar */}
          <div className="px-6 py-3 border-b flex gap-3 flex-wrap items-center justify-between" style={{ borderColor: "#1e1e2e", background: "#101018" }}>
            <div className="flex gap-1.5 flex-wrap items-center">
              <button onClick={() => setSelectedCategory("")}
                className="px-3 py-1 rounded-lg text-[11px] font-bold transition-all"
                style={{ background: selectedCategory === "" ? "#22d3ee18" : "transparent", border: `1px solid ${selectedCategory === "" ? "#22d3ee40" : "#1e1e2e"}`, color: selectedCategory === "" ? "#22d3ee" : "#6b7280" }}>
                All ({agents.length})
              </button>
              {categories.map(cat => (
                <button key={cat} onClick={() => setSelectedCategory(cat === selectedCategory ? "" : cat)}
                  className="px-3 py-1 rounded-lg text-[11px] font-bold transition-all capitalize"
                  style={{
                    background: selectedCategory === cat ? `${getCategoryColor(cat)}18` : "transparent",
                    border: `1px solid ${selectedCategory === cat ? getCategoryColor(cat) + "50" : "#1e1e2e"}`,
                    color: selectedCategory === cat ? getCategoryColor(cat) : "#6b7280",
                  }}>
                  {CATEGORY_LABELS[cat] || cat}
                </button>
              ))}
            </div>
            <div className="flex gap-2 items-center">
              <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search agents…"
                className="px-3 py-1.5 rounded-xl text-xs outline-none w-44"
                style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#f0f0f6" }} />
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                className="px-3 py-1.5 rounded-xl text-xs cursor-pointer"
                style={{ background: "#08080c", border: "1px solid #1e1e2e", color: "#6b7280" }}>
                <option value="featured">Featured</option>
                <option value="popular">Popular</option>
                <option value="rating">Rating</option>
                <option value="price">Price</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          {/* Agent grid */}
          <div className="flex-1 px-6 py-6 mx-auto w-full" style={{ maxWidth: 1200 }}>
            {filteredAgents.length === 0 ? (
              <div className="text-center py-20 text-sm" style={{ color: "#6b7280" }}>No agents found matching your search.</div>
            ) : (
              <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))" }}>
                {filteredAgents.map(agent => (
                  <AgentCard key={agent.id} agent={agent}
                    isInstalled={installedAgents.has(agent.id)}
                    onInstall={() => installAgent(agent.id)}
                    onPreview={() => setPreviewAgent(agent)}
                    theme={T} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "tiers" && (
        <div className="flex-1 px-6 py-8 mx-auto w-full" style={{ maxWidth: 1000 }}>

          {/* ── TIER CARDS ── */}
          <div className="mb-10">
            <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.15em] mb-1" style={{ color: "#22d3ee" }}>Choose Your Tier</div>
                <p className="text-sm" style={{ color: "#6b7280" }}>Starter is free forever. Upgrade anytime to unlock more.</p>
              </div>
              <button onClick={earnCoins} disabled={claimLoading}
                className="px-4 py-2 rounded-xl text-xs font-black transition-all hover:scale-[1.02] disabled:opacity-50"
                style={{ background: "#22d3ee18", border: "1px solid #22d3ee40", color: "#22d3ee" }}>
                {claimLoading ? "Claiming…" : "⚡ Claim Daily Bonus"}
              </button>
            </div>

            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
              {TIER_PACKAGES.map(tier => {
                const isCurrent = currentPlan === tier.tier;
                const tc = tier.tier === "elite" ? { accent: "#a3f546", glow: "#a3f54640", bg: "#a3f5460a" }
                         : tier.tier === "creator" ? { accent: "#a78bfa", glow: "#a78bfa40", bg: "#a78bfa0a" }
                         : { accent: "#22d3ee", glow: "#22d3ee30", bg: "#22d3ee08" };
                const missingPrice = !tier.priceId && tier.price > 0;
                return (
                  <div key={tier.id} className="relative flex flex-col p-6 rounded-2xl transition-all"
                    style={{
                      background: isCurrent ? tc.bg : "#101018",
                      border: `2px solid ${isCurrent ? tc.accent : tier.popular ? tc.accent + "60" : "#1e1e2e"}`,
                      boxShadow: isCurrent ? `0 0 32px ${tc.glow}` : tier.popular ? `0 0 16px ${tc.glow}` : "none",
                    }}>
                    {/* Badge */}
                    {isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-black" style={{ background: tc.accent, color: "#08080c" }}>
                        ✓ Current Plan
                      </div>
                    )}
                    {tier.popular && !isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-black" style={{ background: tc.accent, color: "#08080c" }}>
                        ⭐ Most Popular
                      </div>
                    )}

                    <div className="text-[11px] font-black uppercase tracking-[0.15em] mb-3" style={{ color: tc.accent }}>{tier.label}</div>
                    <div className="mb-1" style={{ color: "#f0f0f6" }}>
                      {tier.price === 0
                        ? <span className="text-4xl font-black">Free</span>
                        : <><span className="text-4xl font-black">${tier.price}</span><span className="text-sm opacity-60">/mo</span></>}
                    </div>
                    <div className="text-xs mb-5" style={{ color: "#6b7280" }}>{tier.coins.toLocaleString()} LBC included/mo</div>

                    <ul className="flex-1 space-y-2 mb-6">
                      {tier.features.map(f => (
                        <li key={f} className="flex items-center gap-2 text-xs" style={{ color: "#9ca3af" }}>
                          <Check size={12} style={{ color: tc.accent }} />{f}
                        </li>
                      ))}
                    </ul>

                    {missingPrice && <div className="text-[10px] mb-2" style={{ color: "#f87171" }}>⚠ Stripe ID not configured</div>}
                    <button
                      onClick={() => !isCurrent && !missingPrice && tier.price > 0 && buyPack(tier)}
                      disabled={isCurrent || missingPrice || tier.price === 0}
                      className="w-full py-2.5 rounded-xl text-sm font-black transition-all disabled:opacity-60"
                      style={{
                        background: isCurrent ? tc.accent + "20" : tier.price === 0 ? "#1e1e2e" : tc.accent,
                        color: isCurrent || tier.price === 0 ? tc.accent : "#08080c",
                        border: isCurrent || tier.price === 0 ? `1px solid ${tc.accent}40` : "none",
                        cursor: isCurrent || tier.price === 0 || missingPrice ? "default" : "pointer",
                      }}>
                      {isCurrent ? "Current Plan" : tier.price === 0 ? "Your Base Tier" : missingPrice ? "Not Configured" : `Upgrade to ${tier.label}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── SPEND COINS ── */}
          <div className="mb-10">
            <div className="text-xs font-black uppercase tracking-[0.15em] mb-5" style={{ color: "#22d3ee" }}>Spend Your LBC</div>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))" }}>
              {SPEND_FEATURES.map(feat => (
                <div key={feat.id} className="flex flex-col p-4 rounded-xl" style={{ background: "#101018", border: "1px solid #1e1e2e" }}>
                  <div className="text-xs font-black mb-1" style={{ color: "#f0f0f6" }}>{feat.title}</div>
                  <div className="text-[11px] leading-relaxed flex-1 mb-3" style={{ color: "#6b7280" }}>{feat.desc}</div>
                  <div className="flex items-center justify-between pt-3 border-t" style={{ borderColor: "#1e1e2e" }}>
                    <span className="text-sm font-black" style={{ color: "#fbbf24" }}>{feat.cost} LBC</span>
                    <button onClick={async () => {
                        if (litBitCoins < feat.cost) { showToast(`Need ${feat.cost} LBC. You have ${litBitCoins}`, "error"); return; }
                        const nb = await syncWallet(-feat.cost);
                        if (nb === null) { showToast("Transaction failed.", "error"); return; }
                        showToast(`${feat.action}: ${feat.title}. −${feat.cost} LBC`, "success");
                      }}
                      className="px-3 py-1.5 rounded-lg text-xs font-black transition-all hover:scale-[1.02]"
                      style={{ background: "#6366f120", border: "1px solid #6366f140", color: "#a78bfa" }}>
                      {feat.action}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Preview Modal */}
      {previewAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" onClick={() => setPreviewAgent(null)}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}
            style={{ background: "#101018", border: "1px solid #1e1e2e", boxShadow: "0 32px 64px rgba(0,0,0,0.6)" }}>
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b" style={{ borderColor: "#1e1e2e" }}>
              <div className="flex items-center gap-4">
                <AgentAvatar slug={previewAgent.slug} size={56} />
                <div>
                  <div className="text-lg font-black mb-0.5" style={{ color: "#f0f0f6" }}>{previewAgent.name}</div>
                  <div className="text-xs capitalize" style={{ color: "#6b7280" }}>
                    {CATEGORY_LABELS[previewAgent.category] || previewAgent.category} · {previewAgent.personality}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: "#6b7280" }}>
                    <span className="text-yellow-400">★ {previewAgent.rating}</span>
                    <span>· {(previewAgent.installs || 0).toLocaleString()} installs</span>
                    <span className="font-black" style={{ color: previewAgent.price_cents === 0 ? "#4ade80" : "#fbbf24" }}>{formatPrice(previewAgent.price_cents)}</span>
                  </div>
                </div>
              </div>
              <button onClick={() => setPreviewAgent(null)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors" style={{ color: "#6b7280" }}>✕</button>
            </div>
            {/* Body */}
            <div className="p-6 space-y-5">
              <p className="text-sm leading-relaxed" style={{ color: "#9ca3af" }}>{previewAgent.description}</p>
              {/* LiTTree routing note */}
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs" style={{ background: "#a3f54608", border: "1px solid #a3f54620", color: "#a3f546" }}>
                🌳 Routes through <strong>LiTTree</strong> — installs as a skill extension to your core OS agent
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.12em] mb-2" style={{ color: "#6b7280" }}>Capabilities</div>
                <div className="flex flex-wrap gap-1.5">
                  {previewAgent.features.map((f, i) => {
                    const cc = getCategoryColor(previewAgent.category);
                    return <span key={i} className="px-2 py-1 rounded-md text-[11px] font-medium" style={{ background: `${cc}12`, color: cc, border: `1px solid ${cc}25` }}>{f}</span>;
                  })}
                </div>
              </div>

              {/* CLI Install */}
              <div>
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] mb-2" style={{ color: "#6b7280" }}>
                  <Terminal size={11} /> Install via CLI
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "#08080c", border: "1px solid #1e1e2e" }}>
                    <span className="text-[9px] font-black uppercase shrink-0" style={{ color: "#22d3ee" }}>PS</span>
                    <code className="flex-1 text-[11px] truncate" style={{ color: "#9ca3af" }}>
                      npx litlabs install {previewAgent.slug}
                    </code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(`npx litlabs install ${previewAgent.slug}`); showToast("Copied PowerShell command", "success"); }}
                      className="p-1 rounded transition-colors hover:bg-white/10"
                      style={{ color: "#6b7280" }}
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: "#08080c", border: "1px solid #1e1e2e" }}>
                    <span className="text-[9px] font-black uppercase shrink-0" style={{ color: "#a3f546" }}>WSL</span>
                    <code className="flex-1 text-[11px] truncate" style={{ color: "#9ca3af" }}>
                      curl -fsSL litlabs.net/install.sh | sh -s -- {previewAgent.slug}
                    </code>
                    <button
                      onClick={() => { navigator.clipboard.writeText(`curl -fsSL litlabs.net/install.sh | sh -s -- ${previewAgent.slug}`); showToast("Copied WSL command", "success"); }}
                      className="p-1 rounded transition-colors hover:bg-white/10"
                      style={{ color: "#6b7280" }}
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                {installedAgents.has(previewAgent.id) ? (
                  <>
                    <button disabled className="flex-1 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-1.5" style={{ background: "#1e1e2e", color: "#6b7280" }}>
                      <Check size={13} /> Installed
                    </button>
                    <button onClick={() => { uninstallAgent(previewAgent.id); setPreviewAgent(null); }}
                      className="px-4 py-2.5 rounded-xl text-xs font-black transition-all hover:scale-[1.02]"
                      style={{ background: "#f8717115", border: "1px solid #f8717140", color: "#f87171" }}>
                      Uninstall
                    </button>
                    {!listedAgents.has(previewAgent.id) && (
                      <button onClick={() => { setPreviewAgent(null); setSellModalAgent(previewAgent); }}
                        className="px-4 py-2.5 rounded-xl text-xs font-black transition-all hover:scale-[1.02]"
                        style={{ background: "#fbbf2415", border: "1px solid #fbbf2440", color: "#fbbf24" }}>
                        🏪 Sell
                      </button>
                    )}
                  </>
                ) : (
                  <button onClick={() => { installAgent(previewAgent.id); if (previewAgent.price_cents === 0 || litBitCoins >= previewAgent.price_cents) setPreviewAgent(null); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-black transition-all hover:scale-[1.02]"
                    style={{ background: previewAgent.price_cents === 0 ? "#4ade80" : "#a3f546", color: "#08080c" }}>
                    {previewAgent.price_cents === 0 ? "Install Free" : `Buy — ${formatPrice(previewAgent.price_cents)}`}
                  </button>
                )}
                <Link href="/studio?tool=chat" onClick={() => setPreviewAgent(null)}
                  className="px-4 py-2.5 rounded-xl text-xs font-black transition-all hover:scale-[1.02]"
                  style={{ background: "linear-gradient(135deg,#6366f1,#22d3ee)", color: "#fff" }}>
                  Open LiTTree
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {sellModalAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm" onClick={() => setSellModalAgent(null)}>
          <div className="w-full max-w-sm rounded-2xl p-6" onClick={e => e.stopPropagation()}
            style={{ background: "#101018", border: "1px solid #fbbf2440", boxShadow: "0 32px 64px rgba(0,0,0,0.6)" }}>
            <div className="text-base font-black mb-1" style={{ color: "#fbbf24" }}>🏪 List Agent for Sale</div>
            <p className="text-xs mb-5" style={{ color: "#6b7280" }}>
              List <strong style={{ color: "#f0f0f6" }}>{sellModalAgent.name}</strong> on the marketplace. You earn 90% of each sale.
            </p>
            <label className="block text-[10px] font-black uppercase tracking-[0.12em] mb-1.5" style={{ color: "#6b7280" }}>Set Price (LBC)</label>
            <input type="number" min="1" max="9999" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder="e.g. 250"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-1"
              style={{ background: "#08080c", border: "1px solid #fbbf2440", color: "#f0f0f6" }} />
            {sellPrice && <div className="text-[10px] mb-4" style={{ color: "#6b7280" }}>~{Math.floor(Number(sellPrice) * 0.9)} LBC per sale after 10% fee</div>}
            <div className="flex gap-2">
              <button onClick={() => { if (sellPrice && Number(sellPrice) > 0) listForSale(sellModalAgent.id, Number(sellPrice)); }}
                disabled={!sellPrice || Number(sellPrice) <= 0}
                className="flex-1 py-2.5 rounded-xl text-sm font-black disabled:opacity-50"
                style={{ background: Number(sellPrice) > 0 ? "#fbbf24" : "#1e1e2e", color: "#08080c", cursor: Number(sellPrice) > 0 ? "pointer" : "default" }}>
                List Now
              </button>
              <button onClick={() => setSellModalAgent(null)}
                className="px-4 py-2.5 rounded-xl text-xs font-black"
                style={{ background: "#1e1e2e", color: "#6b7280", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentAvatar({ slug, size = 40 }: { slug: string; size?: number }) {
  const meta: AgentAvatarMeta | undefined = AGENT_AVATAR_META[slug];
  if (!meta)
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: size * 0.2,
          background: "#333",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size * 0.45,
          border: "1px solid #555",
        }}
      >
        🤖
      </div>
    );
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.2,
        background: meta.bg,
        border: `1.5px solid ${meta.color}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.5,
        lineHeight: 1,
      }}
    >
      {meta.emoji}
    </div>
  );
}

function AgentCard({
  agent,
  isInstalled,
  onInstall,
  onPreview,
  theme,
}: {
  agent: Agent;
  isInstalled: boolean;
  onInstall: () => void;
  onPreview: () => void;
  theme: Record<string, string>;
}) {
  const T = theme;
  const [hovered, setHovered] = useState(false);
  const categoryColor = getCategoryColor(agent.category);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative rounded-2xl overflow-hidden transition-all duration-300"
      style={{
        background: hovered ? `linear-gradient(135deg,#101018,${categoryColor}08)` : "#101018",
        border: `1px solid ${hovered ? categoryColor + "60" : "#1e1e2e"}`,
        transform: hovered ? "translateY(-4px)" : "translateY(0)",
        boxShadow: hovered ? `0 16px 32px ${categoryColor}15` : "none",
      }}
    >
      {/* Category accent line */}
      <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg,${categoryColor},transparent)` }} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-start gap-3 mb-4">
          <AgentAvatar slug={agent.slug} size={48} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-sm font-bold truncate"
                style={{ color: T.textColor }}
              >
                {agent.name}
              </span>
              {agent.is_featured && (
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                  style={{
                    background: categoryColor + "20",
                    color: categoryColor,
                  }}
                >
                  ★
                </span>
              )}
            </div>
            <div
              className="flex items-center gap-2 text-[10px]"
              style={{ color: T.textMuted }}
            >
              <span className="capitalize">
                {CATEGORY_LABELS[agent.category] || agent.category}
              </span>
              <span>·</span>
              <span className="flex items-center gap-0.5">
                <span className="text-yellow-400">★</span> {agent.rating}
              </span>
              <span>·</span>
              <span>{(agent.installs || 0).toLocaleString()} installs</span>
            </div>
          </div>
          <div
            className="px-2.5 py-1 rounded-lg text-[10px] font-bold shrink-0"
            style={{
              background:
                agent.price_cents === 0
                  ? categoryColor + "20"
                  : categoryColor + "30",
              color: agent.price_cents === 0 ? categoryColor : "#fff",
              border: `1px solid ${categoryColor}50`,
            }}
          >
            {formatPrice(agent.price_cents)}
          </div>
        </div>

        {/* Description */}
        <p
          className="text-xs leading-relaxed mb-4 line-clamp-2"
          style={{ color: T.textMuted }}
        >
          {agent.description}
        </p>

        {/* Features */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {agent.features.slice(0, 3).map((f, i) => (
            <span
              key={i}
              className="px-2 py-0.5 rounded-md text-[9px] font-medium"
              style={{
                background: categoryColor + "10",
                color: categoryColor,
                border: `1px solid ${categoryColor}20`,
              }}
            >
              {f}
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onPreview}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{
              background: T.bgColor,
              color: T.textColor,
              border: `1px solid ${T.borderColor}40`,
            }}
          >
            Preview
          </button>
          {isInstalled ? (
            <button
              disabled
              className="flex-1 py-2.5 rounded-xl text-xs font-bold cursor-not-allowed"
              style={{
                background: T.borderColor + "30",
                color: T.textMuted,
                border: `1px solid ${T.borderColor}30`,
              }}
            >
              <span className="flex items-center justify-center gap-1">
                <Check size={12} /> Installed
              </span>
            </button>
          ) : (
            <button
              onClick={onInstall}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: categoryColor,
                color: "#000",
              }}
            >
              {agent.price_cents === 0 ? "Install Free" : "Buy Now"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* Wrap in Suspense for useSearchParams */
export default function Marketplace() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ backgroundColor: "#0a0a0f" }}
        >
          <div className="text-center">
            <div className="text-3xl mb-4 animate-pulse">⚡</div>
            <div className="text-sm font-bold opacity-60">
              Loading Marketplace...
            </div>
          </div>
        </div>
      }
    >
      <MarketplaceInner />
    </Suspense>
  );
}
