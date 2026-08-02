"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  ArrowRight,
  Check,
  Clock,
  Shield,
  Wrench,
  Rocket,
  Eye,
  FileCode,
  GitBranch,
  Loader2,
  Sparkles,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";

interface AgentDetailClientProps {
  agent: {
    id: string;
    slug: string;
    name: string;
    description: string;
    category: string;
    personality: string | null;
    is_featured: boolean;
  };
  listing: {
    id: string;
    slug: string;
    name: string;
    status: string;
    category: string;
    is_featured: boolean;
    is_official: boolean;
    is_beta: boolean;
    billing_model: string | null;
    risk_level: string | null;
    price_cents: number;
    compatible_assistants: string[];
    required_connections: string[];
  } | null;
  version: {
    id: string;
    version: string;
    model: string;
    features: string[];
    price_cents: number;
    currency: string;
    status: string;
    created_at: string;
  } | null;
  versionHistory: {
    id: string;
    version: string;
    status: string;
    created_at: string;
    features: string[];
  }[];
}

type AgentState = "buy" | "processing" | "install" | "open" | "disabled" | "revoked" | "unavailable" | "loading";

// ─── Agent-specific content ──────────────────────────────────────────────

const AGENT_OUTCOMES: Record<string, {
  outcome: string;
  targetCustomer: string;
  deliverables: string[];
  exampleInput: string;
  exampleResult: string;
  tools: { name: string; requiresApproval: boolean }[];
  approvalBoundaries: string[];
  typicalRange: string;
  refundTerms: string;
  supportPolicy: string;
}> = {
  "litt-launch-agent": {
    outcome: "Turns your idea into a deployed website with a real live URL.",
    targetCustomer: "Creators, small business owners, and founders who need a website launched without hiring a developer.",
    deliverables: [
      "Multi-page website with responsive design",
      "Desktop and mobile preview before deployment",
      "Build and test validation",
      "Production deployment to Vercel",
      "Live URL you can share immediately",
      "Next-step recommendations for improvement",
    ],
    exampleInput: "I need a landing page for my music production studio. It should show my services, have a contact form, and look dark and modern.",
    exampleResult: "A 3-page website (home, services, contact) deployed to https://your-studio.vercel.app with a working contact form, responsive design, and SEO metadata.",
    tools: [
      { name: "Read project files", requiresApproval: false },
      { name: "Write project files", requiresApproval: true },
      { name: "Create Git checkpoint", requiresApproval: true },
      { name: "Run build", requiresApproval: false },
      { name: "Run tests", requiresApproval: false },
      { name: "Start preview", requiresApproval: false },
      { name: "Trigger deployment", requiresApproval: true },
    ],
    approvalBoundaries: [
      "Plan approval required before any files are written",
      "Deploy approval required before any deployment is triggered",
      "The agent never deploys without your explicit approval",
      "The agent never runs arbitrary terminal commands",
      "The agent never accesses secrets or environment variables",
    ],
    typicalRange: "5-15 minutes from approval to live URL",
    refundTerms: "Full refund if the agent fails to produce a deployable build. No refund if you approve and deploy successfully.",
    supportPolicy: "Email support within 24 hours. Rollback to pre-build checkpoint available on failure.",
  },
};

const DEFAULT_OUTCOME = {
  outcome: "Specialized AI agent for your workflow.",
  targetCustomer: "Creators and builders who want done-for-you results.",
  deliverables: ["Customized output based on your request"],
  exampleInput: "Describe what you need...",
  exampleResult: "The agent will produce a result based on your request.",
  tools: [{ name: "Varies by agent", requiresApproval: true }],
  approvalBoundaries: ["Approval required for mutations"],
  typicalRange: "Varies",
  refundTerms: "Refund available if the agent fails to complete the task.",
  supportPolicy: "Email support within 24 hours.",
};

export function AgentDetailClient({ agent, listing, version, versionHistory }: AgentDetailClientProps) {
  const router = useRouter();
  const { getToken, isSignedIn } = useClerkAuth();
  const [state, setState] = useState<AgentState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const content = AGENT_OUTCOMES[agent.slug] ?? DEFAULT_OUTCOME;
  const priceCents = version?.price_cents ?? listing?.price_cents ?? 0;
  const priceLabel = priceCents === 0 ? "Free" : `$${(priceCents / 100).toFixed(2)}`;
  const isBeta = listing?.is_beta ?? false;
  const isOfficial = listing?.is_official ?? false;
  const billingModel = listing?.billing_model ?? "one_time";

  const loadState = useCallback(async () => {
    if (!isSignedIn) {
      setState(priceCents === 0 ? "install" : "buy");
      return;
    }
    try {
      const token = await getToken?.();
      const res = await fetch(`/api/marketplace/agents/${agent.id}/state`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setState(data.state as AgentState);
      } else {
        setState(priceCents === 0 ? "install" : "buy");
      }
    } catch {
      setState(priceCents === 0 ? "install" : "buy");
    }
  }, [agent.id, isSignedIn, getToken, priceCents]);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const handleBuy = async () => {
    if (!isSignedIn) {
      router.push("/sign-in?redirect_url=" + encodeURIComponent(`/agents/${agent.slug}`));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const token = await getToken?.();
      const res = await fetch(`/api/marketplace/agents/${agent.id}/checkout`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Checkout failed");
        setBusy(false);
      }
    } catch {
      setError("Network error during checkout");
      setBusy(false);
    }
  };

  const handleInstall = async () => {
    if (!isSignedIn) {
      router.push("/sign-in?redirect_url=" + encodeURIComponent(`/agents/${agent.slug}`));
      return;
    }
    setBusy(true);
    try {
      const token = await getToken?.();
      const res = await fetch(`/api/marketplace/agents/${agent.id}/install`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        setState("open");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Install failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = () => {
    router.push(`/studio?agent=${agent.slug}`);
  };

  const handleStartLaunch = () => {
    router.push(`/start?agent=${agent.slug}`);
  };

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-4xl px-6 py-12">
        {/* Header */}
        <div className="mb-8 border-b border-neutral-800 pb-8">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <Link href="/agents" className="text-neutral-500 hover:text-neutral-300">Agents</Link>
            <span className="text-neutral-700">/</span>
            <span className="text-neutral-300">{agent.name}</span>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-3xl font-black text-white">{agent.name}</h1>
              <p className="mt-2 text-lg text-neutral-400">{content.outcome}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                {isOfficial && (
                  <span className="rounded-md bg-cyan-400/10 px-2 py-1 font-bold text-cyan-300">Official</span>
                )}
                {isBeta && (
                  <span className="rounded-md bg-amber-400/10 px-2 py-1 font-bold text-amber-300">Beta</span>
                )}
                <span className="rounded-md bg-neutral-800 px-2 py-1 font-bold capitalize text-neutral-300">{agent.category}</span>
                {version && (
                  <span className="rounded-md bg-neutral-800 px-2 py-1 font-bold text-neutral-400">v{version.version}</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black text-white">{priceLabel}</div>
              <div className="text-xs text-neutral-500">{billingModel === "one_time" ? "one-time" : billingModel}</div>
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Action button */}
        <div className="mb-8 flex flex-wrap gap-3">
          {state === "buy" && (
            <button
              onClick={handleBuy}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-6 py-3 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Buy for {priceLabel}
            </button>
          )}
          {state === "install" && (
            <button
              onClick={handleInstall}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-3 text-sm font-bold text-white hover:bg-green-500 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Install Free
            </button>
          )}
          {state === "open" && (
            <>
              <button
                onClick={handleOpen}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-6 py-3 text-sm font-bold text-white hover:bg-cyan-500"
              >
                <ArrowRight className="h-4 w-4" />
                Open in Studio
              </button>
              {agent.slug === "litt-launch-agent" && (
                <button
                  onClick={handleStartLaunch}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-6 py-3 text-sm font-bold text-neutral-300 hover:bg-neutral-800"
                >
                  <Rocket className="h-4 w-4" />
                  Start a Launch
                </button>
              )}
            </>
          )}
          {state === "disabled" && (
            <button
              onClick={handleInstall}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-6 py-3 text-sm font-bold text-neutral-300 hover:bg-neutral-800"
            >
              Enable
            </button>
          )}
          {state === "loading" && (
            <div className="inline-flex items-center gap-2 rounded-lg bg-neutral-800 px-6 py-3 text-sm font-bold text-neutral-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading...
            </div>
          )}
        </div>

        {/* Who it's for */}
        <Section title="Who it's for" icon={<Sparkles className="h-4 w-4" />}>
          <p className="text-sm text-neutral-300">{content.targetCustomer}</p>
        </Section>

        {/* What it creates */}
        <Section title="What it creates" icon={<FileCode className="h-4 w-4" />}>
          <ul className="space-y-2">
            {content.deliverables.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-neutral-300">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
                {d}
              </li>
            ))}
          </ul>
        </Section>

        {/* Example input and result */}
        <Section title="Example" icon={<Eye className="h-4 w-4" />}>
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-neutral-500">Input</div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-300">
                {content.exampleInput}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-neutral-500">Result</div>
              <div className="rounded-lg border border-green-900/50 bg-green-950/20 p-3 text-sm text-green-300">
                {content.exampleResult}
              </div>
            </div>
          </div>
        </Section>

        {/* Tools and permissions */}
        <Section title="Tools and permissions" icon={<Wrench className="h-4 w-4" />}>
          <div className="space-y-2">
            {content.tools.map((tool, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-sm">
                <span className="text-neutral-300">{tool.name}</span>
                {tool.requiresApproval ? (
                  <span className="flex items-center gap-1 text-xs text-amber-400">
                    <Shield className="h-3 w-3" />
                    Requires approval
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-green-400">
                    <CheckCircle className="h-3 w-3" />
                    Auto
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* Approval boundaries */}
        <Section title="Approval boundaries" icon={<Shield className="h-4 w-4" />}>
          <ul className="space-y-2">
            {content.approvalBoundaries.map((b, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-neutral-300">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                {b}
              </li>
            ))}
          </ul>
        </Section>

        {/* Typical completion range */}
        <Section title="Typical completion" icon={<Clock className="h-4 w-4" />}>
          <p className="text-sm text-neutral-300">{content.typicalRange}</p>
        </Section>

        {/* Pricing detail */}
        <Section title="Pricing" icon={<Rocket className="h-4 w-4" />}>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white">{priceLabel}</span>
            <span className="text-sm text-neutral-500">
              {billingModel === "one_time" ? "one-time purchase" : billingModel}
            </span>
          </div>
          {version && (
            <p className="mt-1 text-xs text-neutral-500">
              Model: {version.model} · Currency: {version.currency?.toUpperCase() ?? "USD"}
            </p>
          )}
        </Section>

        {/* Refund and support */}
        <Section title="Refund and support" icon={<Check className="h-4 w-4" />}>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-neutral-500">Refund terms</div>
              <p className="text-sm text-neutral-300">{content.refundTerms}</p>
            </div>
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-neutral-500">Support policy</div>
              <p className="text-sm text-neutral-300">{content.supportPolicy}</p>
            </div>
          </div>
        </Section>

        {/* Version history */}
        {versionHistory.length > 0 && (
          <Section title="Version history" icon={<GitBranch className="h-4 w-4" />}>
            <div className="space-y-2">
              {versionHistory.map((v) => (
                <div key={v.id} className="flex items-center justify-between rounded-lg border border-neutral-800 bg-neutral-900 p-2 text-sm">
                  <span className="font-bold text-neutral-300">v{v.version}</span>
                  <span className="text-xs text-neutral-500">
                    {new Date(v.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Required connections */}
        {listing?.required_connections && listing.required_connections.length > 0 && (
          <Section title="Required connections" icon={<Wrench className="h-4 w-4" />}>
            <div className="flex flex-wrap gap-2">
              {listing.required_connections.map((conn) => (
                <span key={conn} className="rounded-md bg-neutral-800 px-2 py-1 text-xs font-bold text-neutral-300">
                  {conn}
                </span>
              ))}
            </div>
          </Section>
        )}

        {/* Bottom CTA */}
        <div className="mt-12 border-t border-neutral-800 pt-8">
          <div className="flex flex-wrap gap-3">
            {state === "buy" && (
              <button
                onClick={handleBuy}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-6 py-3 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                Buy {agent.name} for {priceLabel}
              </button>
            )}
            {state === "open" && agent.slug === "litt-launch-agent" && (
              <button
                onClick={handleStartLaunch}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-6 py-3 text-sm font-bold text-white hover:bg-cyan-500"
              >
                <Rocket className="h-4 w-4" />
                Start a Launch
              </button>
            )}
            <Link
              href="/trust"
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-6 py-3 text-sm font-bold text-neutral-300 hover:bg-neutral-800"
            >
              <Shield className="h-4 w-4" />
              Read trust & safety
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-neutral-400">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}
