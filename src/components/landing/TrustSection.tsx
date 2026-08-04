import Link from "next/link";
import { ArrowRight, Check, Play, Shield } from "lucide-react";

const PRODUCT_FACTS = [
  "Approval required for sensitive actions",
  "You retain ownership of your files, code, and assets",
  "Project memory across sessions",
  "Project file and checkpoint foundations are being finalized",
  "No credit card required to start",
];

export function TrustSection() {
  return (
    <section className="relative overflow-hidden border-t border-white/8 bg-[#060912] px-5 py-20 text-white lg:px-10 lg:py-28">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(168,255,47,.06),transparent_40%)]" />
      <div className="relative mx-auto max-w-4xl">
        <div className="mx-auto max-w-2xl text-center">
          <div className="flex items-center justify-center gap-2"><Shield size={16} className="text-[#a8ff2f]" /><span className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">What you can verify right now</span></div>
          <p className="mt-4 text-sm leading-7 text-white/50">We do not use fake metrics, invented testimonials, or stock company logos. These are real product capabilities you can test today.</p>
        </div>
        <div className="mt-10 grid gap-2.5 sm:grid-cols-2">
          {PRODUCT_FACTS.map((fact) => (<div key={fact} className="flex items-center gap-3 rounded-lg border border-white/8 bg-white/3 px-4 py-3"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#a8ff2f]/10 text-[#a8ff2f]"><Check size={13} strokeWidth={3} /></span><span className="text-xs font-bold leading-5 text-white/70">{fact}</span></div>))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-bold text-white/55">
          <Link href="/privacy" className="transition hover:text-white/70">Privacy Policy</Link>
          <Link href="/terms" className="transition hover:text-white/70">Terms of Service</Link>
          <Link href="/pricing" className="transition hover:text-white/70">Pricing</Link>
        </div>
        <div className="mt-16 border-t border-white/8 pt-16 text-center">
          <h2 className="mx-auto max-w-3xl text-4xl font-black leading-[.98] tracking-[-.04em] sm:text-5xl lg:text-6xl">Turn your next idea into<span className="mt-2 block bg-linear-to-r from-[#a8ff2f] via-[#65f4ff] to-[#b58cff] bg-clip-text text-transparent">something real.</span></h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-7 text-white/50">Give it a project, a crew, and a place to grow.</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-xl bg-[#a8ff2f] px-6 py-4 text-sm font-black text-[#03050a] shadow-[0_0_40px_rgba(168,255,47,.18)] transition hover:-translate-y-0.5 hover:bg-[#b8ff5f] hover:shadow-[0_0_50px_rgba(168,255,47,.3)]">Start building free <ArrowRight size={15} /></Link>
            <a href="#product" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-4 text-sm font-bold text-white transition hover:border-white/30 hover:bg-white/10"><Play size={14} fill="currentColor" /> See how it works</a>
          </div>
          <div className="mt-4 text-xs font-semibold text-white/50">No credit card required</div>
        </div>
      </div>
    </section>
  );
}
