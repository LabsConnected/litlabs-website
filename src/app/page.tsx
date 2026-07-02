"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSupabaseAuthHook } from '@/hooks/useSupabaseAuth';
import { useClerkAuth } from '@/hooks/useClerkAuth';
import { Code2, Bot, BarChart3, ChevronRight, Shield, ArrowRight, Globe, Coins, Sparkles, Rocket, Workflow, Layers3, MessageSquareText, Users } from 'lucide-react';

const FEATURES = [
  { icon: Bot, title: 'Specialized AI Agents', desc: 'Deploy purpose-built agents for coding, writing, data analysis, social growth, and more. Each agent is finely tuned for its domain.' },
  { icon: Code2, title: 'No-Code Workflow Builder', desc: 'Build complex multi-agent pipelines with a visual drag-and-drop interface. No coding required — just connect and deploy.' },
  { icon: BarChart3, title: 'Real-Time Analytics', desc: 'Monitor agent performance, user engagement, and system metrics with live dashboards and actionable insights.' },
  { icon: Coins, title: 'Token Economy', desc: 'Earn LitCoins through platform activity. Use them to unlock premium agents, features, and marketplace listings.' },
  { icon: Globe, title: 'Social Engine', desc: 'Built-in social feed, comments, and community features. Share your creations and discover what others are building.' },
  { icon: Shield, title: 'Enterprise Security', desc: 'Enterprise-grade security with Clerk auth, encrypted data, and role-based access control. Your data stays yours.' },
];

const BENEFITS = [
  { icon: Workflow, title: 'Ship faster', text: 'Turn an idea into a working agent workflow in minutes instead of days.' },
  { icon: Layers3, title: 'One system', text: 'Manage studio, feed, analytics, and marketplace from a single control plane.' },
  { icon: MessageSquareText, title: 'Stay human', text: 'Agents assist the work without replacing the personality behind the brand.' },
];

const PROOF_POINTS = [
  { value: '500+', label: 'starter credits' },
  { value: '< 5 min', label: 'to first launch' },
  { value: '24/7', label: 'agent runtime' },
  { value: '6', label: 'core specialists' },
];

const AGENTS = [
  { icon: '🎯', name: 'Director', role: 'Orchestrator', desc: 'Routes tasks across your agent workforce. The brain of your operation.', color: '#00ffff', href: '/agents/director' },
  { icon: '🏆', name: 'Champion', role: 'General', desc: 'Takes charge of complex missions. Your most versatile agent.', color: '#ff0080', href: '/agents/champion' },
  { icon: '💻', name: 'Code Champ', role: 'Engineer', desc: 'Writes, debugs, and reviews code. Full-stack capable.', color: '#00ff41', href: '/agents/code-champion' },
  { icon: '📱', name: 'Social Dom', role: 'Growth', desc: 'Plans content, schedules posts, and grows your audience.', color: '#ff6b6b', href: '/agents/social-dominator' },
  { icon: '📊', name: 'Data Slayer', role: 'Analytics', desc: 'Crunch numbers, find patterns, build dashboards.', color: '#ffff00', href: '/agents/data-slayer' },
  { icon: '✍️', name: 'Writer', role: 'Content', desc: 'Crafts copy, stories, and marketing content.', color: '#ff9ff3', href: '/agents/writing-coach' },
];

function LandingPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#08080c', color: '#e2e2e9' }}>
      {/* Hero */}
      <section className="relative px-4 pt-20 pb-16 md:pt-28 md:pb-24 text-center overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #6366f140 0%, transparent 70%)', filter: 'blur(60px)' }} />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #3b82f640 0%, transparent 70%)', filter: 'blur(60px)' }} />
          <div className="absolute inset-x-0 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, #6366f180, transparent)' }} />
        </div>

        <div className="relative max-w-6xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-8 border" style={{ borderColor: '#26262e', backgroundColor: '#12121a' }}>
            <Sparkles size={12} className="text-cyan-300" />
            Build, launch, and grow with a single AI workspace
          </div>

          <h1 className="text-4xl md:text-7xl font-black tracking-tight mb-6 leading-tight" style={{ color: '#f8fafc' }}>
            Deploy AI Agents{' '}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #6366f1, #3b82f6)' }}>
              That Actually Work
            </span>
          </h1>

          <p className="text-lg md:text-xl mb-8 max-w-3xl mx-auto opacity-70 leading-relaxed">
            LiTTree Lab Studios is the AI-first creator platform. Build agent workflows, launch a public-facing studio, and turn your ideas into something people can actually use.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/studio"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold transition-all hover:scale-105"
              style={{ backgroundColor: '#6366f1', color: '#fff', boxShadow: '0 0 30px #6366f130' }}
            >
              Launch Studio <ArrowRight size={16} />
            </Link>
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold border transition-all hover:bg-white/5"
              style={{ borderColor: '#26262e' }}
            >
              Create Free Account
            </Link>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mt-10 max-w-4xl mx-auto">
            {PROOF_POINTS.map((item) => (
              <div key={item.label} className="rounded-2xl border px-4 py-4" style={{ backgroundColor: '#12121a', borderColor: '#26262e' }}>
                <div className="text-2xl md:text-3xl font-black" style={{ color: '#f8fafc' }}>{item.value}</div>
                <div className="text-[10px] uppercase tracking-[0.28em] opacity-45 font-bold mt-1">{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why it works */}
      <section className="px-4 py-14" style={{ borderTop: '1px solid #26262e30', borderBottom: '1px solid #26262e30' }}>
        <div className="max-w-6xl mx-auto grid md:grid-cols-3 gap-4">
          {BENEFITS.map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.title} className="rounded-2xl border p-6 text-left" style={{ backgroundColor: '#12121a', borderColor: '#26262e' }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4" style={{ backgroundColor: '#6366f120', color: '#7dd3fc' }}>
                  <Icon size={20} />
                </div>
                <h3 className="font-bold mb-2" style={{ color: '#f8fafc' }}>{item.title}</h3>
                <p className="text-sm opacity-55 leading-relaxed">{item.text}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Features */}
      <section className="px-4 py-24" id="features">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black mb-4" style={{ color: '#f8fafc' }}>Everything You Need</h2>
            <p className="opacity-50 max-w-xl mx-auto">A complete platform for building, deploying, and scaling AI agents, from ideation to production.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(f => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="group p-6 rounded-xl border transition-all hover:translate-y-[-2px]" style={{ backgroundColor: '#12121a', borderColor: '#26262e' }}>
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 text-sm transition-all group-hover:scale-110" style={{ backgroundColor: '#6366f120', color: '#6366f1' }}>
                    <Icon size={20} />
                  </div>
                  <h3 className="font-bold mb-2" style={{ color: '#f8fafc' }}>{f.title}</h3>
                  <p className="text-sm opacity-50 leading-relaxed">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-4 py-24" style={{ borderTop: '1px solid #26262e30' }}>
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black mb-4" style={{ color: '#f8fafc' }}>How It Works</h2>
            <p className="opacity-50 max-w-xl mx-auto">Get started in three simple steps. No complex setup required.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            {[
              { step: '01', title: 'Choose Your Agent', desc: 'Browse our marketplace of specialized AI agents. Each is purpose-built for specific tasks — coding, writing, analytics, and more.' },
              { step: '02', title: 'Customize & Deploy', desc: "Configure behavior, knowledge, and tools, then ship with one click to your studio or workspace." },
              { step: '03', title: 'Scale & Earn', desc: 'Monitor performance, iterate quickly, and publish to the marketplace when you are ready.' },
            ].map(s => (
              <div key={s.step} className="text-center">
                <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 text-sm font-black" style={{ backgroundColor: '#6366f120', color: '#6366f1', border: '1px solid #6366f140' }}>
                  {s.step}
                </div>
                <h3 className="font-bold mb-2" style={{ color: '#f8fafc' }}>{s.title}</h3>
                <p className="text-sm opacity-50 leading-relaxed max-w-xs mx-auto">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Agents Showcase */}
      <section className="px-4 py-24" style={{ borderTop: '1px solid #26262e30' }}>
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black mb-4" style={{ color: '#f8fafc' }}>Meet Your AI Workforce</h2>
            <p className="opacity-50 max-w-xl mx-auto">Six specialized agents ready to deploy. Each one gives the platform a clear personality and a real job.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {AGENTS.map(a => (
              <Link
                key={a.name}
                href={a.href}
                className="group p-5 rounded-xl border transition-all hover:translate-y-[-2px]"
                style={{ backgroundColor: '#12121a', borderColor: '#26262e' }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{a.icon}</span>
                  <div>
                    <div className="font-bold text-sm" style={{ color: '#f8fafc' }}>{a.name}</div>
                    <div className="text-[10px] uppercase tracking-wider font-bold opacity-40">{a.role}</div>
                  </div>
                  <span className="ml-auto w-2 h-2 rounded-full" style={{ backgroundColor: a.color, boxShadow: `0 0 6px ${a.color}` }} />
                </div>
                <p className="text-xs opacity-60 leading-relaxed">{a.desc}</p>
              </Link>
            ))}
          </div>

          <div className="text-center mt-10">
            <Link href="/agents" className="inline-flex items-center gap-2 text-sm font-bold opacity-60 hover:opacity-100 transition-all">
              View All Agents <ChevronRight size={14} />
            </Link>
          </div>
        </div>
      </section>

      {/* Audience */}
      <section className="px-4 py-18" style={{ borderTop: '1px solid #26262e30' }}>
        <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.2fr_0.8fr] gap-6 items-stretch">
          <div className="rounded-3xl border p-8 md:p-10" style={{ backgroundColor: '#12121a', borderColor: '#26262e' }}>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[11px] font-bold mb-5" style={{ backgroundColor: '#6366f115', color: '#93c5fd' }}>
              <Users size={12} /> Built for creators, teams, and solo builders
            </div>
            <h2 className="text-3xl md:text-4xl font-black mb-4" style={{ color: '#f8fafc' }}>
              One site, three jobs: impress, onboard, and convert.
            </h2>
            <p className="opacity-55 max-w-2xl leading-relaxed">
              The best upgrade here is clarity. Visitors should instantly know what this site does, who it is for, and what to do next. This section helps the page feel less like a dump of features and more like a product with a point of view.
            </p>
          </div>
          <div className="grid gap-4">
            <div className="rounded-3xl border p-6" style={{ backgroundColor: '#12121a', borderColor: '#26262e' }}>
              <div className="flex items-center gap-3 mb-3">
                <Rocket size={18} className="text-cyan-300" />
                <h3 className="font-bold" style={{ color: '#f8fafc' }}>Best first click</h3>
              </div>
              <p className="text-sm opacity-55 leading-relaxed">
                Take people straight to <span className="font-bold text-slate-100">Studio</span> if they want to build, or <span className="font-bold text-slate-100">Agents</span> if they want to explore.
              </p>
            </div>
            <div className="rounded-3xl border p-6" style={{ backgroundColor: '#12121a', borderColor: '#26262e' }}>
              <div className="flex items-center gap-3 mb-3">
                <Shield size={18} className="text-emerald-300" />
                <h3 className="font-bold" style={{ color: '#f8fafc' }}>Trust signal</h3>
              </div>
              <p className="text-sm opacity-55 leading-relaxed">
                Keep the “no credit card” and “cancel anytime” line, but make it feel like a real product promise instead of a generic badge row.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-24" style={{ borderTop: '1px solid #26262e30' }}>
        <div className="max-w-3xl mx-auto text-center p-12 rounded-xl border relative overflow-hidden" style={{ backgroundColor: '#12121a', borderColor: '#26262e' }}>
          <div className="absolute inset-0 pointer-events-none opacity-10" style={{ background: 'radial-gradient(circle at 50% 50%, #6366f1, transparent 70%)' }} />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-black mb-4" style={{ color: '#f8fafc' }}>Ready to Build?</h2>
            <p className="opacity-50 mb-8 max-w-lg mx-auto">Join 50,000+ creators already building with LiTTree Lab Studios. Start free — no credit card required.</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/sign-up" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold transition-all hover:scale-105" style={{ backgroundColor: '#6366f1', color: '#fff' }}>
                Get Started Free <ArrowRight size={16} />
              </Link>
              <Link href="/studio" className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold border transition-all hover:bg-white/5" style={{ borderColor: '#26262e' }}>
                Explore Studio
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function HomePage() {
  const { isSignedIn: supabaseSignedIn } = useSupabaseAuthHook();
  const { isSignedIn: clerkSignedIn } = useClerkAuth();
  const router = useRouter();

  useEffect(() => {
    if (supabaseSignedIn || clerkSignedIn) {
      router.replace('/dashboard');
    }
  }, [supabaseSignedIn, clerkSignedIn, router]);

  return <LandingPage />;
}
