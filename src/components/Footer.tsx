"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { Zap, MessageCircle, Radio, Globe } from "lucide-react";

const productLinks = [
  { href: "/studio", label: "Studio" },
  { href: "/builder", label: "Builder" },
  { href: "/generate", label: "Generate" },
  { href: "/gallery", label: "Gallery" },
];

const creatorLinks = [
  { href: "/marketplace", label: "Marketplace" },
  { href: "/showcase", label: "Showcase" },
  { href: "/agent-chat", label: "Agent Chat" },
  { href: "/social", label: "Social" },
];

const legalLinks = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookies" },
];

export default function Footer() {
  const { resolvedColors } = useTheme();

  return (
    <footer
      className="border-t mt-auto"
      style={{
        borderColor: resolvedColors.borderColor + "30",
        backgroundColor: resolvedColors.bgColor + "90",
        backdropFilter: "blur(12px)",
        color: resolvedColors.textColor,
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8">
          {/* Product */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: resolvedColors.headerColor }}>
              Product
            </h4>
            <ul className="space-y-2">
              {productLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-[11px] font-medium transition-opacity hover:opacity-100"
                    style={{ color: resolvedColors.textMuted }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Creators */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: resolvedColors.headerColor }}>
              Creators
            </h4>
            <ul className="space-y-2">
              {creatorLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-[11px] font-medium transition-opacity hover:opacity-100"
                    style={{ color: resolvedColors.textMuted }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: resolvedColors.headerColor }}>
              Legal
            </h4>
            <ul className="space-y-2">
              {legalLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-[11px] font-medium transition-opacity hover:opacity-100"
                    style={{ color: resolvedColors.textMuted }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Connect */}
          <div>
            <h4 className="text-[10px] font-bold uppercase tracking-widest mb-3" style={{ color: resolvedColors.headerColor }}>
              Connect
            </h4>
            <div className="flex items-center gap-3 mb-3">
              <a href="https://github.com/litbit" target="_blank" rel="noopener noreferrer" className="hover:opacity-100 opacity-60 transition-opacity flex items-center gap-1 text-[11px]" style={{ color: resolvedColors.linkColor }}>
                <Globe size={14} /> GitHub
              </a>
              <a href="https://twitter.com/litlabs" target="_blank" rel="noopener noreferrer" className="hover:opacity-100 opacity-60 transition-opacity flex items-center gap-1 text-[11px]" style={{ color: resolvedColors.linkColor }}>
                <Globe size={14} /> X
              </a>
              <a href="https://discord.gg/litlabs" target="_blank" rel="noopener noreferrer" className="hover:opacity-100 opacity-60 transition-opacity flex items-center gap-1 text-[11px]" style={{ color: resolvedColors.linkColor }}>
                <MessageCircle size={14} /> Discord
              </a>
            </div>
            <div className="flex items-center gap-2 text-[10px]" style={{ color: resolvedColors.textMuted }}>
              <Radio size={10} className="status-dot online" />
              <span>All Systems Operational</span>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div
          className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6 border-t"
          style={{ borderColor: resolvedColors.borderColor + "20" }}
        >
          <div className="flex items-center gap-2">
            <Zap size={14} style={{ color: resolvedColors.accentColor }} />
            <span className="text-[11px] font-bold" style={{ color: resolvedColors.headerColor }}>
              LiTree Labs
            </span>
            <span className="text-[10px] opacity-50" style={{ color: resolvedColors.textMuted }}>
              © 2026
            </span>
          </div>
          <span className="text-[10px] opacity-40" style={{ color: resolvedColors.textMuted }}>
            Deployed on the Edge · Built with Next.js
          </span>
        </div>
      </div>
    </footer>
  );
}
