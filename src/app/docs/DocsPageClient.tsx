"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import {
  ArrowRight,
  Bot,
  GalleryVerticalEnd,
  Workflow,
  WandSparkles,
  Mail,
} from "lucide-react";

const DOC_SECTIONS = [
  {
    icon: WandSparkles,
    title: "Start in Studio",
    body: "Use Studio as the main workspace for image, audio, video, agent chat, flow, gallery, and external space tools.",
    href: "/studio",
  },
  {
    icon: Bot,
    title: "Install Agents",
    body: "Browse specialist agents for code, content, research, analytics, music, design, and orchestration.",
    href: "/marketplace",
  },
  {
    icon: Workflow,
    title: "Build Flows",
    body: "Chain prompts and media tasks into repeatable workflows for creative production and publishing.",
    href: "/flow",
  },
  {
    icon: GalleryVerticalEnd,
    title: "Save Output",
    body: "Keep generated work in the gallery, reuse it in your profile, and prepare it for community sharing.",
    href: "/gallery",
  },
];

export default function DocsPageClient() {
  const { resolvedColors: T } = useTheme();
  const searchParams = useSearchParams();
  const topic = searchParams.get("topic");
  const isSupport = topic === "support";

  return (
    <main
      className="min-h-dvh px-4 py-16"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      <div className="mx-auto max-w-5xl">
        <div className="mb-10">
          <p
            className="mb-3 text-xs font-bold uppercase tracking-[0.28em]"
            style={{ color: T.accentColor }}
          >
            Documentation
          </p>
          <h1
            className="mb-4 text-4xl font-black tracking-tight md:text-6xl"
            style={{ color: T.headerColor }}
          >
            Build, automate, publish.
          </h1>
          <p
            className="max-w-2xl text-base leading-relaxed opacity-65 md:text-lg"
            style={{ color: T.textColor }}
          >
            LiTTree-LabStudios is organized around one loop: choose an agent,
            create in Studio, automate the repeatable parts, and ship the
            result to your audience or marketplace.
          </p>
        </div>

        {isSupport && (
          <section
            className="mb-10 rounded-2xl border p-6"
            style={{
              backgroundColor: T.boxBg,
              borderColor: T.borderColor,
            }}
          >
            <h2
              className="mb-2 text-lg font-black"
              style={{ color: T.headerColor }}
            >
              Support
            </h2>
            <p className="mb-4 text-sm leading-relaxed opacity-70">
              Need help? Reach out and we&apos;ll get back to you as soon as
              possible.
            </p>
            <a
              href="mailto:support@litlabs.net"
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold"
              style={{
                backgroundColor: T.accentColor,
                color: T.bgColor,
              }}
            >
              <Mail size={14} />
              Email support@litlabs.net
            </a>
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {DOC_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.title}
                href={section.href}
                aria-label={`Open ${section.title}`}
                className="group rounded-2xl border p-6 transition-all hover:-translate-y-1"
                style={{
                  backgroundColor: T.boxBg,
                  borderColor: T.borderColor,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = `${T.textColor}08`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = T.boxBg;
                }}
              >
                <div
                  className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{
                    backgroundColor: `${T.accentColor}20`,
                    color: T.accentColor,
                  }}
                >
                  <Icon size={20} />
                </div>
                <h2
                  className="mb-2 text-lg font-black"
                  style={{ color: T.headerColor }}
                >
                  {section.title}
                </h2>
                <p
                  className="mb-5 text-sm leading-relaxed opacity-60"
                  style={{ color: T.textColor }}
                >
                  {section.body}
                </p>
                <span
                  className="inline-flex items-center gap-2 text-sm font-bold"
                  style={{ color: T.accentColor }}
                >
                  Open{" "}
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-1"
                  />
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
