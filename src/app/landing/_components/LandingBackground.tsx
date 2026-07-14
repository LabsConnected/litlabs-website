export function LandingBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {/* Primary glow orbs */}
      <div className="absolute -top-40 left-1/2 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-cyan-500/12 blur-[160px]" />
      <div className="absolute top-1/4 -right-32 h-[520px] w-[520px] rounded-full bg-fuchsia-500/12 blur-[140px]" />
      <div className="absolute bottom-1/3 -left-32 h-[520px] w-[520px] rounded-full bg-violet-500/10 blur-[140px]" />
      <div className="absolute bottom-0 right-1/3 h-[400px] w-[400px] rounded-full bg-amber-500/8 blur-[130px]" />
      {/* Subtle center accent */}
      <div className="absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/6 blur-[120px]" />
      {/* Grid */}
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
        }}
      />
    </div>
  );
}
