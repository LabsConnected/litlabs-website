"use client";

export const dynamic = "force-dynamic";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import PageShell from "@/components/PageShell";
import { Bookmark, Heart, ArrowUpRight } from "lucide-react";

export default function LibrarySavedPage() {
  const { resolvedColors: T } = useTheme();

  const cardStyle = {
    backgroundColor: `${T.boxBg}60`,
    borderColor: T.borderColor + "30",
  };

  const savedLinks = [
    { href: "/social?feed=saved", label: "Saved posts", desc: "Posts you bookmarked in the feed" },
    { href: "/gallery?tab=favorites", label: "Favorite media", desc: "Gallery items you liked" },
    { href: "/marketplace?tab=favorites", label: "Marketplace favorites", desc: "Agents and items you saved" },
    { href: "/games?tab=continue", label: "Continue playing", desc: "Pick up where you left off" },
  ];

  return (
    <PageShell
      title="Saved"
      subtitle="Bookmarks and favorites across the platform"
      icon={<Bookmark size={28} />}
    >
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {savedLinks.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center justify-between rounded-xl border p-4 transition-all hover:opacity-90 group"
            style={cardStyle}
          >
            <div className="flex items-start gap-3">
              <Heart size={18} style={{ color: T.accentColor }} className="mt-0.5" />
              <div>
                <div className="font-bold text-sm" style={{ color: T.headerColor }}>
                  {item.label}
                </div>
                <p className="text-xs opacity-55 mt-0.5">{item.desc}</p>
              </div>
            </div>
            <ArrowUpRight size={16} className="opacity-40 group-hover:opacity-80" />
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
