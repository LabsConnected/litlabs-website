"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { ArrowUpRight, Sparkles } from "lucide-react";

const PRODUCT_LINKS = [
  { href: "/agents", label: "Agents" },
  { href: "/studio", label: "Studio" },
  { href: "/gallery", label: "Gallery" },
  { href: "/marketplace", label: "Marketplace" },
];

const RESOURCE_LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/flow", label: "Flow" },
  { href: "/social", label: "Social" },
  { href: "/code", label: "Code Scanner" },
];

const COMPANY_LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/cookies", label: "Cookies" },
];

const CONNECT_LINKS = [
  { href: "https://github.com", label: "GitHub", external: true },
  { href: "https://twitter.com", label: "Twitter / X", external: true },
];

export default function Footer() {
  const { resolvedColors: C } = useTheme();

  return (
    <footer
      className="w-full"
      style={{
        borderTop: `1px solid ${C.borderColor}18`,
        backgroundColor: C.bgColor,
      }}
    >
      <div className="w-full px-4 sm:px-6 py-10">
        <div
          className="mb-8 rounded-3xl border p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          style={{
            background:
              "linear-gradient(135deg, rgba(99,102,241,0.10), rgba(56,189,248,0.06))",
            borderColor: `${C.borderColor}25`,
          }}
        >
          <div>
            <div
              className="flex items-center gap-2 text-sm font-bold mb-1"
              style={{ color: C.textColor }}
            >
              <Sparkles size={14} style={{ color: C.accentColor }} />
              Ready to turn an idea into a live product?
            </div>
            <p className="text-sm opacity-65" style={{ color: C.textColor }}>
              Start in Studio and jump into the marketplace. Keep the path short
              and obvious.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:scale-[1.02]"
              style={{ backgroundColor: C.accentColor, color: C.bgColor }}
            >
              Launch Studio <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-8">
          <div>
            <div
              className="text-sm font-bold mb-3 opacity-90"
              style={{ color: C.textColor }}
            >
              Product
            </div>
            <div className="space-y-2">
              {PRODUCT_LINKS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="block text-sm opacity-70 hover:opacity-100 transition-opacity"
                  style={{ color: C.textColor }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div
              className="text-sm font-bold mb-3 opacity-90"
              style={{ color: C.textColor }}
            >
              Resources
            </div>
            <div className="space-y-2">
              {RESOURCE_LINKS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="block text-sm opacity-70 hover:opacity-100 transition-opacity"
                  style={{ color: C.textColor }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div
              className="text-sm font-bold mb-3 opacity-90"
              style={{ color: C.textColor }}
            >
              Company
            </div>
            <div className="space-y-2">
              {COMPANY_LINKS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="block text-sm opacity-70 hover:opacity-100 transition-opacity"
                  style={{ color: C.textColor }}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div
              className="text-sm font-bold mb-3 opacity-90"
              style={{ color: C.textColor }}
            >
              Connect
            </div>
            <div className="space-y-2">
              {CONNECT_LINKS.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm opacity-70 hover:opacity-100 transition-opacity"
                  style={{ color: C.textColor }}
                >
                  {item.label}
                </a>
              ))}
            </div>
          </div>
        </div>
        <div
          className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-6"
          style={{ borderTop: `1px solid ${C.borderColor}15` }}
        >
          <div className="flex items-center gap-2">
            <span
              className="text-sm font-black"
              style={{ color: C.headerColor }}
            >
              LiTTree LabStudios
            </span>
            <span className="text-xs opacity-60">© 2026</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs opacity-60">
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: "#34d399" }}
            />
            All Systems Operational
          </div>
        </div>
      </div>
    </footer>
  );
}
