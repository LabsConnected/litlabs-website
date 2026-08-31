import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Play, ShieldCheck, Sparkles } from "lucide-react";

const PRODUCT_FACTS = [
  "Free starter plan with no credit card required",
  "Your project files and generated assets stay exportable",
  "Sensitive actions require your approval",
  "Project context persists across sessions",
  "Beta capabilities are labeled clearly",
] as const;

export function TrustSection() {
  return (
    <section className="relative overflow-hidden border-t border-white/8 bg-[#05070d] px-5 py-16 lg:px-8 lg:py-24">
      <div data-reveal className="litt-final-cta relative mx-auto max-w-[1500px] overflow-hidden rounded-[2rem] border border-white/11">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_30%,rgba(168,255,47,.13),transparent_34%),radial-gradient(circle_at_62%_78%,rgba(101,244,255,.1),transparent_30%),radial-gradient(circle_at_90%_28%,rgba(181,140,255,.12),transparent_30%)]" />
        <div className="litt-grid-fade pointer-events-none absolute inset-0 opacity-25" />

        <div className="relative grid min-h-[620px] lg:grid-cols-[1.05fr_.95fr]">
          <div className="relative z-10 flex flex-col justify-center p-7 sm:p-10 lg:p-14 xl:p-16">
            <div className="litt-eyebrow !mx-0"><Sparkles size={13} /> Your next project starts here</div>
            <h2 className="mt-6 max-w-3xl text-[clamp(3rem,6.5vw,6.6rem)] font-black leading-[0.88] tracking-[-0.07em] text-white">
              Turn the next idea into <span className="litt-gradient-text">something real.</span>
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-7 text-white/54 sm:text-lg sm:leading-8">
              Give LiTT the mission and a place to build. LiTT will help plan the work, create the pieces, verify the result, and keep the context for what comes next.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up" className="litt-primary-button">Start building free <ArrowRight size={16} /></Link>
              <a href="#how-it-works" className="litt-secondary-button"><Play size={13} fill="currentColor" /> See how it works</a>
            </div>

            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              {PRODUCT_FACTS.map((fact) => (
                <div key={fact} className="flex items-start gap-2.5 text-xs font-semibold leading-5 text-white/46">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-[#a8ff2f]/18 bg-[#a8ff2f]/8 text-[#a8ff2f]"><Check size={11} /></span>
                  {fact}
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-bold text-white/32">
              <span className="inline-flex items-center gap-1.5 text-white/44"><ShieldCheck size={12} className="text-[#a8ff2f]" /> Built around your control</span>
              <Link href="/privacy" className="transition hover:text-white">Privacy</Link>
              <Link href="/terms" className="transition hover:text-white">Terms</Link>
              <Link href="/pricing" className="transition hover:text-white">Pricing</Link>
            </div>
          </div>

          <div className="relative min-h-[520px] overflow-hidden lg:min-h-full">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(168,255,47,.14),transparent_35%)]" />
            <Image
              src="/brand/litt-mascot-hero.png"
              alt="LiTT, ready to help build a new project"
              fill
              sizes="(max-width: 1024px) 92vw, 45vw"
              className="object-contain object-bottom px-4 pt-8 drop-shadow-[0_30px_80px_rgba(0,0,0,.6)] lg:px-0 lg:pt-14"
            />
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-[#070a10] to-transparent" />
            <div className="absolute right-5 top-5 rounded-full border border-[#a8ff2f]/22 bg-[#05070d]/70 px-3 py-2 text-[10px] font-black uppercase tracking-[0.15em] text-[#caff85] backdrop-blur-xl lg:right-8 lg:top-8">
              <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-[#a8ff2f] shadow-[0_0_9px_#a8ff2f]" /> LiTT online
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
