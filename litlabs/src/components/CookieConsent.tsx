"use client";

import { useState, useEffect } from "react";

export default function CookieConsent() {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    setMounted(true);
    setVisible(!localStorage.getItem("cookie-consent"));
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      const timer = setTimeout(() => setAnimateIn(true), 100);
      return () => clearTimeout(timer);
    }
  }, [mounted, visible]);

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

  if (!mounted || !visible) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:w-[420px] z-100 border-2 p-4 transition-all duration-300"
      style={{
        borderColor: "#ff00ff",
        backgroundColor: "#1a0a2e",
        color: "#00ff41",
        fontFamily: "monospace",
        fontSize: "11px",
        transform: animateIn ? "translateY(0)" : "translateY(20px)",
        opacity: animateIn ? 1 : 0,
        boxShadow: "0 0 20px rgba(255, 0, 255, 0.3)",
      }}
    >
      <div className="flex items-start gap-3">
        <span className="text-lg shrink-0">🍪</span>
        <div className="flex-1">
          <div
            className="font-bold uppercase tracking-wider mb-1"
            style={{ color: "#00ffff" }}
          >
            Neural Cookie Protocol
          </div>
          <p className="opacity-80 leading-relaxed mb-3 text-[10px]">
            We use cookies and local storage to power themes, authentication,
            and AI agent sessions. Analytics help us optimize the grid. You can
            manage preferences anytime in Settings.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={acceptAll}
              className="px-3 py-1.5 text-[10px] font-bold border-2 hover:scale-105 transition-transform"
              style={{
                borderColor: "#00ff41",
                color: "#000",
                backgroundColor: "#00ff41",
              }}
            >
              ✓ ACCEPT ALL
            </button>
            <button
              onClick={acceptEssential}
              className="px-3 py-1.5 text-[10px] font-bold border-2 hover:scale-105 transition-transform"
              style={{
                borderColor: "#ff0080",
                color: "#ff0080",
                backgroundColor: "transparent",
              }}
            >
              ESSENTIAL ONLY
            </button>
            <a
              href="/cookies"
              className="px-3 py-1.5 text-[10px] font-bold border-2 hover:scale-105 transition-transform inline-block"
              style={{
                borderColor: "#ff00ff",
                color: "#ff00ff",
                backgroundColor: "transparent",
                textDecoration: "none",
              }}
            >
              DETAILS
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
