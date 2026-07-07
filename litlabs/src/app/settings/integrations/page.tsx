"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Lock,
  CreditCard,
  Mail,
  Calendar,
  ShoppingBag,
  MessageSquare,
  FileText,
  Code,
  Database,
  Router,
  Volume2,
  ExternalLink,
  Eye,
  EyeOff,
  Save,
  Loader2,
} from "lucide-react";

type IntegrationStatus = "connected" | "not_connected" | "error" | "checking";

interface Integration {
  id: string;
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  status: IntegrationStatus;
  lastChecked: string | null;
  permissions: string[];
  missing: string[];
  nextAction: string;
  setupSteps: string[];
}

const INITIAL_INTEGRATIONS: Integration[] = [
  {
    id: "stripe",
    name: "Stripe",
    description: "Payments, checkout, and LiTBit coin packs.",
    icon: CreditCard,
    status: "not_connected",
    lastChecked: null,
    permissions: [],
    missing: ["Secret key", "Publishable key", "Webhook secret"],
    nextAction: "Connect Stripe in the secure drawer",
    setupSteps: [
      "Save STRIPE_SECRET_KEY (sk_test_... or sk_live_...)",
      "Save NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY (pk_...)",
      "Save STRIPE_WEBHOOK_SECRET (whsec_...)",
      "Create Stripe products/prices for LiTBit packs",
      "Add /api/stripe/webhook route",
      "Verify account endpoint returns a valid account",
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "Send notifications and read summaries.",
    icon: Mail,
    status: "not_connected",
    lastChecked: null,
    permissions: [],
    missing: ["OAuth client", "Refresh token"],
    nextAction: "Connect Gmail via Google OAuth",
    setupSteps: [
      "Create Google Cloud OAuth credentials",
      "Enable Gmail API",
      "Save client ID and refresh token",
      "Test send from aiOS",
    ],
  },
  {
    id: "calendar",
    name: "Google Calendar",
    description: "Schedule missions and content drops.",
    icon: Calendar,
    status: "not_connected",
    lastChecked: null,
    permissions: [],
    missing: ["OAuth scope", "Calendar ID"],
    nextAction: "Connect Calendar via Google OAuth",
    setupSteps: [
      "Enable Google Calendar API",
      "Add calendar.readonly and calendar.events scope",
      "Save default calendar ID",
    ],
  },
  {
    id: "shopify",
    name: "Shopify",
    description: "E-commerce products and orders.",
    icon: ShoppingBag,
    status: "not_connected",
    lastChecked: null,
    permissions: [],
    missing: ["Store domain", "Admin API token"],
    nextAction: "Add Shopify store and API token",
    setupSteps: [
      "Create a custom app in Shopify",
      "Grant products and orders access",
      "Save SHOPIFY_STORE and SHOPIFY_ACCESS_TOKEN",
    ],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Team alerts and agent notifications.",
    icon: MessageSquare,
    status: "not_connected",
    lastChecked: null,
    permissions: [],
    missing: ["Webhook URL"],
    nextAction: "Add a Slack incoming webhook",
    setupSteps: [
      "Create an incoming webhook in Slack",
      "Save SLACK_WEBHOOK_URL",
      "Send test message from aiOS",
    ],
  },
  {
    id: "notion",
    name: "Notion",
    description: "Docs, wikis, and project notes.",
    icon: FileText,
    status: "not_connected",
    lastChecked: null,
    permissions: [],
    missing: ["Internal integration token"],
    nextAction: "Connect Notion internal integration",
    setupSteps: [
      "Create an internal integration in Notion",
      "Share a database with the integration",
      "Save NOTION_TOKEN",
    ],
  },
  {
    id: "github",
    name: "GitHub",
    description: "Repos, commits, and code actions.",
    icon: Code,
    status: "not_connected",
    lastChecked: null,
    permissions: [],
    missing: ["Personal access token"],
    nextAction: "Add a GitHub personal access token",
    setupSteps: [
      "Create a fine-grained personal access token",
      "Grant repo and contents access",
      "Save GITHUB_TOKEN",
    ],
  },
  {
    id: "supabase",
    name: "Supabase",
    description: "Database, auth, and storage backend.",
    icon: Database,
    status: "checking",
    lastChecked: null,
    permissions: ["Project configured"],
    missing: ["Verify service role key"],
    nextAction: "Verify Supabase env vars",
    setupSteps: [
      "Confirm NEXT_PUBLIC_SUPABASE_URL",
      "Confirm NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "Confirm SUPABASE_SERVICE_ROLE_KEY",
      "Run /api/admin/snapshot test",
    ],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "LLM routing and model failover.",
    icon: Router,
    status: "checking",
    lastChecked: null,
    permissions: [],
    missing: ["API key"],
    nextAction: "Add OpenRouter API key in BYOK settings",
    setupSteps: [
      "Get an API key from openrouter.ai",
      "Save it in Settings → BYOK",
      "Test a chat completion",
    ],
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Premium voice synthesis.",
    icon: Volume2,
    status: "not_connected",
    lastChecked: null,
    permissions: [],
    missing: ["API key"],
    nextAction: "Add ElevenLabs API key in BYOK settings",
    setupSteps: [
      "Get an API key from elevenlabs.io",
      "Save it in Settings → BYOK",
      "Test voice synthesis",
    ],
  },
];

export default function IntegrationsPage() {
  const { resolvedColors: T } = useTheme();
  const [integrations, setIntegrations] = useState<Integration[]>(INITIAL_INTEGRATIONS);
  const [stripeOpen, setStripeOpen] = useState(false);
  const [stripeKey, setStripeKey] = useState("");
  const [stripePublishable, setStripePublishable] = useState("");
  const [stripeWebhook, setStripeWebhook] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [stripeLoading, setStripeLoading] = useState(false);
  const [stripeMessage, setStripeMessage] = useState<string | null>(null);

  const cardStyle: React.CSSProperties = {
    backgroundColor: T.boxBg,
    border: `1px solid ${T.borderColor}30`,
  };

  const inputStyle: React.CSSProperties = {
    backgroundColor: T.bgColor,
    borderColor: `${T.borderColor}40`,
    color: T.textColor,
  };

  const checkSupabase = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/snapshot");
      const ok = res.ok;
      setIntegrations((prev) =>
        prev.map((i) =>
          i.id === "supabase"
            ? {
                ...i,
                status: ok ? "connected" : "error",
                lastChecked: new Date().toLocaleTimeString(),
                permissions: ok ? ["Project configured", "Admin API reachable"] : ["Project configured"],
                missing: ok ? [] : ["Verify service role key"],
                nextAction: ok ? "Supabase looks healthy" : "Check SUPABASE_SERVICE_ROLE_KEY",
              }
            : i,
        ),
      );
    } catch {
      setIntegrations((prev) =>
        prev.map((i) =>
          i.id === "supabase"
            ? {
                ...i,
                status: "error",
                lastChecked: new Date().toLocaleTimeString(),
                missing: ["Verify service role key"],
                nextAction: "Check SUPABASE_SERVICE_ROLE_KEY",
              }
            : i,
        ),
      );
    }
  }, []);

  useEffect(() => {
    checkSupabase();
  }, [checkSupabase]);

  const runAllChecks = () => {
    setIntegrations((prev) =>
      prev.map((i) => (i.status !== "not_connected" ? { ...i, status: "checking" as IntegrationStatus } : i)),
    );
    checkSupabase();
    // Stripe status is derived from local storage only in this MVP
    const savedStripe = typeof window !== "undefined" ? localStorage.getItem("litlabs-stripe-secret") : null;
    setIntegrations((prev) =>
      prev.map((i) =>
        i.id === "stripe"
          ? {
              ...i,
              status: savedStripe ? "connected" : "not_connected",
              lastChecked: new Date().toLocaleTimeString(),
              permissions: savedStripe ? ["Secret key saved"] : [],
              missing: savedStripe ? ["Publishable key", "Webhook secret", "Products/prices", "Webhook route"] : i.missing,
              nextAction: savedStripe ? "Add publishable key and webhook secret" : "Connect Stripe in the secure drawer",
            }
          : i,
      ),
    );
  };

  const saveStripe = async () => {
    setStripeLoading(true);
    setStripeMessage(null);
    try {
      // In a real app, send to a backend that encrypts and validates the key.
      // This MVP validates the format and stores a marker locally.
      const trimmed = stripeKey.trim();
      if (!trimmed.startsWith("sk_test_") && !trimmed.startsWith("sk_live_")) {
        throw new Error("Stripe secret key must start with sk_test_ or sk_live_");
      }
      if (!stripePublishable.trim().startsWith("pk_")) {
        throw new Error("Publishable key must start with pk_");
      }
      if (typeof window !== "undefined") {
        localStorage.setItem("litlabs-stripe-secret", "saved");
        localStorage.setItem("litlabs-stripe-publishable", stripePublishable.trim());
        localStorage.setItem("litlabs-stripe-webhook", stripeWebhook.trim());
      }
      setStripeMessage("Stripe keys saved. Run a real /api/stripe/verify from your backend to finish.");
      setIntegrations((prev) =>
        prev.map((i) =>
          i.id === "stripe"
            ? {
                ...i,
                status: "connected",
                lastChecked: new Date().toLocaleTimeString(),
                permissions: ["Secret key saved", "Publishable key saved", stripeWebhook ? "Webhook secret saved" : "Webhook secret missing"],
                missing: ["Products/prices", "Webhook route", "Verified account endpoint"],
                nextAction: "Create Stripe products and verify account endpoint",
              }
            : i,
        ),
      );
    } catch (e) {
      setStripeMessage(e instanceof Error ? e.message : "Failed to save Stripe settings");
    } finally {
      setStripeLoading(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-6">
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/settings"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition hover:bg-white/5"
            style={{ color: T.textMuted }}
          >
            <ArrowLeft size={14} /> Settings
          </Link>
          <h1 className="text-xl font-black" style={{ color: T.headerColor }}>
            Integration Health
          </h1>
        </div>

        <div className="mb-6 rounded-2xl border p-4 sm:p-6" style={cardStyle}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-black" style={{ color: T.headerColor }}>
                Connected Services
              </h2>
              <p className="text-xs mt-1" style={{ color: T.textMuted }}>
                aiOS uses these integrations to build, ship, and monetize your projects. Never paste secret keys in chat.
              </p>
            </div>
            <button
              onClick={runAllChecks}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition hover:opacity-90"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              <RefreshCw size={14} /> Run Checks
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {integrations.map((integration) => {
            const Icon = integration.icon;
            const statusColor =
              integration.status === "connected"
                ? "#22c55e"
                : integration.status === "error"
                  ? "#ef4444"
                  : integration.status === "checking"
                    ? "#f59e0b"
                    : "#94a3b8";
            const StatusIcon =
              integration.status === "connected"
                ? CheckCircle2
                : integration.status === "error"
                  ? XCircle
                  : integration.status === "checking"
                    ? RefreshCw
                    : AlertTriangle;
            return (
              <div key={integration.id} className="rounded-2xl border p-4" style={cardStyle}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-xl"
                      style={{ backgroundColor: `${T.accentColor}15`, color: T.accentColor }}
                    >
                      <Icon size={20} />
                    </div>
                    <div>
                      <div className="text-sm font-black">{integration.name}</div>
                      <div className="text-[10px]" style={{ color: T.textMuted }}>
                        {integration.description}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-bold" style={{ color: statusColor }}>
                    <StatusIcon size={12} className={integration.status === "checking" ? "animate-spin" : ""} />
                    {integration.status.replace("_", " ")}
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {integration.permissions.length > 0 && (
                    <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#22c55e" }}>
                      Ready
                    </div>
                  )}
                  <ul className="space-y-1">
                    {integration.permissions.map((p) => (
                      <li key={p} className="flex items-center gap-1.5 text-xs" style={{ color: T.textMuted }}>
                        <CheckCircle2 size={10} style={{ color: "#22c55e" }} /> {p}
                      </li>
                    ))}
                  </ul>

                  {integration.missing.length > 0 && (
                    <>
                      <div className="text-[10px] font-bold uppercase tracking-wider pt-2" style={{ color: "#f59e0b" }}>
                        Missing
                      </div>
                      <ul className="space-y-1">
                        {integration.missing.map((m) => (
                          <li key={m} className="flex items-center gap-1.5 text-xs" style={{ color: T.textMuted }}>
                            <AlertTriangle size={10} style={{ color: "#f59e0b" }} /> {m}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                <div className="mt-4 rounded-lg border p-2.5" style={{ backgroundColor: `${T.bgColor}60`, borderColor: `${T.borderColor}20` }}>
                  <div className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: T.textMuted }}>
                    Next Action
                  </div>
                  <div className="text-xs" style={{ color: T.textColor }}>
                    {integration.nextAction}
                  </div>
                </div>

                {integration.id === "stripe" && (
                  <button
                    onClick={() => setStripeOpen(true)}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border py-2 text-xs font-bold transition hover:bg-white/5"
                    style={{ borderColor: `${T.borderColor}40`, color: T.accentColor }}
                  >
                    <Lock size={12} /> Open Secure Stripe Connector
                  </button>
                )}

                {integration.lastChecked && (
                  <div className="mt-2 text-[10px] text-right" style={{ color: T.textMuted }}>
                    Last checked: {integration.lastChecked}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Stripe secure connector modal */}
      {stripeOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ backgroundColor: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
        >
          <div className="w-full max-w-md rounded-2xl border p-5" style={cardStyle}>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Lock size={16} style={{ color: T.accentColor }} />
                <h3 className="text-lg font-black" style={{ color: T.headerColor }}>
                  Stripe Connector
                </h3>
              </div>
              <button onClick={() => setStripeOpen(false)} style={{ color: T.textMuted }}>
                ×
              </button>
            </div>

            <p className="mb-4 text-xs" style={{ color: T.textMuted }}>
              Keys are validated locally and should be saved by your backend in production. Never paste secrets in chat.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>
                  Secret Key
                </label>
                <div className="relative mt-1">
                  <input
                    type={showSecret ? "text" : "password"}
                    value={stripeKey}
                    onChange={(e) => setStripeKey(e.target.value)}
                    placeholder="sk_test_... or sk_live_..."
                    className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
                    style={inputStyle}
                  />
                  <button
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    style={{ color: T.textMuted }}
                  >
                    {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>
                  Publishable Key
                </label>
                <input
                  type="text"
                  value={stripePublishable}
                  onChange={(e) => setStripePublishable(e.target.value)}
                  placeholder="pk_test_... or pk_live_..."
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>
                  Webhook Secret
                </label>
                <input
                  type="text"
                  value={stripeWebhook}
                  onChange={(e) => setStripeWebhook(e.target.value)}
                  placeholder="whsec_..."
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none"
                  style={inputStyle}
                />
              </div>
            </div>

            {stripeMessage && (
              <div
                className="mt-3 rounded-lg border p-2 text-xs"
                style={{
                  backgroundColor: stripeMessage.includes("saved") ? "#22c55e10" : "#ef444410",
                  borderColor: stripeMessage.includes("saved") ? "#22c55e40" : "#ef444440",
                  color: stripeMessage.includes("saved") ? "#22c55e" : "#ef4444",
                }}
              >
                {stripeMessage}
              </div>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={saveStripe}
                disabled={stripeLoading || !stripeKey.trim() || !stripePublishable.trim()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs font-bold transition disabled:opacity-50"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}
              >
                {stripeLoading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save & Validate
              </button>
              <a
                href="https://dashboard.stripe.com/"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-bold transition hover:bg-white/5"
                style={{ borderColor: `${T.borderColor}40`, color: T.textMuted }}
              >
                <ExternalLink size={12} /> Dashboard
              </a>
            </div>

            <div className="mt-4 rounded-lg border p-3" style={{ backgroundColor: `${T.bgColor}60`, borderColor: `${T.borderColor}20` }}>
              <div className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: T.textMuted }}>
                Checklist
              </div>
              <ul className="space-y-1">
                {INITIAL_INTEGRATIONS.find((i) => i.id === "stripe")!.setupSteps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-[11px]" style={{ color: T.textMuted }}>
                    <span className="font-black" style={{ color: T.accentColor }}>
                      {idx + 1}.
                    </span>
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
