import { X, Check } from "lucide-react";

const CHAT_CONS = [
  "Generates suggestions, not shipped work",
  "Loses all project context between sessions",
  "Cannot prove the work was done correctly",
  "Produces disconnected, unreferenced outputs",
  "Leaves every execution step to you",
];

const LITT_PROS = [
  "Works inside a connected, real project",
  "Coordinates a specialized agent crew",
  "Maintains persistent project memory",
  "Shows live files, diffs, and artifacts",
  "Requires approval before critical actions",
  "Tests and verifies the result automatically",
  "Opens pull requests or deploys directly",
];

export function LandingComparison() {
  return (
    <section className="relative z-10 px-4 py-24 md:py-32">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-16 text-center">
          <p className="mb-3 text-base font-semibold text-neutral-400">
            AI chat gives you answers.
          </p>
          <h2 className="text-3xl font-black tracking-tight text-white md:text-5xl">
            LiTT gives your project
            <br />
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  "linear-gradient(110deg, #a855f7 0%, #30e7ff 100%)",
              }}
            >
              a crew.
            </span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-neutral-400">
            Most AI tools stop after generating text. LiTT keeps going.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Normal AI Chat */}
          <div
            className="relative overflow-hidden rounded-2xl border border-white/8 p-8"
            style={{
              background:
                "linear-gradient(145deg, rgba(239,68,68,0.04), transparent)",
            }}
          >
            <div className="mb-6">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-red-500/20 bg-red-500/8 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-red-400">
                Normal AI Chat
              </div>
              <p className="text-sm text-neutral-500">
                Answers, suggestions, and generated text.
              </p>
            </div>

            <ul className="space-y-3.5">
              {CHAT_CONS.map((c) => (
                <li key={c} className="flex items-start gap-3 text-sm text-neutral-400">
                  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-red-500/15 border border-red-500/25">
                    <X size={9} className="text-red-400" />
                  </div>
                  {c}
                </li>
              ))}
            </ul>
          </div>

          {/* LiTT Labs */}
          <div
            className="relative overflow-hidden rounded-2xl border border-purple-500/20 p-8"
            style={{
              background:
                "linear-gradient(145deg, rgba(168,85,247,0.07), rgba(48,231,255,0.03))",
            }}
          >
            {/* Top accent line */}
            <div
              className="absolute left-0 top-0 h-px w-full"
              style={{
                background:
                  "linear-gradient(90deg, transparent, rgba(168,85,247,0.6) 40%, rgba(48,231,255,0.4) 70%, transparent)",
              }}
            />

            <div className="mb-6">
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-purple-300">
                🌳 LiTT Labs
              </div>
              <p className="text-sm text-neutral-400">
                A connected project crew that builds and ships.
              </p>
            </div>

            <ul className="space-y-3.5">
              {LITT_PROS.map((p) => (
                <li key={p} className="flex items-start gap-3 text-sm text-neutral-200">
                  <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 border border-emerald-500/25">
                    <Check size={9} className="text-emerald-400" />
                  </div>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
