"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";

export default function StudioImagePage() {
  const { resolvedColors: T } = useTheme();
  const router = useRouter();
  useEffect(() => {
    router.replace("/studio");
  }, [router]);
  return (
    <div className="min-h-dvh bg-[#050505] flex items-center justify-center">
      <div className="animate-pulse text-sm" style={{ color: T.accentColor }}>
        Redirecting to Studio…
      </div>
    </div>
  );
}
