"use client";

import { useEffect, useRef, useState } from "react";

export default function AnimatedStat({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [displayed, setDisplayed] = useState("0");
  const hasRun = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasRun.current) {
          hasRun.current = true;
          const numeric = parseFloat(value.replace(/[^0-9.]/g, ""));
          const suffix = value.replace(/[0-9.,]/g, "");
          const duration = 1200;
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            const current = numeric * ease;
            setDisplayed(
              current >= 1000
                ? `${(current / 1000).toFixed(current >= 10000 ? 0 : 1)}K${suffix}`
                : `${Math.round(current)}${suffix}`,
            );
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={ref}>
      <div
        className="text-3xl md:text-4xl font-black mb-1"
        style={{ color: "#f8fafc" }}
      >
        {displayed}
      </div>
      <div className="text-xs uppercase tracking-widest opacity-40 font-bold">
        {label}
      </div>
    </div>
  );
}
