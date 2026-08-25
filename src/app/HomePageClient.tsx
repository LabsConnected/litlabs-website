"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { ArrowRight, Bot, Sparkles } from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSupabaseAuthHook } from "@/hooks/useSupabaseAuth";
import { LandingHeroV3 } from "@/app/landing/_components/LandingHeroV3";
import { MissionSequence } from "@/components/landing/MissionSequence";
import { InteractiveProductDemo } from "@/components/landing/InteractiveProductDemo";
import { RealCreations } from "@/components/landing/RealCreations";
import { WhyDifferent } from "@/components/landing/WhyDifferent";
import { TrustSection } from "@/components/landing/TrustSection";

/* ── Navigation ────────────────────────────────────────────────── */

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/8 bg-[#03050a]/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between px-5 lg:px-10">
        <Link href="/" className="flex items-center gap-2.5 font-black tracking-tight text-white">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 text-[#a8ff2f] shadow-[0_0_25px_rgba(168,255,47,.18)]">
            <Bot size={18} />
          </span>
          <span>LiTTree LabStudios</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-semibold text-white/60 md:flex">
          <a href="#product" className="transition hover:text-[#a8ff2f]">Product</a>
          <a href="#creations" className="transition hover:text-[#a8ff2f]">Creations</a>
          <Link href="/studio" className="transition hover:text-[#a8ff2f]">Studio</Link>
          <Link href="/discover" className="transition hover:text-[#a8ff2f]">Community</Link>
          <Link href="/marketplace" className="transition hover:text-[#a8ff2f]">Marketplace</Link>
          <Link href="/pricing" className="transition hover:text-[#a8ff2f]">Pricing</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="hidden px-3 py-2 text-sm font-bold text-white/60 transition hover:text-white sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex items-center gap-2 rounded-full bg-linear-to-r from-[#a8ff2f] to-[#62f6c4] px-4 py-2 text-sm font-black text-[#03050a] shadow-[0_0_28px_rgba(168,255,47,.2)] transition hover:scale-[1.03] hover:shadow-[0_0_38px_rgba(168,255,47,.35)]"
          >
            Start free <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ── Page ──────────────────────────────────────────────────────── */

function LandingPage() {
  return (
    <main className="min-h-dvh overflow-hidden bg-[#03050a] text-white selection:bg-[#a970ff] selection:text-white">
      <Header />

      {/* ═══ 1. PREMIUM HERO — LandingHeroV3 (LiTT agent + Studio) ═══ */}
      <div className="pt-16">
        <LandingHeroV3 />
      </div>

      {/* ═══ 2. LiTT IN ACTION — MissionSequence as product proof ═══ */}
      <section id="how" className="relative border-b border-white/8 bg-[#05070d] px-5 py-16 lg:px-10 lg:py-20">
        <div className="mx-auto max-w-screen-2xl">
          <div className="mx-auto mb-10 max-w-3xl text-center">
            <div className="text-xs font-black uppercase tracking-[.2em] text-violet-300">
              LiTT in action
            </div>
            <h2 className="mt-3 text-3xl font-black leading-[1] tracking-[-.04em] sm:text-4xl">
              Watch a mission actually run.
            </h2>
            <p className="mt-4 text-base leading-7 text-white/50">
              Not a chat. A real execution loop — prompt, plan, files, preview,
              verification, ship. Click through each stage.
            </p>
          </div>
          <div className="mx-auto max-w-5xl">
            <MissionSequence />
          </div>
        </div>
      </section>

      {/* ═══ 3. INTERACTIVE PRODUCT DEMONSTRATION ═══ */}
      <section id="product" className="relative border-b border-white/8 bg-[#070912] px-5 py-20 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <div className="text-xs font-black uppercase tracking-[.2em] text-[#65f4ff]">
              Not a chat. An operating system.
            </div>
            <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              Explore the workflow.
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/50">
              Click through each stage to see exactly how LiTTree takes a project
              from prompt to deployment.
            </p>
          </div>
          <div className="mt-12">
            <InteractiveProductDemo />
          </div>
        </div>
      </section>

      {/* ═══ 4. THREE CAPABILITIES ═══ */}
      <section className="relative border-b border-white/8 bg-[#060912] px-5 py-20 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              Three things LiTTree does exceptionally well.
            </h2>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {[
              {
                title: "Build working products",
                copy: "Sites, apps, dashboards, and tools—generated with real code, organized in your workspace, and deployed with one click.",
                accent: "#65f4ff",
                steps: ["Describe the outcome", "LiTT creates a plan", "Files are generated", "Preview and approve", "Deploy to live URL"],
              },
              {
                title: "Create complete media and branding",
                copy: "Images, branding, music concepts, video treatments, and campaigns—produced with the right creative tools for each task.",
                accent: "#b58cff",
                steps: ["Define the brand", "Generate visual assets", "Create copy and messaging", "Produce social assets", "Package for publishing"],
              },
              {
                title: "Preserve context and finish the work",
                copy: "Project memory, version history, and human approvals keep the work moving forward—so projects get finished, not abandoned.",
                accent: "#a8ff2f",
                steps: ["Start a project", "Decisions are saved", "Checkpoints created", "Approve sensitive actions", "Roll back if needed"],
              },
            ].map((cap) => (
              <div
                key={cap.title}
                className="rounded-2xl border border-white/10 bg-[#0a0d14] p-6 transition duration-300 hover:border-white/20"
              >
                <h3 className="text-lg font-black" style={{ color: cap.accent }}>
                  {cap.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-white/50">{cap.copy}</p>
                <div className="mt-5 space-y-2">
                  {cap.steps.map((step, i) => (
                    <div key={step} className="flex items-center gap-2.5">
                      <span
                        className="grid h-5 w-5 shrink-0 place-items-center rounded-md text-[10px] font-black"
                        style={{ backgroundColor: `${cap.accent}12`, color: cap.accent }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-xs text-white/50">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 5. PRODUCT DEMONSTRATIONS ═══ */}
      <section id="creations" className="relative border-b border-white/8 bg-[#05070d] px-5 py-20 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">
              See the workflow
            </div>
            <h2 className="mt-4 text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              Product demonstrations.
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/50">
              These are illustrative simulations showing how LiTTree takes a prompt
              through mission, plan, build, and result. Each demo walks through the
              complete workflow.
            </p>
          </div>
          <div className="mt-12">
            <RealCreations />
          </div>
        </div>
      </section>

      {/* ═══ 6. WHY LiTTree IS DIFFERENT ═══ */}
      <section className="relative border-b border-white/8 bg-[#060912] px-5 py-20 lg:px-10 lg:py-28">
        <div className="mx-auto max-w-screen-2xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-4xl font-black leading-[.98] tracking-[-.045em] sm:text-5xl">
              Why LiTTree is different.
            </h2>
            <p className="mt-5 text-lg leading-8 text-white/50">
              A chat interface forgets everything. LiTTree remembers, builds real
              files, asks for your approval, and ships the work.
            </p>
          </div>
          <div className="mt-12">
            <WhyDifferent />
          </div>
        </div>
      </section>

      {/* ═══ 7. TRUST + FINAL CTA ═══ */}
      <TrustSection />

      {/* ═══ FOOTER ═══ */}
      <footer className="bg-[#050706] px-5 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))] lg:px-10">
        <div className="mx-auto flex max-w-screen-2xl flex-col items-center justify-between gap-4 text-xs text-white/35 sm:flex-row">
          <div className="flex items-center gap-2 font-black text-white">
            <Sparkles size={14} className="text-[#a8ff2f]" /> LiTTree LabStudios
          </div>
          <div className="flex flex-wrap gap-5">
            <Link href="/studio">Studio</Link>
            <Link href="/marketplace">Marketplace</Link>
            <Link href="/gallery">Gallery</Link>
            <Link href="/games">Games</Link>
            <Link href="/discover">Community</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

export default function HomePageClient() {
  const { isSignedIn: clerkSignedIn, isLoaded: clerkLoaded } = useClerkAuth();
  const { isSignedIn: supabaseSignedIn, loading: supabaseLoading } =
    useSupabaseAuthHook();
  const router = useRouter();

  useEffect(() => {
    if (!clerkLoaded || supabaseLoading) return;
    if (clerkSignedIn || supabaseSignedIn) router.replace("/studio");
  }, [clerkSignedIn, supabaseSignedIn, clerkLoaded, supabaseLoading, router]);

  return <LandingPage />;
}
