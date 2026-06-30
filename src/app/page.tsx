"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useSupabaseAuthHook } from '@/hooks/useSupabaseAuth';
import { useClerkAuth } from '@/hooks/useClerkAuth';
import { Code2, Bot, BarChart3, Shield, ArrowRight, Check, Globe, Coins, Music, ImageIcon, Users, ShoppingBag, ChevronRight } from 'lucide-react';

const FEATURES = [
  { icon: Bot, title: 'Specialized AI Agents', desc: 'Deploy purpose-built agents for coding, writing, data analysis, social growth, and more. Each agent is finely tuned for its domain.' },
  { icon: Code2, title: 'No-Code Workflow Builder', desc: 'Build complex multi-agent pipelines with a visual drag-and-drop interface. No coding required — just connect and deploy.' },
  { icon: BarChart3, title: 'Real-Time Analytics', desc: 'Monitor agent performance, user engagement, and system metrics with live dashboards and actionable insights.' },
  { icon: Coins, title: 'Token Economy', desc: 'Earn LitCoins through platform activity. Use them to unlock premium agents, features, and marketplace listings.' },
  { icon: Globe, title: 'Social Engine', desc: 'Built-in social feed, comments, and community features. Share your creations and discover what others are building.' },
  { icon: Shield, title: 'Enterprise Security', desc: 'Enterprise-grade security with Clerk auth, encrypted data, and role-based access control. Your data stays yours.' },
];

const AGENTS = [
  { icon: '🎯', name: 'Director', role: 'Orchestrator', desc: 'Routes tasks across your agent workforce. The brain of your operation.', color: '#00ffff', href: '/dashboard?app=jarvis' },
  { icon: '💻', name: 'Forge', role: 'Engineer', desc: 'Writes, debugs, and reviews code. TypeScript, Next.js & Supabase specialist.', color: '#00ff41', href: '/studio?tool=agents' },
  { icon: '�', name: 'Pulse', role: 'Growth', desc: 'Plans content, schedules posts, and grows your audience.', color: '#ff6b6b', href: '/studio?tool=agents' },
  { icon: '🎨', name: 'Pixel Forge', role: 'Creative', desc: 'Visual creative — images, brand identity, UI/UX, and art direction.', color: '#ff9ff3', href: '/studio?tool=image' },
  { icon: '📊', name: 'Data Slayer', role: 'Analytics', desc: 'Crunch numbers, find patterns, build dashboards.', color: '#ffff00', href: '/studio?tool=agents' },
  { icon: '✍️', name: 'Writer', role: 'Content', desc: 'Crafts copy, stories, and marketing content.', color: '#a78bfa', href: '/studio?tool=agents' },
];

const FEATURE_PILLS = [
  { icon: Bot, label: 'AI Agents', href: '#features' },
  { icon: Music, label: 'Music & Radio', href: '#features' },
  { icon: ImageIcon, label: 'Studio', href: '/studio' },
  { icon: Users, label: 'Community', href: '/social' },
  { icon: ShoppingBag, label: 'Marketplace', href: '/marketplace' },
];

function AnimatedStat({ value, label }: { value: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [displayed, setDisplayed] = useState('0');
  const hasRun = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasRun.current) {
          hasRun.current = true;
          const numeric = parseFloat(value.replace(/[^0-9.]/g, ''));
          const suffix = value.replace(/[0-9.,]/g, '');
          const duration = 1200;
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min((now - start) / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            const current = numeric * ease;
            setDisplayed(
              current >= 1000
                ? `${(current / 1000).toFixed(current >= 10000 ? 0 : 1)}K${suffix}`
                : `${Math.round(current)}${suffix}`,
            );
            if (progress < 1) requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div ref={ref}>
      <div className="text-3xl md:text-4xl font-black mb-1" style={{ color: '#f8fafc' }}>{displayed}</div>
      <div className="text-xs uppercase tracking-widest opacity-40 font-bold">{label}</div>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#08080c', color: '#e2e2e9' }}>
      {/* Hero */}
      <section className="relative px-4 pt-20 pb-24 md:pt-32 md:pb-32 text-center overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #6366f140 0%, transparent 70%)', filter: 'blur(60px)' }} />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 rounded-full opacity-20" style={{ background: 'radial-gradient(circle, #3b82f640 0%, transparent 70%)', filter: 'blur(60px)' }} />
        </div>

        <div className="relative max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold mb-8 border" style={{ borderColor: '#26262e', backgroundColor: '#12121a' }}>
            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            v2.0 — Now in Public Beta
          </div>

          <h1 className="text-4xl md:text-7xl font-black tracking-tight mb-6 leading-tight" style={{ color: '#f8fafc' }}>
            Your Creative OS{' '}
            <span className="bg-clip-text text-transparent" style={{ backgroundImage: 'linear-gradient(135deg, #6366f1, #3b82f6)' }}>
              — AI agents, studio, music & community
            </span>
          </h1>

          <p className="text-lg md:text-xl mb-8 max-w-2xl mx-auto opacity-70 leading-relaxed">
            Create images and music, run AI agents, build your gallery, and connect with other creators — all from one dashboard built for the modern creative.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
            {FEATURE_PILLS.map(p => {
              const Icon = p.icon;
              return (
                <Link
                  key={p.label}
                  href={p.href}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all hover:scale-105"
                  style={{ backgroundColor: '#12121a', borderColor: '#6366f140', color: '#a5b4fc' }}
                >
                  <Icon size={12} /> {p.label}
                </Link>
              );
            })}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold transition-all hover:scale-105"
              style={{ backgroundColor: '#6366f1', color: '#fff', boxShadow: '0 0 30px #6366f130' }}
            >
              Start Creating Free <ArrowRight size={16} />
            </Link>
            <Link
              href="#features"
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl text-sm font-bold border transition-all hover:bg-white/5"
              style={{ borderColor: '#26262e' }}
            >
              See What&apos;s Inside
            </Link>
          </div>

          <div className="flex items-center justify-center gap-6 mt-10 text-xs opacity-50">
            <span className="flex items-center gap-1.5"><Check size={12} style={{ color: '#10b981' }} /> No credit card</span>
            <span className="flex items-center gap-1.5"><Check size={12} style={{ color: '#10b981' }} /> 500 free credits</span>
            <span className="flex items-center gap-1.5"><Check size={12} style={{ color: '#10b981' }} /> Cancel anytime</span>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="px-4 py-16" style={{ borderTop: '1px solid #26262e30', borderBottom: '1px solid #26262e30' }}>
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { label: 'Active Agents', value: '10420+' },
            { label: 'Total Users', value: '52891+' },
            { label: 'Tasks Completed', value: '2400000+' },
            { label: 'LitCoins Earned', value: '150000+' },
          ].map(s => (
            <AnimatedStat key={s.label} value={s.value} label={s.label} />
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-4 py-24" id="features">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-5xl font-black mb-4" style={{ color: '#f8fafc' }}>Everything You Need</h2>
            <p className="opacity-50 max-w-xl mx-auto">A complete platform for building, deploying, and scaling AI agents — from ideation to production.</p>
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
              { step: '02', title: 'Customize & Deploy', desc: "Configure your agent's behavior, knowledge base, and tools. Deploy with one click to any workspace." },
              { step: '03', title: 'Scale & Earn', desc: 'Monitor performance, iterate, and publish to the marketplace. Earn LitCoins as others use your agents.' },
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
            <p className="opacity-50 max-w-xl mx-auto">Six specialized agents ready to deploy. Each one is a domain expert.</p>
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
