/**
 * LandingMissionProof — the live LiTT mission visualization.
 *
 * Shows an example LiTT mission flowing through the canonical phases:
 *   UNDERSTANDING → PLANNING → CODING → RUNNING → VERIFYING → READY TO SHIP
 *
 * Alongside the mission: code, terminal, tests, preview, files changed.
 * This is the "LiTT actually proves the promise" section — it mirrors
 * the real runtime phase machine in @litt/agent-core (RuntimePhase) and
 * the VerificationGate (COMPLETE = runtime proved it passed).
 */

const PHASES = [
  { key: "understanding", label: "Understanding", icon: "◇", color: "#a855f7" },
  { key: "planning", label: "Planning", icon: "◈", color: "#30e7ff" },
  { key: "coding", label: "Coding", icon: "✎", color: "#f97316" },
  { key: "running", label: "Running", icon: "▶", color: "#f59e0b" },
  { key: "verifying", label: "Verifying", icon: "✦", color: "#ec4899" },
  { key: "ready", label: "Ready to ship", icon: "✓", color: "#34d399" },
] as const;

const FILES_CHANGED = [
  { path: "src/app/(marketing)/page.tsx", status: "M", color: "#f59e0b" },
  { path: "src/components/landing/LandingHero.tsx", status: "M", color: "#f59e0b" },
  { path: "src/lib/verify.ts", status: "A", color: "#34d399" },
  { path: "src/__tests__/verify.test.ts", status: "A", color: "#34d399" },
];

const TEST_RESULTS = [
  { name: "verify › all checks pass", status: "pass", color: "#34d399" },
  { name: "verify › one check fails → not proven", status: "pass", color: "#34d399" },
  { name: "verify › missing checks skipped", status: "pass", color: "#34d399" },
  { name: "verify › browser check runs", status: "pass", color: "#34d399" },
  { name: "runtime › phase → complete when proven", status: "pass", color: "#34d399" },
];

export function LandingMissionProof() {
  return (
    <section className="relative z-10 px-4 py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
            <span className="h-px w-8 bg-emerald-400/40" />
            Example mission
            <span className="h-px w-8 bg-emerald-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            Watch LiTT actually work.
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-violet-300 to-cyan-300 bg-clip-text text-transparent">
              Not &quot;the model said done.&quot;
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            Every mission flows through the same runtime truth: plan, code, run, observe
            failures, repair, then verify. <span className="font-semibold text-neutral-200">COMPLETE means the runtime proved it passed</span> — typecheck, tests, build, and browser checks with real exit codes.
          </p>
        </div>

        {/* Mission phase flow */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-2 md:gap-3">
          {PHASES.map((phase, i) => (
            <div key={phase.key} className="flex items-center gap-2 md:gap-3">
              <div
                className="flex items-center gap-2 rounded-full border px-3.5 py-2 text-[11px] font-bold md:text-xs"
                style={{
                  borderColor: `${phase.color}40`,
                  background: `${phase.color}10`,
                  color: phase.color,
                }}
              >
                <span>{phase.icon}</span>
                <span className="tracking-wide">{phase.label}</span>
              </div>
              {i < PHASES.length - 1 && (
                <span className="text-neutral-700">→</span>
              )}
            </div>
          ))}
        </div>

        {/* Proof panels: code / terminal / tests / preview / files */}
        <div className="grid gap-3 lg:grid-cols-3">
          {/* Code panel */}
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a14] transition-all duration-500 hover:border-white/12 hover:shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2 border-b border-white/6 bg-[#0d0d18] px-4 py-2.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-neutral-500">Code</span>
              <span className="ml-auto text-[9px] font-mono text-violet-400">page.tsx</span>
            </div>
            <pre className="overflow-x-auto p-4 text-[10px] leading-relaxed font-mono">
              <code>
                <span className="text-neutral-600">{"// LiTT edited this file"}</span>
                {"\n"}
                <span className="text-violet-400">export function</span>{" "}
                <span className="text-cyan-400">HomePage</span>() {"{"}
                {"\n  "}
                <span className="text-violet-400">return</span> (
                {"\n    <"}
                <span className="text-orange-400">section</span>
                {" className="}
                <span className="text-emerald-400">&quot;hero&quot;</span>{">"}
                {"\n      <"}
                <span className="text-orange-400">h1</span>{">"}Bring the idea.{"</"}
                <span className="text-orange-400">h1</span>{">"}
                {"\n    </"}
                <span className="text-orange-400">section</span>{">"}
                {"\n  );"}
                {"\n}"}
              </code>
            </pre>
          </div>

          {/* Terminal panel */}
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#06060e] transition-all duration-500 hover:border-white/12 hover:shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2 border-b border-white/6 bg-[#0a0a14] px-4 py-2.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-neutral-500">Terminal</span>
              <span className="ml-auto text-[9px] font-mono text-neutral-600">run_8f2a1</span>
            </div>
            <div className="p-4 font-mono text-[10px] leading-relaxed">
              <div className="text-cyan-400">$ pnpm typecheck</div>
              <div className="text-neutral-500">tsc --noEmit — exit 0 (3.2s)</div>
              <div className="mt-1 text-cyan-400">$ pnpm test</div>
              <div className="text-neutral-500">500 tests — all pass (10.8s)</div>
              <div className="mt-1 text-cyan-400">$ pnpm build</div>
              <div className="text-neutral-500">next build — exit 0 (42s)</div>
              <div className="mt-1 text-emerald-400">✓ verification gate: PROVEN</div>
              <div className="text-violet-400">
                $ <span className="motion-reduce:animate-none animate-pulse">▋</span>
              </div>
            </div>
          </div>

          {/* Tests panel */}
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a14] transition-all duration-500 hover:border-white/12 hover:shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2 border-b border-white/6 bg-[#0d0d18] px-4 py-2.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-neutral-500">Tests</span>
              <span className="ml-auto text-[9px] font-mono text-emerald-400">5/5 pass</span>
            </div>
            <div className="space-y-1.5 p-4">
              {TEST_RESULTS.map((t) => (
                <div key={t.name} className="flex items-center gap-2 text-[10px] font-mono">
                  <span style={{ color: t.color }}>✓</span>
                  <span className="text-neutral-400">{t.name}</span>
                </div>
              ))}
              <div className="mt-2 flex items-center justify-between border-t border-white/6 pt-2 text-[10px] font-mono">
                <span className="text-neutral-500">VerificationGate</span>
                <span className="font-bold text-emerald-400">PROVEN</span>
              </div>
            </div>
          </div>

          {/* Preview panel */}
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a14] transition-all duration-500 hover:border-white/12 hover:shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-2 border-b border-white/6 bg-[#0d0d18] px-4 py-2.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-neutral-500">Preview</span>
              <span className="ml-auto flex items-center gap-1 text-[9px] font-mono text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 motion-reduce:hidden" />
                localhost:3000
              </span>
            </div>
            <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-violet-600/10 to-emerald-500/5 p-6">
              <div className="text-center">
                <div className="text-2xl font-black text-white">Bring the idea.</div>
                <div className="bg-gradient-to-r from-violet-400 to-emerald-400 bg-clip-text text-lg font-black text-transparent">
                  LiTT helps you build the rest.
                </div>
                <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[9px] font-bold text-white">
                  Start Building Free
                </div>
              </div>
            </div>
          </div>

          {/* Files changed panel */}
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-[#0a0a14] transition-all duration-500 hover:border-white/12 hover:shadow-[0_8px_40px_rgba(0,0,0,0.4)] lg:col-span-2">
            <div className="flex items-center gap-2 border-b border-white/6 bg-[#0d0d18] px-4 py-2.5">
              <span className="text-[9px] font-black uppercase tracking-widest text-neutral-500">Files changed</span>
              <span className="ml-auto text-[9px] font-mono text-neutral-600">4 files · +128 −14</span>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2">
              {FILES_CHANGED.map((f) => (
                <div key={f.path} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/2 px-3 py-2 font-mono text-[10px]">
                  <span className="font-bold" style={{ color: f.color }}>{f.status}</span>
                  <span className="text-neutral-300">{f.path}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[10px] font-bold text-emerald-400 sm:col-span-2">
                <span>✓</span>
                <span>Diff reviewed · Ready for commit / PR</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
