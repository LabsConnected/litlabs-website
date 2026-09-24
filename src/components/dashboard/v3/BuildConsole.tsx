"use client";

import { FormEvent, useState } from "react";
import { ArrowRight, Code2, Gamepad2, Image as ImageIcon, Layout, Palette, Play } from "lucide-react";
import { useRouter } from "next/navigation";

const SUGGESTIONS = [
  { label: "Website", href: "/studio?tool=chat&mode=website", icon: Layout, color: "#a78bfa" },
  { label: "Image", href: "/studio?creator=image", icon: ImageIcon, color: "#22d3ee" },
  { label: "Video", href: "/studio?tool=chat&mode=video", icon: Play, color: "#f472b6" },
  { label: "Code", href: "/studio?tool=chat&mode=code", icon: Code2, color: "#34d399" },
  { label: "Design", href: "/studio?tool=design", icon: Palette, color: "#f59e0b" },
  { label: "Game", href: "/studio?tool=game", icon: Gamepad2, color: "#c084fc" },
];

export function BuildConsole() {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = prompt.trim();
    if (!value) return;
    router.push(`/studio?tool=chat&prompt=${encodeURIComponent(value)}`);
  };

  return (
    <section
      className="relative overflow-hidden rounded-2xl border p-5 shadow-2xl md:p-7"
      style={{
        background: "linear-gradient(135deg, rgba(30,20,55,.88), rgba(12,18,26,.86))",
        borderColor: "rgba(167,139,250,.28)",
        boxShadow: "0 0 60px rgba(124,58,237,.12), inset 0 1px rgba(255,255,255,.06)",
        backdropFilter: "blur(16px)",
      }}
    >
      <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative z-10">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.22em] text-cyan-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300 shadow-[0_0_12px_#67e8f9]" />
          LiTT control console
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white md:text-4xl">What do you want to make?</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">Describe the outcome or choose a starting point. LiTT will open the right workspace and help you move it forward.</p>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-3 sm:flex-row">
          <label className="sr-only" htmlFor="dashboard-build-prompt">What do you want to build?</label>
          <input
            id="dashboard-build-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Build a launch page for my new product…"
            className="min-h-12 flex-1 rounded-xl border bg-black/30 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/10"
            style={{ borderColor: "rgba(255,255,255,.12)" }}
          />
          <button type="submit" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40" disabled={!prompt.trim()}>
            Create <ArrowRight size={16} />
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map(({ label, href, icon: Icon, color }) => (
            <button key={label} type="button" onClick={() => router.push(href)} className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold text-zinc-300 transition hover:-translate-y-0.5 hover:text-white" style={{ borderColor: `${color}40`, background: `${color}0d` }}>
              <Icon size={14} style={{ color }} /> {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
