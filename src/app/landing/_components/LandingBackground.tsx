export function LandingBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0">
      <div className="absolute -top-32 left-1/2 h-[640px] w-[640px] -translate-x-1/2 rounded-full bg-cyan-500/10 blur-[140px]" />
      <div className="absolute top-1/3 -right-40 h-[480px] w-[480px] rounded-full bg-fuchsia-500/10 blur-[140px]" />
      <div className="absolute bottom-1/4 -left-40 h-[480px] w-[480px] rounded-full bg-violet-500/10 blur-[140px]" />
      <div
        className="absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage:
            "radial-gradient(ellipse at center, black 30%, transparent 75%)",
        }}
      />
    </div>
  );
}
