"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { useSupabaseAuthHook } from "@/hooks/useSupabaseAuth";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Code2,
  Palette,
  Play,
  Rocket,
  Sparkles,
  WandSparkles,
} from "lucide-react";

const powers = [
  { icon: Code2, label: "Build", copy: "Sites, apps, tools & automations" },
  { icon: Palette, label: "Create", copy: "Images, video, audio & ideas" },
  { icon: BrainCircuit, label: "Remember", copy: "Your projects, style & decisions" },
  { icon: Rocket, label: "Elevate", copy: "Review, improve & ship real work" },
];

const steps = [
  ["01", "Tell LiTT the mission", "Bring an idea, a problem, or a project already in motion."],
  ["02", "Your crew gets to work", "LiTT directs the plan while specialist agents create, code, research, and refine."],
  ["03", "You stay in command", "See the work, guide every decision, and ship when it feels right."],
];

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-white/10 bg-[#050706]/80 backdrop-blur-2xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5 font-black tracking-tight text-white">
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 text-[#a8ff2f] shadow-[0_0_25px_rgba(168,255,47,.18)]">
            <Bot size={18} />
          </span>
          <span>LiTT Labs</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm font-semibold text-white/60 md:flex">
          <a href="#crew" className="transition hover:text-[#a8ff2f]">The crew</a>
          <a href="#what-we-do" className="transition hover:text-[#a8ff2f]">What we do</a>
          <a href="#how-it-works" className="transition hover:text-[#a8ff2f]">How it works</a>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/sign-in" className="hidden px-3 py-2 text-sm font-bold text-white/60 transition hover:text-white sm:block">
            Sign in
          </Link>
          <Link href="/sign-up" className="inline-flex items-center gap-2 rounded-full bg-[#a8ff2f] px-4 py-2 text-sm font-black text-black transition hover:scale-[1.03] hover:bg-white">
            Meet your crew <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </header>
  );
}

function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#050706] text-white">
      <Header />

      <section className="relative min-h-[760px] border-b border-white/10 pt-16">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_38%,rgba(123,48,255,.24),transparent_34%),radial-gradient(circle_at_25%_25%,rgba(168,255,47,.12),transparent_26%)]" />
        <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-5 py-16 lg:min-h-[760px] lg:grid-cols-[.92fr_1.08fr] lg:px-8 lg:py-20">
          <div className="relative z-10">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#a8ff2f]/25 bg-[#a8ff2f]/8 px-4 py-2 text-xs font-black uppercase tracking-[.18em] text-[#a8ff2f]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#a8ff2f]" />
              Your creative AI crew is online
            </div>
            <h1 className="max-w-3xl text-5xl font-black leading-[.94] tracking-[-.055em] sm:text-6xl lg:text-7xl xl:text-[5.5rem]">
              Don&apos;t just chat with AI.
              <span className="mt-3 block bg-gradient-to-r from-[#a8ff2f] via-[#7efbff] to-[#a970ff] bg-clip-text text-transparent">
                Build a world with it.
              </span>
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-8 text-white/65">
              LiTT Labs is your creative command center—one place to build products,
              make art, explore ideas, and turn imagination into something real.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up" className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#a8ff2f] px-6 py-4 text-sm font-black text-black shadow-[0_0_40px_rgba(168,255,47,.22)] transition hover:-translate-y-1 hover:bg-white">
                Start building free <ArrowRight size={16} />
              </Link>
              <a href="#crew" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-4 text-sm font-bold transition hover:border-[#a970ff]/60 hover:bg-white/10">
                <Play size={15} fill="currentColor" /> Meet LiTT & Spark
              </a>
            </div>
            <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/45">
              <span>✓ Free during beta</span>
              <span>✓ You approve the work</span>
              <span>✓ Your data stays yours</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[680px]">
            <div className="absolute inset-10 rounded-full bg-[#a8ff2f]/20 blur-[90px]" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-black/40 shadow-[0_35px_100px_rgba(0,0,0,.65)]">
              <video
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                poster="/brand/litt-alive-poster.webp"
                aria-label="LiTT comes to life and welcomes you to the lab"
                className="aspect-[4/4.55] w-full object-cover object-center motion-reduce:hidden"
              >
                <source src="/brand/litt-alive.mp4" type="video/mp4" />
              </video>
              <Image
                src="/brand/litt-alive-poster.webp"
                alt="LiTT, your friendly AI creative director"
                width={1280}
                height={784}
                priority
                className="hidden aspect-[4/4.55] w-full object-cover object-center motion-reduce:block"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-6 pb-6 pt-24">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[.22em] text-[#a8ff2f]">Crew 01 · Director</div>
                    <div className="mt-1 text-2xl font-black">LiTT</div>
                    <p className="mt-1 text-sm text-white/60">Plans the mission. Protects your vision. Keeps everything moving.</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[#a8ff2f]/30 bg-[#a8ff2f]/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-[#a8ff2f]">Online</span>
                </div>
              </div>
            </div>
            <div className="absolute -bottom-5 -left-4 rounded-2xl border border-white/15 bg-[#10120f]/90 p-4 shadow-2xl backdrop-blur-xl sm:-left-10">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#a970ff] text-black"><WandSparkles size={18} /></span>
                <div><div className="text-xs font-black">Ready for a mission</div><div className="text-[11px] text-white/45">Build · Create · Play · Elevate</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="what-we-do" className="border-b border-black/10 bg-[#f2efe6] px-5 py-20 text-black lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
            <div>
              <div className="text-xs font-black uppercase tracking-[.2em] text-[#6d42e8]">What LiTT Labs is for</div>
              <h2 className="mt-4 text-4xl font-black leading-none tracking-[-.045em] sm:text-6xl">Bring the idea.<br />We&apos;ll build the momentum.</h2>
            </div>
            <p className="max-w-xl text-lg leading-8 text-black/60 lg:justify-self-end">
              This is for creators, founders, learners, and curious people who want
              AI to do more than answer questions. Your crew helps you make, learn,
              experiment, and finish.
            </p>
          </div>
          <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {powers.map(({ icon: Icon, label, copy }, index) => (
              <div key={label} className={`group min-h-56 rounded-2xl border border-black/15 p-6 transition hover:-translate-y-1 ${index === 1 ? "bg-[#11130f] text-white" : "bg-white/50"}`}>
                <Icon size={26} className={index === 1 ? "text-[#a8ff2f]" : "text-[#6d42e8]"} />
                <div className="mt-14 text-3xl font-black">{label}</div>
                <p className={`mt-2 text-sm leading-6 ${index === 1 ? "text-white/55" : "text-black/55"}`}>{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="crew" className="relative border-b border-white/10 bg-[#080a08] px-5 py-20 lg:px-8 lg:py-28">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(112,52,255,.14),transparent_45%)]" />
        <div className="relative mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">Meet the core crew</div>
              <h2 className="mt-4 max-w-2xl text-4xl font-black leading-none tracking-[-.045em] sm:text-6xl">Real characters.<br />Real roles. One mission.</h2>
            </div>
            <Link href="/agents" className="inline-flex items-center gap-2 text-sm font-black text-[#a970ff]">Explore all agents <ArrowRight size={15} /></Link>
          </div>
          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            <article className="group overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#11130f]">
              <div className="relative aspect-[16/10] overflow-hidden">
                <Image src="/brand/litt-mascot-character-sheet.png" alt="LiTT agent character views" fill className="object-cover transition duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#11130f] via-transparent to-transparent" />
              </div>
              <div className="p-7">
                <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#a8ff2f]">Director · Builder · Guide</div>
                <h3 className="mt-2 text-3xl font-black">LiTT</h3>
                <p className="mt-3 max-w-xl leading-7 text-white/55">Your always-there creative director. LiTT understands the goal, assembles the right tools, remembers the project, and helps turn the next idea into finished work.</p>
              </div>
            </article>
            <article className="group overflow-hidden rounded-[1.75rem] border border-white/15 bg-[#11130f]">
              <div className="relative aspect-[16/10] overflow-hidden">
                <Image src="/brand/spark-agent-portrait.png" alt="Spark, LiTT's playful robotic fox companion" fill className="object-cover transition duration-700 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#11130f] via-transparent to-transparent" />
              </div>
              <div className="p-7">
                <div className="text-[10px] font-black uppercase tracking-[.2em] text-[#a970ff]">Companion · Explorer · Creative spark</div>
                <h3 className="mt-2 text-3xl font-black">Spark</h3>
                <p className="mt-3 max-w-xl leading-7 text-white/55">The playful side of the lab. Spark keeps discovery fun, helps you explore new directions, and brings personality, energy, and curiosity to every mission.</p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="bg-[#f2efe6] px-5 py-20 text-black lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="overflow-hidden rounded-[2rem] border border-black/15 bg-black shadow-[12px_12px_0_#a8ff2f]">
            <div className="relative aspect-[16/9]">
              <Image src="/brand/litt-base-station.png" alt="The LiTT Base Station creative command center" fill className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/25 to-transparent" />
              <div className="absolute inset-y-0 left-0 flex max-w-xl flex-col justify-center p-7 sm:p-12">
                <div className="text-xs font-black uppercase tracking-[.2em] text-[#a8ff2f]">The vision</div>
                <h2 className="mt-3 text-3xl font-black leading-tight text-white sm:text-5xl">A creative home that grows with you.</h2>
                <p className="mt-4 hidden max-w-md leading-7 text-white/60 sm:block">Agents, projects, memories, tools, and play—all connected in one space that feels like yours.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-y border-white/10 bg-[#080a08] px-5 py-20 lg:px-8 lg:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="text-xs font-black uppercase tracking-[.2em] text-[#a970ff]">How it works</div>
          <h2 className="mt-4 text-4xl font-black tracking-[-.045em] sm:text-6xl">You lead. Your crew delivers.</h2>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 lg:grid-cols-3">
            {steps.map(([number, title, copy]) => (
              <div key={number} className="bg-[#0c0f0b] p-7 sm:p-9">
                <div className="font-mono text-xs font-black text-[#a8ff2f]">{number}</div>
                <h3 className="mt-10 text-2xl font-black">{title}</h3>
                <p className="mt-3 leading-7 text-white/50">{copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#a8ff2f] px-5 py-20 text-black lg:px-8 lg:py-24">
        <div className="absolute -right-16 -top-20 text-[22rem] font-black leading-none text-black/8">L</div>
        <div className="relative mx-auto flex max-w-7xl flex-col justify-between gap-10 lg:flex-row lg:items-end">
          <div>
            <div className="text-xs font-black uppercase tracking-[.2em]">Your next idea is waiting</div>
            <h2 className="mt-3 max-w-4xl text-5xl font-black leading-[.95] tracking-[-.05em] sm:text-7xl">Build it. Create it.<br /><span className="font-serif italic font-normal">Have fun with it.</span></h2>
          </div>
          <Link href="/sign-up" className="inline-flex w-fit items-center gap-2 rounded-xl bg-black px-6 py-4 text-sm font-black text-white transition hover:-translate-y-1 hover:bg-[#6d42e8]">
            Enter LiTT Labs <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      <footer className="bg-[#050706] px-5 py-8 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 text-xs text-white/35 sm:flex-row">
          <div className="flex items-center gap-2 font-black text-white"><Sparkles size={14} className="text-[#a8ff2f]" /> LiTT Labs</div>
          <div>Build · Create · Have fun · Elevate</div>
          <div className="flex gap-5"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
        </div>
      </footer>
    </main>
  );
}

export default function HomePage() {
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
