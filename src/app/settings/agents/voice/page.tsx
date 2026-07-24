"use client";

import { useTheme } from "@/context/ThemeContext";
import { VoiceSettings } from "@/features/voice/components/VoiceSettings";
import Link from "next/link";

function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    back: "M19 12H5 M12 19l-7-7 7-7",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[name] || ""} />
    </svg>
  );
}

export default function VoiceSettingsPage() {
  const T = useTheme().resolvedColors;

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor + "d0", color: T.textColor }}>
      <div className="mx-auto max-w-3xl p-4 lg:p-6">
        <Link
          href="/settings"
          className="mb-4 inline-flex items-center gap-2 text-sm opacity-60 transition-all hover:opacity-100"
        >
          <Icon name="back" size={14} />
          Back to Settings
        </Link>

        <h1 className="mb-1 text-2xl font-black" style={{ color: T.headerColor }}>
          Voice
        </h1>
        <p className="mb-6 text-sm opacity-50">
          Configure LiTT and Spark voice profiles, speech settings, and conversation preferences.
        </p>

        <VoiceSettings />
      </div>
    </div>
  );
}
