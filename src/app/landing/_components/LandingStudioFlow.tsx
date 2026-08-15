/**
 * LandingStudioFlow — the Studio loop visualization.
 *
 * V1 spec: Prompt ↔ Canvas ↔ Code ↔ Preview ↔ Files
 * Shows how a single prompt flows through the Studio surfaces and back.
 */

const NODES = [
  { label: "Prompt", desc: "Tell LiTT what to build", color: "#a855f7", icon: "✦" },
  { label: "Canvas", desc: "Visual layout of the result", color: "#30e7ff", icon: "▣" },
  { label: "Code", desc: "Real files in your repo", color: "#f97316", icon: "✎" },
  { label: "Preview", desc: "Live app, running", color: "#34d399", icon: "▶" },
  { label: "Files", desc: "Diff you can review", color: "#ec4899", icon: "≡" },
] as const;

export function LandingStudioFlow() {
  return (
    <section className="relative z-10 border-y border-white/5 px-4 py-24 md:py-32" style={{ background: "rgba(255,255,255,0.01)" }}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300">
            <span className="h-px w-8 bg-cyan-400/40" />
            Studio
            <span className="h-px w-8 bg-cyan-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            One loop.
            <br />
            <span className="bg-gradient-to-r from-cyan-300 via-violet-300 to-orange-300 bg-clip-text text-transparent">
              Prompt ↔ Canvas ↔ Code ↔ Preview ↔ Files
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            Studio is where the idea becomes a working artifact. Every surface is connected —
            change the prompt, the code updates; change the code, the preview updates; review
            the files, approve, and ship.
          </p>
        </div>

        {/* Flow nodes */}
        <div className="flex flex-col items-center gap-3 md:flex-row md:justify-center md:gap-2">
          {NODES.map((node, i) => (
            <div key={node.label} className="flex items-center gap-2 md:gap-3">
              <div
                className="flex w-44 flex-col items-center rounded-2xl border p-5 text-center transition-all duration-300 hover:scale-[1.03]"
                style={{
                  borderColor: `${node.color}30`,
                  background: `linear-gradient(145deg, ${node.color}0d, transparent)`,
                }}
              >
                <div
                  className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-xl"
                  style={{ background: `${node.color}18`, color: node.color, border: `1px solid ${node.color}30` }}
                >
                  {node.icon}
                </div>
                <div className="text-sm font-black text-white">{node.label}</div>
                <div className="mt-1 text-[11px] leading-relaxed text-neutral-500">{node.desc}</div>
              </div>
              {i < NODES.length - 1 && (
                <span className="text-xl text-neutral-700">↔</span>
              )}
            </div>
          ))}
        </div>

        {/* Caption */}
        <div className="mt-10 text-center">
          <p className="mx-auto max-w-2xl text-sm text-neutral-500">
            <span className="font-semibold text-neutral-300">No invisible magic.</span>{" "}
            Every transition is visible, every file change is reviewable, and every
            dangerous action requires your approval.
          </p>
        </div>
      </div>
    </section>
  );
}
