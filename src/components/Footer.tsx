"use client";

import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";

export default function Footer() {
  const { resolvedColors } = useTheme();

  return (
    <footer
      className="border-t mt-auto"
      style={{
        borderColor: resolvedColors.borderColor,
        backgroundColor: resolvedColors.boxBg,
        color: resolvedColors.textColor,
        fontFamily: "monospace",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] uppercase tracking-wider opacity-80">
          <div className="flex items-center gap-2">
            <span className="text-sm">🚀</span>
            <span className="font-bold" style={{ color: resolvedColors.headerColor }}>
              LiTTree Lab Studios
            </span>
            <span className="opacity-50">© 2026</span>
          </div>

          <div className="flex gap-4">
            <Link href="/terms" className="hover:opacity-100 transition-opacity" style={{ color: resolvedColors.linkColor, textDecoration: "none" }}>
              Terms
            </Link>
            <Link href="/privacy" className="hover:opacity-100 transition-opacity" style={{ color: resolvedColors.linkColor, textDecoration: "none" }}>
              Privacy
            </Link>
            <Link href="/cookies" className="hover:opacity-100 transition-opacity" style={{ color: resolvedColors.linkColor, textDecoration: "none" }}>
              Cookies
            </Link>
            <a
              href="https://litlabs.net"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-100 transition-opacity"
              style={{ color: resolvedColors.linkColor, textDecoration: "none" }}
            >
              Status
            </a>
          </div>

          <div className="opacity-50">
            Deployed on the Edge · All Systems Operational
          </div>
        </div>
      </div>
    </footer>
  );
}
