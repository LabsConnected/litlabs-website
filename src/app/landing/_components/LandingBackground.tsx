/**
 * LandingBackground — MEDIUM intensity ambient depth layer.
 *
 * Fixed full-screen layer behind all content. Provides:
 *   - Slow-drifting workspace grid (subtle, never distracting)
 *   - Purple/cyan/green radial glows with slow breathing motion
 *   - Soft vignette to focus the center
 *
 * Intensity: MEDIUM
 *   - Grid drifts over 40s (barely perceptible but alive)
 *   - Glows breathe over 8-12s (premium, not flashy)
 *   - All motion respects prefers-reduced-motion
 */

export function LandingBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Primary glow orbs — slow breathing */}
      <div
        className="absolute -top-40 left-1/2 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-cyan-500/12 blur-[160px]"
        style={{ animation: "litt-bg-breath-cyan 12s ease-in-out infinite" }}
      />
      <div
        className="absolute top-1/4 -right-32 h-[520px] w-[520px] rounded-full bg-fuchsia-500/12 blur-[140px]"
        style={{ animation: "litt-bg-breath-fuchsia 10s ease-in-out infinite" }}
      />
      <div
        className="absolute bottom-1/3 -left-32 h-[520px] w-[520px] rounded-full bg-violet-500/10 blur-[140px]"
        style={{ animation: "litt-bg-breath-violet 14s ease-in-out infinite" }}
      />
      <div
        className="absolute bottom-0 right-1/3 h-[400px] w-[400px] rounded-full bg-amber-500/8 blur-[130px]"
        style={{ animation: "litt-bg-breath-amber 11s ease-in-out infinite" }}
      />
      {/* Subtle center accent */}
      <div className="absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/6 blur-[120px]" />

      {/* Grid — slow drift */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.7) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.7) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
          maskImage:
            "radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 80% 70% at 50% 40%, black 30%, transparent 80%)",
          animation: "litt-bg-grid-drift 40s linear infinite",
        }}
      />

      {/* Vignette — focus the center */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 100% 80% at 50% 40%, transparent 50%, rgba(6,6,14,0.6) 100%)",
        }}
      />

      {/* Animations — inline <style> to bypass Tailwind v4 purge of keyframes
          referenced only via inline style attributes. Respects prefers-reduced-motion. */}
      <style>{`
        @keyframes litt-bg-grid-drift {
          0%   { background-position: 0 0, 0 0; }
          100% { background-position: 56px 56px, 56px 56px; }
        }
        @keyframes litt-bg-breath-cyan {
          0%, 100% { opacity: 0.7; transform: translateX(-50%) scale(1); }
          50%      { opacity: 1;   transform: translateX(-50%) scale(1.06); }
        }
        @keyframes litt-bg-breath-fuchsia {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.08); }
        }
        @keyframes litt-bg-breath-violet {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50%      { opacity: 0.9; transform: scale(1.05); }
        }
        @keyframes litt-bg-breath-amber {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50%      { opacity: 0.85; transform: scale(1.07); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="litt-bg-"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
