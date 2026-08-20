/**
 * LandingRoadmap — truthful V1 roadmap.
 *
 * Consume the canonical capability registry (src/config/product-capabilities.ts).
 * No hand-maintained statuses — the registry is the single source of truth.
 *
 * V1 spec: label truthfully as LIVE / BETA / COMING.
 * Do NOT pretend future features are live.
 */

import { allCapabilities, type ProductCapability } from "@/config/product-capabilities";

const STATUS_LABELS: Record<string, "LIVE" | "BETA" | "COMING"> = {
  live: "LIVE",
  beta: "BETA",
  coming: "COMING",
};

const STATUS_STYLES: Record<"LIVE" | "BETA" | "COMING", { color: string; bg: string; border: string }> = {
  LIVE: { color: "#34d399", bg: "rgba(52,211,153,0.1)", border: "rgba(52,211,153,0.3)" },
  BETA: { color: "#f59e0b", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)" },
  COMING: { color: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.2)" },
};

export function LandingRoadmap() {
  const capabilities = allCapabilities();
  return (
    <section id="roadmap" className="relative z-10 px-4 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
            <span className="h-px w-8 bg-emerald-400/40" />
            Roadmap
            <span className="h-px w-8 bg-emerald-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            What&apos;s real today.
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-amber-300 to-slate-300 bg-clip-text text-transparent">
              What&apos;s coming next.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            We don&apos;t pretend future features are live. Here is exactly what works now,
            what is in beta, and what is on the way.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {capabilities.map((cap: ProductCapability) => {
            const label = STATUS_LABELS[cap.status] ?? "COMING";
            const s = STATUS_STYLES[label];
            return (
              <div
                key={cap.id}
                className="flex items-start gap-4 rounded-xl border border-white/8 bg-white/2 p-4 transition-all duration-500 hover:border-white/12 hover:bg-white/3"
              >
                <span
                  className="mt-0.5 shrink-0 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest"
                  style={{ color: s.color, borderColor: s.border, background: s.bg }}
                >
                  {label}
                </span>
                <div>
                  <div className="text-sm font-bold text-white">{cap.name}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-neutral-500">{cap.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
