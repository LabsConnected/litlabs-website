import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Bot,
  Briefcase,
  Compass,
  CreditCard,
  Images,
  Terminal,
} from "lucide-react";
import { MarketingFrame } from "@/components/ProductPageFrame";
import { buildMetadata } from "@/lib/seo";
import "@/app/public-pages-tlc.css";

export const metadata: Metadata = buildMetadata({
  title: "Resources",
  description:
    "Guides, demos, plans, and help for getting the most out of LiTTree LabStudios and LiTT.",
  path: "/resources",
  index: true,
});

const RESOURCE_GROUPS = [
  {
    title: "Documentation",
    copy: "Start here when you want the how-to path for Studio, builds, preview, deploy, CLI, marketplace, and safety.",
    icon: BookOpen,
    links: [
      { href: "/docs", label: "Docs home" },
      { href: "/docs/quick-start", label: "Quick start" },
      { href: "/docs/studio", label: "Studio guide" },
      { href: "/docs/building", label: "Building projects" },
      { href: "/docs/preview-deploy", label: "Preview & deploy" },
      { href: "/docs/cli", label: "CLI reference" },
      { href: "/docs/marketplace", label: "Marketplace" },
      { href: "/docs/safety", label: "Safety & approvals" },
      { href: "/docs/troubleshooting", label: "Troubleshooting" },
    ],
  },
  {
    title: "See it work",
    copy: "Walk through product demos, public creations, community work, and the agent marketplace before you start.",
    icon: Images,
    links: [
      { href: "/showcase", label: "Showcase demos" },
      { href: "/gallery", label: "Community gallery" },
      { href: "/marketplace", label: "Agent marketplace" },
      { href: "/discover", label: "Discover" },
      { href: "/agents", label: "Agent catalog" },
    ],
  },
  {
    title: "Plans & help",
    copy: "Compare plans, install the CLI, read about the company, or ask for scoped help with a project.",
    icon: Compass,
    links: [
      { href: "/pricing", label: "Pricing" },
      { href: "/cli", label: "LiTT CLI" },
      { href: "/about", label: "About LiTTree" },
      { href: "/hire", label: "Hire LiTTree" },
    ],
  },
];

export default function ResourcesPage() {
  return (
    <div className="litt-public-light min-h-screen bg-white pt-[68px] text-[#0e1510] selection:bg-[#8fd14f]/60">
      <section className="px-5 pb-14 pt-16 lg:px-10">
        <MarketingFrame>
          <div className="max-w-3xl">
            <div className="litt-eyebrow">Resources</div>
            <h1 className="mt-5 text-4xl font-black leading-[0.95] tracking-[-0.045em] sm:text-5xl lg:text-6xl">
              Everything you need to <span className="litt-gradient-text">get unstuck and keep building.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[#37463a] sm:text-lg sm:leading-8">
              Documentation for the how-to, demos for the what-it-looks-like,
              and direct paths to plans, CLI, company info, and scoped help.
            </p>
          </div>
        </MarketingFrame>
      </section>

      <section className="px-5 py-14 lg:px-10">
        <MarketingFrame>
          <div className="grid gap-6 lg:grid-cols-3">
            {RESOURCE_GROUPS.map((group) => {
              const Icon = group.icon;
              return (
                <article
                  key={group.title}
                  className="flex flex-col rounded-2xl border border-[#cfdec4] bg-white p-6 shadow-[0_20px_54px_rgba(14,60,26,0.08)]"
                >
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-[#0c5a26]">
                    <Icon size={20} />
                  </div>
                  <h2 className="text-xl font-black tracking-tight">{group.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-[#0e1510]/60">{group.copy}</p>
                  <div className="mt-6 space-y-2">
                    {group.links.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="group flex items-center justify-between rounded-xl border border-[#cfdec4] bg-[#f8fbf3] px-4 py-3 text-sm font-bold text-[#0e1510]/75 transition hover:border-accent/40 hover:bg-[#f2f7ea] hover:text-[#0c5a26]"
                      >
                        {link.label}
                        <ArrowRight size={14} className="text-[#63745f] transition group-hover:translate-x-0.5 group-hover:text-[#0c5a26]" />
                      </Link>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mt-10 flex flex-col items-start justify-between gap-4 rounded-2xl border border-accent/20 bg-[#f2f7ea] p-6 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2 text-sm font-black text-[#0c5a26]">
                <Terminal size={16} /> Need a person, not a page?
              </div>
              <p className="mt-1 text-sm text-[#0e1510]/60">
                Send a scoped inquiry and we will confirm fit, scope, and pricing before work starts.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/hire"
                className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-on-accent transition hover:bg-accent-strong"
              >
                <Briefcase size={15} /> Hire LiTTree
              </Link>
              <Link
                href="/pricing"
                className="inline-flex items-center gap-2 rounded-xl border border-[#0c5a26]/25 px-4 py-2.5 text-sm font-bold text-[#0c5a26] transition hover:bg-white"
              >
                <CreditCard size={15} /> Compare plans
              </Link>
              <Link
                href="/docs"
                className="inline-flex items-center gap-2 rounded-xl border border-[#0c5a26]/25 px-4 py-2.5 text-sm font-bold text-[#0c5a26] transition hover:bg-white"
              >
                <Bot size={15} /> Open docs
              </Link>
            </div>
          </div>
        </MarketingFrame>
      </section>
    </div>
  );
}
