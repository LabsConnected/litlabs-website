"use client";

import { useState } from "react";
import { Terminal, Copy, Check, Download } from "lucide-react";

const INSTALL_COMMANDS = {
  npm: "npm install -g @litlabs1/litt-cli",
  pnpm: "pnpm add -g @litlabs1/litt-cli",
  npx: "npx @litlabs1/litt-cli --version",
  dlx: "pnpm dlx @litlabs1/litt-cli --version",
};

function CodeBlock({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard not available — ignore
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-bold uppercase tracking-wide text-white/50">{label}</div>
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#090d1b] p-3 pr-4 font-mono text-sm text-white/90 shadow-sm">
        <code className="flex-1 overflow-x-auto whitespace-pre">{command}</code>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}

export default function CliPageClient() {
  return (
    <main id="main-content" className="min-h-dvh bg-[#03050a] text-white selection:bg-accent selection:text-on-accent">
      <section className="relative overflow-hidden pb-12 pt-[120px] lg:pt-[160px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(169,112,255,.12),transparent_40%),radial-gradient(circle_at_80%_100%,rgba(168,255,47,.08),transparent_40%)]" />
        <div className="relative mx-auto max-w-[1100px] px-5 lg:px-8">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-bold text-accent">
            <Terminal size={12} />
            LiTT for your terminal
          </div>
          <h1 className="text-4xl font-black leading-[1.05] tracking-[-0.03em] sm:text-5xl lg:text-6xl">
            The same LiTT brain, <br className="hidden sm:block" />
            <span className="text-transparent bg-clip-text bg-linear-to-r from-accent to-[#a970ff]">
              in your terminal.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/60">
            Install the LiTT CLI to start projects, run agents, inspect code, and ship from the command line.
            It connects to the same runtime as Studio, so your work stays in one place.
          </p>

          <div className="mt-12 grid gap-8 md:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-[#090d1b]/70 p-6 shadow-[0_24px_70px_rgba(0,0,0,.35)]">
              <div className="mb-6 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent">
                  <Download size={20} />
                </div>
                <h2 className="text-lg font-black">Install</h2>
              </div>
              <div className="space-y-4">
                <CodeBlock label="npm" command={INSTALL_COMMANDS.npm} />
                <CodeBlock label="pnpm" command={INSTALL_COMMANDS.pnpm} />
                <div className="pt-2 text-sm text-white/50">
                  Or run once without installing:
                </div>
                <CodeBlock label="npx" command={INSTALL_COMMANDS.npx} />
                <CodeBlock label="pnpm dlx" command={INSTALL_COMMANDS.dlx} />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-[#090d1b]/70 p-6 shadow-[0_24px_70px_rgba(0,0,0,.35)]">
              <div className="mb-6 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#a970ff]/10 text-[#a970ff]">
                  <Terminal size={20} />
                </div>
                <h2 className="text-lg font-black">Quickstart</h2>
              </div>
              <div className="space-y-4">
                <CodeBlock label="Verify" command="litt --version" />
                <CodeBlock label="Open the cockpit" command="litt" />
                <CodeBlock label="Run a health check" command="litt doctor" />
                <CodeBlock label="Run typecheck" command="litt check" />
              </div>
              <p className="mt-6 text-sm leading-relaxed text-white/50">
                Requires Node.js 22+ and Git. Some commands need pnpm. Run{" "}
                <code className="rounded bg-white/10 px-1 py-0.5 text-white/80">litt --help</code> to see everything.
              </p>
            </div>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-3">
            {[
              { title: "Own your workspace", copy: "Runs in your local repo. Files stay on your machine." },
              { title: "Same agents as Studio", copy: "LiTT (operator) and Spark (creative specialist) share one runtime, one memory." },
              { title: "Built for builders", copy: "Diffs, tests, builds, deploys, and approvals — in one flow." },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
                <h3 className="mb-2 text-sm font-black text-white/90">{item.title}</h3>
                <p className="text-sm leading-relaxed text-white/55">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
