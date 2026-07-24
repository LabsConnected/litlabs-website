"use client";

export function VisualPackSettings() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-white/40">
        Customize your visual experience — themes, wallpapers, fonts, and effects.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        {["Midnight", "Aurora", "Sunset", "Ocean", "Forest", "Mono"].map((theme) => (
          <button
            key={theme}
            className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left transition hover:border-cyan-300/30"
          >
            <span className="text-xs font-bold text-white">{theme}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
