import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-[#06060e]/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2.5 text-sm font-black tracking-tight text-white"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 via-fuchsia-500 to-amber-400 shadow-lg shadow-fuchsia-500/30">
            <Sparkles size={15} className="text-black" />
          </div>
          LiTTree <span className="text-neutral-500">/</span> LabStudios
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-neutral-400 md:flex">
          <a href="#features" className="transition hover:text-white">
            Features
          </a>
          <a href="#how" className="transition hover:text-white">
            How it works
          </a>
          <Link href="/agents" className="transition hover:text-white">
            Agents
          </Link>
          <Link href="/marketplace" className="transition hover:text-white">
            Marketplace
          </Link>
          <Link href="/docs" className="transition hover:text-white">
            Docs
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden rounded-lg px-3 py-1.5 text-sm font-medium text-neutral-300 transition hover:text-white sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-1.5 text-sm font-bold text-black shadow-lg shadow-white/10 transition hover:bg-neutral-200"
          >
            Start free <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </header>
  );
}
