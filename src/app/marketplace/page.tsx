"use client";
export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect, Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
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
  label: string;
  tier: string;
  popular: boolean;
  features: string[];
}[] = [
  {
    id: "tier-free",
    coins: 100,
    price: 0,
    priceId: "",
    label: "Free",
    tier: "free",
    popular: false,
    features: ["1 agent slot", "Basic tools", "Community support"],
  },
  {
    id: "tier-starter",
    coins: 500,
    price: 5,
    priceId: "price_1TogVaJ53kgx4fp5pclmzUZv",
    label: "Starter",
    tier: "starter",
    popular: true,
    features: ["5 agent slots", "All basic tools", "Priority support", "Daily bonus +50"],
  },
  {
    id: "tier-pro",
    coins: 1500,
    price: 19.99,
    priceId: "price_1TogZdJ53kgx4fp56g6bewkx",
    label: "Pro",
    tier: "pro",
    popular: false,
    features: ["Unlimited agent slots", "All premium tools", "24/7 support", "Daily bonus +200", "Priority processing"],
  },
  {
    id: "tier-elite",
    coins: 5000,
    price: 50,
    priceId: "price_1TogWpJ53kgx4fp5D5qi1ld8",
    label: "Elite",
    tier: "elite",
    popular: false,
    features: ["Unlimited agent slots", "All tools + beta", "Dedicated support", "Daily bonus +1000", "Highest priority", "Early access"],
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
  // FREE TIER - Core agents
  {
    id: "1",
    slug: "director",
    name: "Director",
    description:
      "The master orchestrator. Coordinates strategy, builds agent systems, and delegates tasks across your entire platform.",
    category: "orchestrator",
    avatar_url: AGENT_AVATARS.director,
    price_cents: 0,
    features: [
      "Multi-agent orchestration",
      "Strategy planning",
      "Workflow automation",
    ],
    is_featured: true,
    personality: "Strategic, decisive, concise",
    rating: 4.9,
    installs: 1240,
  },
  {
    id: "2",
    slug: "champion",
    name: "Champion",
    description:
      "Your all-purpose AI partner. Brainstorm, research, plan, and execute any task with unlimited versatility.",
    category: "general",
    avatar_url: AGENT_AVATARS.champion,
    price_cents: 0,
    features: ["General assistance", "Brainstorming", "Research"],
    is_featured: true,
    personality: "Helpful, thorough, direct",
    rating: 4.8,
    installs: 2103,
  },
  {
    id: "3",
    slug: "code-champion",
    name: "Code Champion",
    description:
      "Senior software engineer. Writes, reviews, debugs, and explains code across all languages and frameworks.",
    category: "developer",
    avatar_url: AGENT_AVATARS["code-champion"],
    price_cents: 0,
    features: ["Code generation", "Debugging", "Architecture"],
    is_featured: true,
    personality: "Precise, clean, practical",
    rating: 4.9,
    installs: 1567,
  },

  // BUDGET TIER (50-150 coins ~ $0.50-$1.50)
  {
    id: "4",
    slug: "writing-coach",
    name: "Writing Coach",
    description:
      "Master copywriter. Elevates writing quality — editing, tone adjustment, copywriting, and storytelling.",
    category: "content",
    avatar_url: AGENT_AVATARS["writing-coach"],
    price_cents: 75,
    features: ["Editing", "Tone adjustment", "Copywriting"],
    is_featured: false,
    personality: "Constructive, articulate, refined",
    rating: 4.8,
    installs: 1120,
  },
  {
    id: "5",
    slug: "research-guru",
    name: "Research Guru",
    description:
      "Deep research agent. Synthesizes information from multiple sources, fact-checks, and produces reports.",
    category: "research",
    avatar_url: AGENT_AVATARS["research-guru"],
    price_cents: 100,
    features: ["Deep research", "Fact-checking", "Reporting"],
    is_featured: false,
    personality: "Thorough, skeptical, rigorous",
    rating: 4.5,
    installs: 432,
  },
  {
    id: "6",
    slug: "support-agent",
    name: "Support Agent",
    description:
      "Customer support specialist. Handles inquiries, troubleshooting, and creates FAQ documentation.",
    category: "general",
    avatar_url: AGENT_AVATARS["support-agent"],
    price_cents: 50,
    features: ["Support tickets", "Documentation", "Troubleshooting"],
    is_featured: false,
    personality: "Patient, helpful, clear",
    rating: 4.6,
    installs: 543,
  },

  // PRO TIER (200-500 coins ~ $2-$5)
  {
    id: "7",
    slug: "social-dominator",
    name: "Social Dominator",
    description:
      "Growth hacker and content creator. Writes viral posts, crafts strategies, and helps you dominate social media.",
    category: "marketing",
    avatar_url: AGENT_AVATARS["social-dominator"],
    price_cents: 250,
    features: ["Viral content", "Growth strategy", "Analytics"],
    is_featured: true,
    personality: "Bold, creative, results-driven",
    rating: 4.7,
    installs: 890,
  },
  {
    id: "8",
    slug: "data-slayer",
    name: "Data Slayer",
    description:
      "Data scientist. Analyzes data, builds models, creates visualizations, and surfaces actionable insights.",
    category: "analytics",
    avatar_url: AGENT_AVATARS["data-slayer"],
    price_cents: 300,
    features: ["Data analysis", "Modeling", "Visualization"],
    is_featured: true,
    personality: "Precise, analytical, data-driven",
    rating: 4.6,
    installs: 654,
  },
  {
    id: "9",
    slug: "pixel-forge",
    name: "Pixel Forge",
    description:
      "AI image and 3D world generation specialist. Creates stunning visuals, textures, and immersive environments.",
    category: "design",
    avatar_url: AGENT_AVATARS["pixel-forge"],
    price_cents: 200,
    features: ["Image generation", "360 worlds", "Texture design"],
    is_featured: true,
    personality: "Visionary, artistic, detailed",
    rating: 4.8,
    installs: 921,
  },
  {
    id: "10",
    slug: "music-producer",
    name: "Music Producer",
    description:
      "Creates original music from text prompts and lyrics. Generates songs, instrumentals, and covers with AI.",
    category: "music",
    avatar_url: AGENT_AVATARS["music-producer"],
    price_cents: 400,
    features: ["Music generation", "Lyrics writing", "Style guidance"],
    is_featured: true,
    personality: "Creative, musical, expressive",
    rating: 4.7,
    installs: 743,
  },

  // ELITE TIER (1000+ coins ~ $10+)
  {
    id: "11",
    slug: "legal-shield",
    name: "Legal Shield",
    description:
      "Legal assistant for contracts, compliance, and regulatory guidance. Not a lawyer, but a powerful research aide.",
    category: "legal",
    avatar_url: AGENT_AVATARS["legal-shield"],
    price_cents: 1000,
    features: ["Contract review", "Compliance", "Legal research"],
    is_featured: false,
    personality: "Cautious, precise, thorough",
    rating: 4.4,
    installs: 210,
  },
  {
    id: "12",
    slug: "security-guru",
    name: "Security Guru",
    description:
      "Cybersecurity expert. Audits code, finds vulnerabilities, and recommends security best practices.",
    category: "developer",
    avatar_url: AGENT_AVATARS["security-guru"],
    price_cents: 1200,
    features: ["Security audits", "Vulnerability scanning", "Best practices"],
    is_featured: false,
    personality: "Paranoid, thorough, vigilant",
    rating: 4.7,
    installs: 156,
  },
  {
    id: "13",
    slug: "ml-engineer",
    name: "ML Engineer",
    description:
      "Machine learning specialist. Builds models, optimizes training, and deploys AI systems.",
    category: "analytics",
    avatar_url: AGENT_AVATARS["ml-engineer"],
    price_cents: 1500,
    features: ["Model training", "Hyperparameter tuning", "Model deployment"],
    is_featured: false,
    personality: "Methodical, experimental, rigorous",
    rating: 4.8,
    installs: 89,
  },

  // SPECIALIST AGENTS - Real team members from agents.ts
  {
    id: "14",
    slug: "alexchen",
    name: "Alex Chen",
    description:
      "AI Agent Architect & Full-Stack Builder. Trained 47 specialized models. Builds multi-agent systems that actually work.",
    category: "developer",
    avatar_url: AGENT_AVATARS.alexchen,
    price_cents: 500,
    features: [
      "Multi-agent architecture",
      "React/Node/Gemini integration",
      "Prompt engineering",
      "Mentoring",
    ],
    is_featured: true,
    personality: "Strategic, technical, visionary, nerdy-helpful",
    rating: 4.9,
    installs: 342,
  },
  {
    id: "15",
    slug: "sarahk",
    name: "Sarah K.",
    description:
      "Growth Hacker & Marketing Strategist. Turns zero-budget campaigns into viral sensations. Lives for social growth and SEO.",
    category: "marketing",
    avatar_url: AGENT_AVATARS.sarahk,
    price_cents: 400,
    features: [
      "Viral marketing",
      "SEO strategy",
      "Community building",
      "Growth loops",
    ],
    is_featured: true,
    personality: "Energetic, data-driven, sharp, results-obsessed",
    rating: 4.8,
    installs: 567,
  },
  {
    id: "16",
    slug: "mikedev",
    name: "Mike Dev",
    description:
      "Full-Stack Engineer & API Wizard. Builds systems that scale. React, Node, Go, Rust — ships fast, open sources everything.",
    category: "developer",
    avatar_url: AGENT_AVATARS.mikedev,
    price_cents: 450,
    features: [
      "Full-stack architecture",
      "API design",
      "Real-time systems",
      "Database optimization",
    ],
    is_featured: true,
    personality:
      "Pragmatic, systems-oriented, blunt but fair, deeply technical",
    rating: 4.9,
    installs: 423,
  },
  {
    id: "17",
    slug: "jtaylor",
    name: "J. Taylor",
    description:
      "Storyteller, Content Strategist, and AI Writing Coach. Helps founders find their voice and brands find their story.",
    category: "content",
    avatar_url: AGENT_AVATARS.jtaylor,
    price_cents: 350,
    features: [
      "Copywriting that converts",
      "Brand voice development",
      "SEO content strategy",
      "Script writing",
    ],
    is_featured: true,
    personality: "Eloquent, thoughtful, creative, warm and strategically sharp",
    rating: 4.8,
    installs: 389,
  },
  {
    id: "18",
    slug: "home",
    name: "Home Controller",
    description:
      "Smart Home Manager. Controls Home Assistant devices — lights, climate, media, notifications. Your home's AI butler.",
    category: "general",
    avatar_url: AGENT_AVATARS.home,
    price_cents: 250,
    features: [
      "Device control",
      "Climate management",
      "Media playback",
      "TTS announcements",
    ],
    is_featured: false,
    personality: "Friendly, efficient, knows every device in your home",
    rating: 4.7,
    installs: 278,
  },
];

// Build slug→demo lookup for metadata enrichment
const DEMO_BY_SLUG = Object.fromEntries(DEMO_AGENTS.map((a) => [a.slug, a]));

const MARKETPLACE_SHOWCASE = [
  {
    src: "/showcase/cover-architecture.png",
    title: "Architecture",
    subtitle: "Multi-agent systems and orchestration",
  },
  {
    src: "/showcase/control-center.png",
    title: "Control Center",
    subtitle: "Live agent management and installs",
  },
  {
    src: "/showcase/engine-routing.png",
    title: "Engine Routing",
    subtitle: "Dispatch work to the right specialist",
  },
];

const CATEGORY_ART: Record<string, string> = {
  developer: "/showcase/engine-routing.png",
  orchestrator: "/showcase/cover-architecture.png",
  analytics: "/showcase/control-center.png",
  marketing: "/showcase/control-center.png",
  content: "/showcase/cover-architecture.png",
  design: "/showcase/engine-routing.png",
  research: "/showcase/control-center.png",
  music: "/showcase/cover-architecture.png",
  legal: "/showcase/control-center.png",
  general: "/showcase/engine-routing.png",
};

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
  const [activeTab, setActiveTab] = useState<"agents" | "coins">("agents");

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
        // Append demo agents not in API response so UI stays complete
        const apiSlugs = new Set(merged.map((a) => a.slug));
        const extraDemo = DEMO_AGENTS.filter((a) => !apiSlugs.has(a.slug));
        setAgents([...merged, ...extraDemo]);
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
    });
    return () => cancelAnimationFrame(id);
  }, [loadAgents, fetchWallet, searchParams]);

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
          priceId: pack.priceId || "",
          priceData: {
            amount: pack.price * 100,
            currency: "usd",
            name: `${pack.label} Membership`,
            description: `${pack.features.slice(0, 2).join(", ")}`,
          },
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

  const featuredAgents = filteredAgents.filter((a) => a.is_featured);
  const newArrivals = filteredAgents.filter((a) =>
    ["14", "15", "16", "17", "18"].includes(a.id),
  );
  const regularAgents = filteredAgents.filter(
    (a) => !["14", "15", "16", "17", "18"].includes(a.id),
  );

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
          body: JSON.stringify({ agentId: agent.id }),
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

  const stats: Record<string, number | string> = {
    total: agents.length,
    free: agents.filter((a) => a.price_cents === 0).length,
    installed: installedAgents.size,
    coins: litBitCoins + " 🪙",
  };

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{
        backgroundColor: T.bgColor,
        color: T.textColor,
        position: "relative",
      }}
    >
      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            top: "80px",
            right: "20px",
            zIndex: 200,
            padding: "12px 20px",
            backgroundColor:
              toast.type === "success"
                ? "#0a2e0a"
                : toast.type === "error"
                  ? "#2e0a0a"
                  : "#0a1a2e",
            border:
              "2px solid " +
              (toast.type === "success"
                ? T.accentColor
                : toast.type === "error"
                  ? "#ff4444"
                  : T.linkColor),
            color:
              toast.type === "success"
                ? T.accentColor
                : toast.type === "error"
                  ? "#ff4444"
                  : T.linkColor,
            fontSize: "12px",
            fontWeight: "bold",
            maxWidth: "320px",
          }}
        >
          {toast.msg}
        </div>
      )}

      <div
        style={{
          borderBottom: "1px solid " + T.borderColor,
          padding: "28px 24px 20px",
          background:
            "linear-gradient(180deg, " +
            T.boxBg +
            " 0%, " +
            T.bgColor +
            " 100%)",
        }}
      >
        <div className="mx-auto max-w-6xl">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.15fr 0.85fr",
              gap: "20px",
              alignItems: "stretch",
            }}
          >
            <div
              style={{
                textAlign: "left",
                padding: "26px",
                border: "1px solid " + T.borderColor,
                borderRadius: "18px",
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))",
                boxShadow: "0 18px 50px rgba(0,0,0,0.22)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: "12px",
                  marginBottom: "10px",
                  flexWrap: "wrap",
                }}
              >
                <h1
                  style={{
                    color: T.headerColor,
                    fontSize: "28px",
                    fontWeight: "bold",
                    letterSpacing: "2px",
                    margin: 0,
                  }}
                >
                  AGENT MARKETPLACE
                </h1>
                <span
                  style={{
                    padding: "4px 10px",
                    backgroundColor: "rgba(255,107,107,0.12)",
                    border: "1px solid #ff6b6b66",
                    color: "#ff8d8d",
                    fontSize: "10px",
                    fontWeight: "bold",
                    borderRadius: "6px",
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                  }}
                >
                  Beta
                </span>
              </div>
              <p
                style={{
                  color: T.textColor,
                  fontSize: "14px",
                  opacity: 0.72,
                  maxWidth: "620px",
                  margin: "0 0 18px",
                  lineHeight: 1.6,
                }}
              >
                Discover, install, and deploy AI agents to your workspace.
                Free agents install instantly, pro agents unlock with your
                tier, and premium listings are priced in LiTBit Coins.
              </p>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  marginBottom: "18px",
                }}
              >
                <span className="badge badge-pink">Marketplace</span>
                <span className="badge">Stable rules</span>
                <span className="badge badge-success">Server-side installs</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "12px",
                  marginBottom: "18px",
                }}
              >
                {[
                  { label: "Agents", value: stats.total, icon: Sparkles },
                  { label: "Free", value: stats.free, icon: ShieldCheck },
                  { label: "Installed", value: stats.installed, icon: WandSparkles },
                  { label: "Balance", value: stats.coins, icon: Coins },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.label}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "14px 16px",
                        borderRadius: "14px",
                        border: "1px solid " + T.borderColor,
                        backgroundColor: "rgba(255,255,255,0.025)",
                      }}
                    >
                      <div
                        style={{
                          width: "38px",
                          height: "38px",
                          borderRadius: "12px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          backgroundColor: T.accentColor + "18",
                          color: T.accentColor,
                        }}
                      >
                        <Icon size={18} />
                      </div>
                      <div>
                        <div
                          style={{
                            color: T.textColor,
                            fontSize: "18px",
                            fontWeight: "bold",
                            lineHeight: 1.1,
                          }}
                        >
                          {item.value}
                        </div>
                        <div
                          style={{
                            color: T.textColor,
                            fontSize: "10px",
                            opacity: 0.6,
                            textTransform: "uppercase",
                            letterSpacing: "1px",
                          }}
                        >
                          {item.label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <Link
                  href="/studio"
                  style={{
                    padding: "12px 18px",
                    backgroundColor: T.linkColor,
                    color: "white",
                    textDecoration: "none",
                    fontSize: "12px",
                    fontWeight: "bold",
                    borderRadius: "10px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  Open in Studio <ArrowRight size={15} />
                </Link>
                <button
                  onClick={() => setActiveTab("coins")}
                  style={{
                    padding: "12px 18px",
                    backgroundColor: "rgba(255,215,0,0.08)",
                    border: "1px solid rgba(255,215,0,0.35)",
                    color: "gold",
                    fontSize: "12px",
                    cursor: "pointer",
                    fontWeight: "bold",
                    borderRadius: "10px",
                  }}
                >
                  View Coin Packs
                </button>
              </div>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "10px",
              }}
            >
              {MARKETPLACE_SHOWCASE.map((item, idx) => (
                <div
                  key={item.title}
                  style={{
                    position: "relative",
                    minHeight: idx === 0 ? "220px" : "155px",
                    borderRadius: "18px",
                    overflow: "hidden",
                    border: "1px solid " + T.borderColor,
                    backgroundColor: T.bgColor,
                    gridColumn: idx === 0 ? "1 / -1" : "auto",
                  }}
                >
                  <Image
                    src={item.src}
                    alt={item.title}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    style={{ objectFit: "cover" }}
                    priority={idx === 0}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background:
                        "linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.68) 100%)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      padding: "14px",
                    }}
                  >
                    <div
                      style={{
                        color: "#fff",
                        fontSize: idx === 0 ? "18px" : "14px",
                        fontWeight: "bold",
                        marginBottom: "4px",
                      }}
                    >
                      {item.title}
                    </div>
                    <div
                      style={{
                        color: "rgba(255,255,255,0.75)",
                        fontSize: "11px",
                        lineHeight: 1.45,
                      }}
                    >
                      {item.subtitle}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "8px",
              marginTop: "20px",
            }}
          >
            <button
              onClick={() => setActiveTab("agents")}
              style={{
                padding: "12px 32px",
                fontSize: "14px",
                fontWeight: "bold",
                border:
                  "2px solid " +
                  (activeTab === "agents" ? T.accentColor : T.borderColor),
                backgroundColor:
                  activeTab === "agents" ? T.accentColor + "20" : "transparent",
                color: activeTab === "agents" ? T.accentColor : T.textColor,
                borderRadius: "8px 8px 0 0",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>🤖</span> Agents{" "}
              <span
                style={{
                  padding: "2px 8px",
                  backgroundColor:
                    activeTab === "agents" ? T.accentColor : T.borderColor,
                  color: "#000",
                  fontSize: "11px",
                  borderRadius: "4px",
                }}
              >
                {stats.total}
              </span>
            </button>
            <button
              onClick={() => setActiveTab("coins")}
              style={{
                padding: "12px 32px",
                fontSize: "14px",
                fontWeight: "bold",
                border:
                  "2px solid " + (activeTab === "coins" ? "gold" : T.borderColor),
                backgroundColor:
                  activeTab === "coins" ? "rgba(255,215,0,0.15)" : "transparent",
                color: activeTab === "coins" ? "gold" : T.textColor,
                borderRadius: "8px 8px 0 0",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>🪙</span> LiTBit Coins
            </button>
          </div>
        </div>
      </div>

      {activeTab === "agents" && (
        <div className="flex-1 flex flex-col">
          <div
            style={{
              padding: "16px 24px",
              borderBottom: "1px solid " + T.borderColor,
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              backgroundColor: T.boxBg,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "6px",
                flexWrap: "wrap",
                flex: 1,
                alignItems: "center",
              }}
            >
              <button
                onClick={() => setSelectedCategory("")}
                style={{
                  padding: "6px 14px",
                  fontSize: "11px",
                  borderRadius: "6px",
                  border:
                    "1px solid " +
                    (selectedCategory === "" ? T.accentColor : T.borderColor),
                  backgroundColor:
                    selectedCategory === ""
                      ? "rgba(255,255,0,0.15)"
                      : "transparent",
                  color: selectedCategory === "" ? T.accentColor : T.textColor,
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontWeight: selectedCategory === "" ? "bold" : "normal",
                  transition: "all 0.15s",
                }}
              >
                All ({agents.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() =>
                    setSelectedCategory(cat === selectedCategory ? "" : cat)
                  }
                  style={{
                    padding: "6px 14px",
                    fontSize: "11px",
                    borderRadius: "6px",
                    border:
                      "1px solid " +
                      (selectedCategory === cat
                        ? T.accentColor
                        : T.borderColor),
                    backgroundColor:
                      selectedCategory === cat
                        ? "rgba(255,255,0,0.15)"
                        : "transparent",
                    color:
                      selectedCategory === cat ? T.accentColor : T.textColor,
                    cursor: "pointer",
                    fontFamily: "monospace",
                    textTransform: "capitalize",
                    fontWeight: selectedCategory === cat ? "bold" : "normal",
                    transition: "all 0.15s",
                  }}
                >
                  {CATEGORY_LABELS[cat] || cat} (
                  {agents.filter((a) => a.category === cat).length})
                </button>
              ))}
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents..."
                style={{
                  padding: "8px 14px",
                  backgroundColor: T.bgColor,
                  border: "1px solid " + T.borderColor,
                  borderRadius: "6px",
                  color: "#e0e0e0",
                  fontSize: "12px",
                  fontFamily: "monospace",
                  width: "200px",
                  outline: "none",
                }}
              />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{
                  padding: "8px 10px",
                  backgroundColor: T.bgColor,
                  border: "1px solid " + T.borderColor,
                  borderRadius: "6px",
                  color: T.textColor,
                  fontSize: "11px",
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                <option value="featured">Featured</option>
                <option value="popular">Popular</option>
                <option value="rating">Rating</option>
                <option value="price">Price</option>
                <option value="name">Name</option>
              </select>
              <Link
                href="/studio"
                style={{
                  padding: "8px 16px",
                  backgroundColor: T.linkColor,
                  color: "white",
                  textDecoration: "none",
                  fontSize: "11px",
                  fontWeight: "bold",
                  borderRadius: "6px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                Open in Studio
              </Link>
            </div>
          </div>

          <div
            className="flex-1"
            style={{
              padding: "24px",
              maxWidth: "1200px",
              margin: "0 auto",
              width: "100%",
            }}
          >
            {featuredAgents.length > 0 && !searchQuery && (
              <div style={{ marginBottom: "32px" }}>
                <div
                  style={{
                    color: T.accentColor,
                    fontSize: "11px",
                    letterSpacing: "2px",
                    marginBottom: "12px",
                    fontWeight: "bold",
                  }}
                >
                  ⭐ FEATURED AGENTS
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: "16px",
                  }}
                >
                  {featuredAgents.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      isInstalled={installedAgents.has(agent.id)}
                      onInstall={() => installAgent(agent.id)}
                      onPreview={() => setPreviewAgent(agent)}
                      theme={T}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* NEW ARRIVALS */}
            {newArrivals.length > 0 && !searchQuery && !selectedCategory && (
              <div style={{ marginBottom: "32px" }}>
                <div
                  style={{
                    color: "#22d3ee",
                    fontSize: "11px",
                    letterSpacing: "2px",
                    marginBottom: "12px",
                    fontWeight: "bold",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span>✨</span> NEW ARRIVALS
                  <span
                    style={{
                      backgroundColor: "#22d3ee20",
                      color: "#22d3ee",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      fontSize: "10px",
                    }}
                  >
                    Just Added
                  </span>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(260px, 1fr))",
                    gap: "16px",
                  }}
                >
                  {newArrivals.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      isInstalled={installedAgents.has(agent.id)}
                      onInstall={() => installAgent(agent.id)}
                      onPreview={() => setPreviewAgent(agent)}
                      theme={T}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ALL/REGULAR AGENTS */}
            <div>
              <div
                style={{
                  color: T.accentColor,
                  fontSize: "11px",
                  letterSpacing: "2px",
                  marginBottom: "12px",
                  fontWeight: "bold",
                }}
              >
                {selectedCategory
                  ? selectedCategory.toUpperCase() + " AGENTS"
                  : searchQuery
                    ? "SEARCH RESULTS"
                    : "ALL AGENTS"}
                <span
                  style={{
                    color: T.textColor,
                    opacity: 0.5,
                    marginLeft: "8px",
                  }}
                >
                  ({filteredAgents.length})
                </span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                  gap: "16px",
                }}
              >
                {(searchQuery ? filteredAgents : regularAgents).map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    isInstalled={installedAgents.has(agent.id)}
                    onInstall={() => installAgent(agent.id)}
                    onPreview={() => setPreviewAgent(agent)}
                    theme={T}
                  />
                ))}
              </div>
            </div>
            {filteredAgents.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  padding: "60px 20px",
                  color: T.textColor,
                  opacity: 0.5,
                }}
              >
                <div
                  style={{
                    fontSize: "24px",
                    fontWeight: "bold",
                    marginBottom: "12px",
                    color: T.headerColor,
                  }}
                >
                  ?
                </div>
                <div>No agents found matching your search.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "coins" && (
        <div
          className="flex-1"
          style={{
            padding: "24px",
            maxWidth: "1200px",
            margin: "0 auto",
            width: "100%",
          }}
        >
          {/* MEMBERSHIP TIERS */}
          <div style={{ marginBottom: "32px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "20px",
                flexWrap: "wrap",
                gap: "16px",
              }}
            >
              <div>
                <div
                  style={{
                    color: "gold",
                    fontSize: "14px",
                    letterSpacing: "2px",
                    marginBottom: "4px",
                    fontWeight: "bold",
                  }}
                >
                  ⭐ CHOOSE YOUR TIER
                </div>
                <p
                  style={{ color: T.textColor, fontSize: "12px", opacity: 0.7 }}
                >
                  Unlock features and capabilities based on your membership level.
                  <strong style={{ color: T.accentColor }}>
                    Free forever, upgrade anytime.
                  </strong>
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  onClick={earnCoins}
                  disabled={claimLoading}
                  style={{
                    padding: "10px 18px",
                    backgroundColor: `${T.accentColor}20`,
                    border: `2px solid ${T.accentColor}`,
                    color: T.accentColor,
                    fontSize: "12px",
                    cursor: claimLoading ? "not-allowed" : "pointer",
                    fontWeight: "bold",
                    borderRadius: "6px",
                    opacity: claimLoading ? 0.6 : 1,
                  }}
                >
                  {claimLoading ? "⏳ Claiming..." : "⚡ Claim Daily Bonus"}
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: "16px",
              }}
            >
              {TIER_PACKAGES.filter((t) => t.tier !== "free").map((tier) => (
                <div
                  key={tier.id}
                  style={{
                    position: "relative",
                    padding: "24px 20px",
                    border: `2px solid ${tier.popular ? "gold" : T.borderColor}`,
                    backgroundColor: tier.popular
                      ? "rgba(255,215,0,0.12)"
                      : T.boxBg,
                    textAlign: "center",
                    borderRadius: "12px",
                    transition: "all 0.2s",
                    boxShadow: tier.popular
                      ? "0 8px 32px rgba(255,215,0,0.15)"
                      : "none",
                  }}
                >
                  {tier.popular && (
                    <div
                      style={{
                        position: "absolute",
                        top: "-12px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        backgroundColor: "gold",
                        color: "black",
                        padding: "4px 16px",
                        fontSize: "11px",
                        fontWeight: "bold",
                        borderRadius: "4px",
                      }}
                    >
                      ⭐ BEST VALUE
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: "12px",
                      color: T.textColor,
                      opacity: 0.6,
                      marginBottom: "8px",
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                    }}
                  >
                    {tier.label}
                  </div>
                  <div
                    style={{
                      color: tier.popular ? "gold" : T.headerColor,
                      fontSize: "36px",
                      fontWeight: "bold",
                      marginBottom: "4px",
                    }}
                  >
                    {tier.price}
                  </div>
                  <div
                    style={{
                      color: T.textColor,
                      fontSize: "12px",
                      marginBottom: "12px",
                      opacity: 0.8,
                    }}
                  >
                    {tier.coins.toLocaleString()} LiTBit Coins included
                  </div>
                  <div
                    style={{
                      color: T.textColor,
                      fontSize: "11px",
                      opacity: 0.6,
                      marginBottom: "16px",
                    }}
                  >
                    {tier.features.slice(0, 3).join(" • ")}
                  </div>
                  <button
                    onClick={() => buyPack(tier)}
                    style={{
                      width: "100%",
                      padding: "12px",
                      backgroundColor: tier.popular ? "gold" : T.linkColor,
                      color: tier.popular ? "black" : "white",
                      border: "none",
                      fontWeight: "bold",
                      fontSize: "13px",
                      cursor: "pointer",
                      borderRadius: "6px",
                    }}
                  >
                    {tier.popular ? "⚡ Get Best Value" : "Get " + tier.label}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* SPEND COINS */}
          <div
            style={{
              borderTop: "2px solid " + T.borderColor,
              paddingTop: "32px",
              marginBottom: "32px",
            }}
          >
            <div
              style={{
                color: T.accentColor,
                fontSize: "14px",
                letterSpacing: "2px",
                marginBottom: "20px",
                fontWeight: "bold",
              }}
            >
              💎 SPEND YOUR COINS
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "16px",
              }}
            >
              {SPEND_FEATURES.map((feat) => (
                <div
                  key={feat.id}
                  style={{
                    padding: "20px",
                    border: "1px solid " + T.borderColor,
                    backgroundColor: T.boxBg,
                    borderRadius: "10px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: "bold",
                      color: T.accentColor,
                      marginBottom: "8px",
                      letterSpacing: "1px",
                    }}
                  >
                    {feat.title.toUpperCase()}
                  </div>
                  <div
                    style={{
                      color: T.headerColor,
                      fontSize: "14px",
                      fontWeight: "bold",
                      marginBottom: "4px",
                    }}
                  >
                    {feat.title}
                  </div>
                  <div
                    style={{
                      color: T.textColor,
                      fontSize: "11px",
                      opacity: 0.7,
                      lineHeight: 1.5,
                      marginBottom: "12px",
                      minHeight: "50px",
                    }}
                  >
                    {feat.desc}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingTop: "12px",
                      borderTop: "1px solid " + T.borderColor,
                    }}
                  >
                    <span
                      style={{
                        color: "gold",
                        fontSize: "16px",
                        fontWeight: "bold",
                      }}
                    >
                      {feat.cost} LBC
                    </span>
                    <button
                      onClick={async () => {
                        if (litBitCoins < feat.cost) {
                          showToast(
                            `Need ${feat.cost} LBC. You have ${litBitCoins}`,
                            "error",
                          );
                          return;
                        }
                        const newBal = await syncWallet(-feat.cost);
                        if (newBal === null) {
                          showToast(
                            "Transaction failed. Could not deduct coins.",
                            "error",
                          );
                          return;
                        }
                        showToast(
                          `${feat.action} ${feat.title}. -${feat.cost} LBC. Balance: ${newBal}`,
                          "success",
                        );
                      }}
                      style={{
                        padding: "8px 16px",
                        backgroundColor: T.linkColor,
                        color: "white",
                        border: "none",
                        fontSize: "12px",
                        fontWeight: "bold",
                        cursor: "pointer",
                        borderRadius: "6px",
                      }}
                    >
                      {feat.action}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PRICING EXAMPLES */}
          <div
            style={{
              borderTop: "2px solid " + T.borderColor,
              paddingTop: "24px",
            }}
          >
            <div
              style={{
                color: T.textColor,
                fontSize: "12px",
                letterSpacing: "1px",
                marginBottom: "16px",
                fontWeight: "bold",
                opacity: 0.8,
              }}
            >
              📊 WHAT CAN YOU BUY?
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
              {[
                { name: "Support Agent", cost: 50, color: T.accentColor },
                { name: "Writing Coach", cost: 75, color: T.headerColor },
                { name: "Research Guru", cost: 100, color: "#60a5fa" },
                { name: "Social Dominator", cost: 250, color: "#34d399" },
                { name: "Data Slayer", cost: 300, color: "#a78bfa" },
                { name: "Pixel Forge", cost: 200, color: "#ec4899" },
                { name: "Music Producer", cost: 400, color: "#22d3ee" },
                { name: "Legal Shield", cost: 1000, color: "#ff6b35" },
                { name: "Security Guru", cost: 1200, color: "#f87171" },
                { name: "ML Engineer", cost: 1500, color: "#fbbf24" },
              ].map((item) => (
                <div
                  key={item.name}
                  style={{
                    padding: "10px 16px",
                    border: "1px solid " + T.borderColor,
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      color: item.color,
                      fontWeight: "bold",
                      fontSize: "13px",
                    }}
                  >
                    {item.name}
                  </span>
                  <span
                    style={{
                      color: "gold",
                      fontSize: "12px",
                      fontWeight: "bold",
                    }}
                  >
                    {item.cost} LBC
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {previewAgent && (
        <div
          onClick={() => setPreviewAgent(null)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.85)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "600px",
              width: "100%",
              backgroundColor: T.boxBg,
              border: "2px solid " + T.borderColor,
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                padding: "24px",
                borderBottom: "1px solid " + T.borderColor,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div
                style={{ display: "flex", gap: "16px", alignItems: "center" }}
              >
                <AgentAvatar slug={previewAgent.slug} size={64} />
                <div>
                  <div
                    style={{
                      color: T.headerColor,
                      fontSize: "20px",
                      fontWeight: "bold",
                    }}
                  >
                    {previewAgent.name}
                  </div>
                  <div
                    style={{
                      color: T.textColor,
                      fontSize: "11px",
                      opacity: 0.7,
                      textTransform: "capitalize",
                    }}
                  >
                    {previewAgent.category} · {previewAgent.personality}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setPreviewAgent(null)}
                style={{
                  backgroundColor: "transparent",
                  border: "none",
                  color: T.textColor,
                  cursor: "pointer",
                  fontSize: "18px",
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: "24px" }}>
              <p
                style={{
                  color: T.textColor,
                  fontSize: "13px",
                  lineHeight: 1.6,
                  marginBottom: "20px",
                }}
              >
                {previewAgent.description}
              </p>
              <div style={{ marginBottom: "20px" }}>
                <div
                  style={{
                    color: T.accentColor,
                    fontSize: "10px",
                    letterSpacing: "1px",
                    marginBottom: "8px",
                  }}
                >
                  FEATURES
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {previewAgent.features.map((f, i) => (
                    <span
                      key={i}
                      style={{
                        padding: "4px 10px",
                        backgroundColor: "rgba(255,0,128,0.15)",
                        border: "1px solid " + T.linkColor,
                        color: T.linkColor,
                        fontSize: "11px",
                      }}
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "16px",
                  marginBottom: "20px",
                  fontSize: "12px",
                }}
              >
                <span style={{ color: T.textColor }}>
                  ⭐ {previewAgent.rating}/5.0
                </span>
                <span style={{ color: T.textColor }}>
                  📥 {(previewAgent.installs || 0).toLocaleString()} installs
                </span>
                <span
                  style={{
                    color:
                      previewAgent.price_cents === 0
                        ? T.accentColor
                        : T.headerColor,
                    fontWeight: "bold",
                  }}
                >
                  {formatPrice(previewAgent.price_cents)}
                </span>
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {installedAgents.has(previewAgent.id) ? (
                  <>
                    <button
                      disabled
                      style={{
                        flex: 1,
                        padding: "12px",
                        backgroundColor: "#333",
                        color: "#666",
                        border: "none",
                        fontWeight: "bold",
                      }}
                    >
                      ✓ Installed
                    </button>
                    <button
                      onClick={() => {
                        uninstallAgent(previewAgent.id);
                        setPreviewAgent(null);
                      }}
                      style={{
                        padding: "12px 14px",
                        border: "1px solid #ff4444",
                        color: "#ff4444",
                        backgroundColor: "rgba(255,68,68,0.1)",
                        cursor: "pointer",
                        fontWeight: "bold",
                        fontSize: "12px",
                      }}
                    >
                      Uninstall
                    </button>
                    {!listedAgents.has(previewAgent.id) && (
                      <button
                        onClick={() => {
                          setPreviewAgent(null);
                          setSellModalAgent(previewAgent);
                        }}
                        style={{
                          padding: "12px 16px",
                          border: "2px solid gold",
                          color: "gold",
                          backgroundColor: "rgba(255,215,0,0.1)",
                          cursor: "pointer",
                          fontWeight: "bold",
                          fontSize: "12px",
                        }}
                      >
                        🏪 Sell
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => {
                      installAgent(previewAgent.id);
                      if (
                        previewAgent.price_cents === 0 ||
                        litBitCoins >= previewAgent.price_cents
                      )
                        setPreviewAgent(null);
                    }}
                    style={{
                      flex: 1,
                      padding: "12px",
                      backgroundColor: T.linkColor,
                      color: "white",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: "bold",
                    }}
                  >
                    {previewAgent.price_cents === 0
                      ? "🚀 Install Free"
                      : "🪙 Buy — " + formatPrice(previewAgent.price_cents)}
                  </button>
                )}
                <Link
                  href="/studio"
                  onClick={() => setPreviewAgent(null)}
                  style={{
                    padding: "12px 20px",
                    border: "2px solid " + T.linkColor,
                    color: T.linkColor,
                    textDecoration: "none",
                    fontWeight: "bold",
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  Open in Studio
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {sellModalAgent && (
        <div
          onClick={() => setSellModalAgent(null)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.85)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: "400px",
              width: "100%",
              backgroundColor: T.boxBg,
              border: "2px solid gold",
              padding: "28px",
            }}
          >
            <h2
              style={{
                color: "gold",
                fontSize: "18px",
                fontWeight: "bold",
                marginBottom: "8px",
              }}
            >
              🏪 List Agent for Sale
            </h2>
            <p
              style={{
                color: T.textColor,
                fontSize: "12px",
                marginBottom: "20px",
                opacity: 0.8,
              }}
            >
              List{" "}
              <strong style={{ color: T.headerColor }}>
                {sellModalAgent.name}
              </strong>{" "}
              on the marketplace. Other users can buy it with 🪙 LiTBit Coins.
              You earn 90% of each sale.
            </p>
            <div style={{ marginBottom: "16px" }}>
              <label
                style={{
                  color: T.accentColor,
                  fontSize: "10px",
                  letterSpacing: "1px",
                  display: "block",
                  marginBottom: "6px",
                }}
              >
                SET PRICE (🪙 LiTBit Coins)
              </label>
              <input
                type="number"
                min="1"
                max="9999"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder="e.g. 250"
                style={{
                  width: "100%",
                  padding: "10px",
                  backgroundColor: T.bgColor,
                  border: "1px solid gold",
                  color: T.textColor,
                  fontSize: "14px",
                  fontFamily: "monospace",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {sellPrice && (
                <p
                  style={{
                    color: T.textColor,
                    fontSize: "10px",
                    marginTop: "4px",
                    opacity: 0.6,
                  }}
                >
                  You earn ~{Math.floor(Number(sellPrice) * 0.9)} 🪙 per sale
                  (10% platform fee)
                </p>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => {
                  if (sellPrice && Number(sellPrice) > 0)
                    listForSale(sellModalAgent.id, Number(sellPrice));
                }}
                disabled={!sellPrice || Number(sellPrice) <= 0}
                style={{
                  flex: 1,
                  padding: "12px",
                  backgroundColor: Number(sellPrice) > 0 ? "gold" : "#333",
                  color: Number(sellPrice) > 0 ? "black" : "#666",
                  border: "none",
                  cursor: Number(sellPrice) > 0 ? "pointer" : "not-allowed",
                  fontWeight: "bold",
                  fontSize: "13px",
                }}
              >
                🚀 List Now
              </button>
              <button
                onClick={() => setSellModalAgent(null)}
                style={{
                  padding: "12px 20px",
                  border: "1px solid " + T.borderColor,
                  color: T.textColor,
                  backgroundColor: "transparent",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
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
  const artSrc = CATEGORY_ART[agent.category] || "/showcase/control-center.png";

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative rounded-2xl overflow-hidden transition-all duration-300"
      style={{
        background: hovered
          ? `linear-gradient(135deg, ${T.boxBg}, ${categoryColor}08)`
          : T.boxBg,
        border: `1px solid ${hovered ? categoryColor : T.borderColor + "40"}`,
        transform: hovered ? "translateY(-6px)" : "translateY(0)",
        boxShadow: hovered
          ? `0 20px 40px ${categoryColor}15`
          : "0 4px 20px rgba(0,0,0,0.2)",
      }}
    >
      {/* Category accent line */}
      <div className="h-1 w-full" style={{ background: categoryColor }} />

      <div style={{ position: "relative", height: "132px", overflow: "hidden" }}>
        <Image
          src={artSrc}
          alt={agent.name}
          fill
          sizes="(max-width: 768px) 100vw, 25vw"
          style={{ objectFit: "cover" }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.1) 0%, rgba(0,0,0,0.72) 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "14px",
            right: "14px",
            bottom: "12px",
            display: "flex",
            justifyContent: "space-between",
            gap: "10px",
            alignItems: "end",
          }}
        >
          <div>
            <div
              style={{
                color: "#fff",
                fontSize: "14px",
                fontWeight: "bold",
                marginBottom: "4px",
              }}
            >
              {agent.name}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "1px",
              }}
            >
              {CATEGORY_LABELS[agent.category] || agent.category}
            </div>
          </div>
          <div
            style={{
              padding: "4px 8px",
              borderRadius: "999px",
              backgroundColor:
                agent.price_cents === 0
                  ? "rgba(255,255,255,0.15)"
                  : "rgba(0,0,0,0.5)",
              color: "#fff",
              fontSize: "10px",
              fontWeight: "bold",
              border: "1px solid rgba(255,255,255,0.14)",
            }}
          >
            {formatPrice(agent.price_cents)}
          </div>
        </div>
      </div>

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
