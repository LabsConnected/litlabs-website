"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/* ────────────────────────────────────────────────────────────────────
 * LandingScrollReveal — MEDIUM intensity scroll-in reveal.
 *
 * Uses IntersectionObserver to fade+translate children in when they
 * enter the viewport. Respects prefers-reduced-motion (renders children
 * immediately with no animation).
 *
 * Intensity: MEDIUM
 *   - 600ms ease-out transition
 *   - 24px upward translate
 *   - subtle opacity 0 → 1
 *   - stagger via delay prop
 * ──────────────────────────────────────────────────────────────────── */

interface LandingScrollRevealProps {
  children: ReactNode;
  /** Delay in ms before the reveal animation starts (for staggering). */
  delay?: number;
  /** Extra class names on the wrapper. */
  className?: string;
  /** Translate distance in px (default 24). */
  distance?: number;
}

export function LandingScrollReveal({
  children,
  delay = 0,
  className = "",
  distance = 24,
}: LandingScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      setVisible(true);
      return;
    }
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [reducedMotion]);

  if (reducedMotion) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : `translateY(${distance}px)`,
        transition: `opacity 600ms ease-out ${delay}ms, transform 600ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
