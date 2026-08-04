"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";

export default function CookieConsent() {
  const { resolvedColors: T } = useTheme();
  // Keep the server and first client render identical. Reading localStorage in
  // the state initializer caused React hydration error #418 for new visitors.
  const [visible, setVisible] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    setVisible(!localStorage.getItem("cookie-consent"));
  }, []);

  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => setAnimateIn(true), 100);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const acceptAll = () => {
    localStorage.setItem(
      "cookie-consent",
      JSON.stringify({
        essential: true,
        preferences: true,
        analytics: true,
        marketing: true,
        timestamp: Date.now(),
      }),
    );
    setAnimateIn(false);
    setTimeout(() => setVisible(false), 300);
  };

  const acceptEssential = () => {
    localStorage.setItem(
      "cookie-consent",
      JSON.stringify({
        essential: true,
        preferences: false,
        analytics: false,
        marketing: false,
        timestamp: Date.now(),
      }),
    );
    setAnimateIn(false);
    setTimeout(() => setVisible(false), 300);
  };

  if (!visible) return null;

  return (
    <div
      className="fixed top-4 left-4 right-4 md:top-auto md:bottom-4 md:left-auto md:right-6 md:w-[420px] z-[10000] border-2 p-4 transition-all duration-300"
      style={{
        borderColor: T.accentColor,
        backgroundColor: T.boxBg,
        color: T.textColor,
        fontSize: "12px",
        transform: animateIn ? "translateY(0)" : "translateY(20px)",
        opacity: animateIn ? 1 : 0,
        boxShadow: `0 0 24px ${T.accentColor}35`,
      }}
    >
      <div className="flex items-start gap-3">
        <span className="text-lg shrink-0">🍪</span>
        <div className="flex-1">
          <div
            className="font-bold mb-1"
            style={{ color: T.headerColor }}
          >
            Cookie preferences
          </div>
          <p className="opacity-80 leading-relaxed mb-3 text-[11px]">
            We use essential cookies for sign-in, settings, and Studio sessions.
            Optional analytics help us improve LiTTree. You can change your
            preferences anytime.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={acceptAll}
              className="px-3 py-1.5 text-[11px] font-bold border-2 hover:scale-105 transition-transform"
              style={{
                borderColor: T.accentColor,
                color: T.bgColor,
                backgroundColor: T.accentColor,
              }}
            >
              Accept all
            </button>
            <button
              onClick={acceptEssential}
              className="px-3 py-1.5 text-[11px] font-bold border-2 hover:scale-105 transition-transform"
              style={{
                borderColor: T.borderColor,
                color: T.textColor,
                backgroundColor: "transparent",
              }}
            >
              Essential only
            </button>
            <a
              href="/cookies"
              className="px-3 py-1.5 text-[11px] font-bold border-2 hover:scale-105 transition-transform inline-block"
              style={{
                borderColor: T.borderColor,
                color: T.linkColor,
                backgroundColor: "transparent",
                textDecoration: "none",
              }}
            >
              Manage preferences
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
