import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { getAgentDefinition, PREMIUM_AGENTS } from "@/lib/agent-registry";
import { buildMetadata } from "@/lib/seo";
import { AgentDetailClient } from "./AgentDetailClient";
import "@/app/public-pages-tlc.css";

export const dynamicParams = true;
/** Registry agent colors are pastel hues tuned for dark surfaces; as TEXT
 *  on the light theme they fall to 1.5-3.3:1 contrast. Derive a
 *  light-legible variant (same hue scaled toward black) for text uses
 *  only — solid fills keep the original color, where black bold text
 *  carries the contrast. The registry is shared with Studio and is not
 *  presentation-local, so the variant is derived here instead of editing
 *  the data (the showcase lane darkened its hues the same way). */
function legibleOnLight(hex: string): string {
  const raw = hex.replace("#", "");
  const n = parseInt(raw, 16);
  if (Number.isNaN(n) || raw.length !== 6) return hex;
  const scale = (v: number) => Math.round(v * 0.5);
  const r = scale((n >> 16) & 255);
  const g = scale((n >> 8) & 255);
  const b = scale(n & 255);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}


export function generateStaticParams() {
  return PREMIUM_AGENTS.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const agent = getAgentDefinition(slug);
  if (!agent || !agent.marketplaceVisible) return buildMetadata({ title: "Agent Not Found", path: "/marketplace" });
  return buildMetadata({
    title: `${agent.name} — AI Agent`,
    description: agent.description,
    path: `/marketplace/agents/${agent.slug}`,
    index: true,
  });
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const agent = getAgentDefinition(slug);

  if (!agent || !agent.marketplaceVisible || !agent.enabled) {
    notFound();
  }

  const planLabel =
    agent.minimumPlan === "creator_lite"
      ? "Creator Lite"
      : agent.minimumPlan === "creator_beta"
        ? "Creator"
        : agent.minimumPlan === "pro_builder_beta"
          ? "Pro Builder"
          : agent.minimumPlan === "founder"
            ? "Founding Member"
            : "Free";

  const planPrice =
    agent.minimumPlan === "creator_lite"
      ? "$9.99/month"
      : agent.minimumPlan === "creator_beta"
        ? "$19.99/month"
        : agent.minimumPlan === "pro_builder_beta"
          ? "$39/month"
        : agent.minimumPlan === "founder"
          ? "$149 one-time"
          : "Free";

  return (
    <div className="litt-public-light min-h-screen bg-transparent text-[#0e1510]">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-[#cfdec4]/70">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${agent.color}, transparent)`,
          }}
        />
        <div className="relative mx-auto max-w-4xl px-6 py-16">
          <Link
            href="/marketplace"
            className="mb-6 inline-flex items-center gap-1.5 text-xs font-bold text-[#0e1510]/50 transition hover:text-[#0e1510]/80"
          >
            ← Back to Marketplace
          </Link>

          <div className="flex items-start gap-4">
            <div
              className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl"
              style={{
                background: agent.color + "15",
                border: `1px solid ${agent.color}30`,
              }}
            >
              <span style={{ color: legibleOnLight(agent.color) }}>{agent.tag[0]}</span>
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-black tracking-tight">{agent.name}</h1>
              <p className="mt-1 text-sm font-bold uppercase tracking-wide text-[#0e1510]/50">
                {agent.role}
              </p>
            </div>
          </div>

          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#37463a]">
            {agent.description}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span
              className="rounded-lg px-3 py-1.5 text-xs font-black"
              style={{ background: agent.color + "15", color: legibleOnLight(agent.color) }}
            >
              {planLabel}
            </span>
            <span className="text-xs font-bold text-[#0e1510]/50">{planPrice}</span>
            <span className="text-xs text-[#0e1510]/35">·</span>
            <span className="text-xs font-bold text-[#0e1510]/50">
              {agent.cost.perRun} credits/run
            </span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-4xl px-6 py-12">
        <div className="grid gap-8 md:grid-cols-[1fr_320px]">
          {/* Main column */}
          <div className="space-y-8">
            {/* Capabilities */}
            <section>
              <h2 className="mb-4 text-lg font-black">Capabilities</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {agent.domains.map((domain) => (
                  <div
                    key={domain}
                    className="flex items-center gap-2 rounded-xl border border-[#cfdec4]/70 bg-[#f2f7ea] px-3 py-2.5"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: agent.color }}
                    />
                    <span className="text-xs font-medium capitalize text-[#0e1510]/75">
                      {domain.replace(/-/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* Starter Actions */}
            <section>
              <h2 className="mb-4 text-lg font-black">Try These First</h2>
              <div className="space-y-2">
                {agent.starterActions.map((action) => (
                  <Link
                    key={action.label}
                    href={`/studio?agent=${agent.slug}&prompt=${encodeURIComponent(action.prompt)}`}
                    className="flex items-center justify-between rounded-xl border border-[#cfdec4]/70 bg-[#f2f7ea] px-4 py-3 transition hover:border-[#cfdec4] hover:bg-[#e9f2dc]"
                  >
                    <span className="text-sm font-bold text-[#0e1510]/85">
                      {action.label}
                    </span>
                    <span className="text-xs text-[#0e1510]/35">→</span>
                  </Link>
                ))}
              </div>
            </section>

            {/* Personality */}
            <section>
              <h2 className="mb-4 text-lg font-black">Personality</h2>
              <p className="text-sm leading-relaxed text-[#0e1510]/60">
                {agent.personality}
              </p>
            </section>
          </div>

          {/* Sidebar — action card */}
          <aside>
            <div className="sticky top-6 rounded-2xl border border-[#cfdec4] bg-white p-6 shadow-[0_20px_54px_rgba(14,60,26,0.08)]">
              <div className="text-center">
                <div
                  className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl text-2xl"
                  style={{
                    background: agent.color + "15",
                    border: `1px solid ${agent.color}30`,
                  }}
                >
                  <span style={{ color: legibleOnLight(agent.color) }}>{agent.tag[0]}</span>
                </div>
                <h3 className="text-lg font-black">{agent.name}</h3>
                <p className="mt-1 text-xs text-[#0e1510]/50">{planLabel}</p>
                <p className="text-xs font-bold text-[#0e1510]/65">{planPrice}</p>
              </div>

              <AgentDetailClient
                slug={agent.slug}
                name={agent.name}
                color={agent.color}
                minimumPlan={agent.minimumPlan}
              />

              <div className="mt-4 space-y-2 border-t border-[#cfdec4]/70 pt-4">
                <div className="flex justify-between text-xs">
                  <span className="text-[#0e1510]/50">Version</span>
                  <span className="font-bold text-[#0e1510]/70">{agent.version}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#0e1510]/50">Cost per run</span>
                  <span className="font-bold text-[#0e1510]/70">
                    {agent.cost.perRun === 0 ? "Free" : `${agent.cost.perRun} credits`}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-[#0e1510]/50">Billing</span>
                  <span className="font-bold capitalize text-[#0e1510]/70">
                    {agent.billingModel.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
