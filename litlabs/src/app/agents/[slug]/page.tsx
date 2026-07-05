"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { Bot, Terminal } from "lucide-react";

const LEGACY_SLUGS = new Set(["jarvis", "littree"]);

export default function AgentPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { resolvedColors: T } = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (!slug || LEGACY_SLUGS.has(slug)) {
      router.replace("/littree");
    }
  }, [slug, router]);

  if (!slug || LEGACY_SLUGS.has(slug)) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: T.bgColor, color: T.textColor }}
      >
        <div className="text-center space-y-3">
          <Bot className="mx-auto h-8 w-8" style={{ color: T.accentColor }} />
          <div className="text-lg font-black">
            LiTTree is now your main agent
          </div>
          <div className="text-xs opacity-70" style={{ color: T.textMuted }}>
            Redirecting from legacy agent page...
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      <div className="text-center space-y-3">
        <Bot className="mx-auto h-8 w-8" style={{ color: T.accentColor }} />
        <div className="text-lg font-black">Agent not found</div>
        <div className="text-xs opacity-70" style={{ color: T.textMuted }}>
          This agent slot is empty under LiTTree.
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => router.back()}
            className="rounded-xl px-4 py-2.5 text-sm font-bold transition"
            style={{
              backgroundColor: T.boxBg,
              color: T.textColor,
              border: `1px solid ${T.borderColor}30`,
            }}
          >
            Go back
          </button>
          <button
            onClick={() => router.push("/littree")}
            className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition"
            style={{ backgroundColor: T.accentColor, color: T.bgColor }}
          >
            <Terminal className="h-4 w-4" />
            Open LiTTree Core
          </button>
        </div>
      </div>
    </main>
  );
}
