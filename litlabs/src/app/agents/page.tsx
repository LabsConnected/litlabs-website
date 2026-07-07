"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { Terminal, Bot } from "lucide-react";

export default function AgentsPage() {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();

  useEffect(() => {
    router.replace("/studio?tool=agents");
  }, [router]);

  return (
    <main
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: T.bgColor, color: T.textColor }}
    >
      <div className="text-center space-y-3">
        <Bot className="mx-auto h-8 w-8" style={{ color: T.accentColor }} />
        <div className="text-lg font-black">Agents are now in Studio</div>
        <Link
          href="/studio?tool=agents"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition"
          style={{ backgroundColor: T.accentColor, color: T.bgColor }}
        >
          <Terminal className="h-4 w-4" />
          Open Studio Agents
        </Link>
      </div>
    </main>
  );
}
