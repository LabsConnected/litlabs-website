'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useTheme } from '@/context/ThemeContext';
import { useClerkAuth } from '@/hooks/useClerkAuth';
import { Zap, ShoppingBag, Bot, Sparkles, Shield, BarChart3 } from 'lucide-react';

const FEATURES = [
  { icon: Bot, title: 'AI Agents', desc: 'Deploy specialized agents for coding, marketing, research, and more.' },
  { icon: Sparkles, title: 'Studio Tools', desc: 'Generate images, videos, music, and content with AI.' },
  { icon: Zap, title: 'Automation', desc: 'Chain agents into workflows that run end-to-end.' },
  { icon: ShoppingBag, title: 'Marketplace', desc: 'Buy, sell, and share agents. Earn LitCoins.' },
  { icon: BarChart3, title: 'Analytics', desc: 'Real-time monitoring and performance insights.' },
  { icon: Shield, title: 'Secure', desc: 'Clerk auth, Supabase backend, Stripe payments.' },
];

export default function LandingPage() {
  const { resolvedColors: C } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();

  /* Show loading state during auth init (matches SSR output to avoid hydration mismatch) */
  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.bgColor }}>
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">⚡</div>
          <div className="text-sm font-bold opacity-60" style={{ color: C.textColor }}>Loading...</div>
        </div>
      </div>
    );
  }

  if (isSignedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.bgColor }}>
        <div className="text-center space-y-5">
          <div className="text-4xl">🚀</div>
          <h1 className="text-2xl font-black" style={{ color: C.headerColor }}>Welcome Back</h1>
          <p className="text-sm opacity-60" style={{ color: C.textColor }}>Your studio is ready.</p>
          <div className="flex gap-3 justify-center">
            <Link href="/studio" className="px-6 py-3 rounded-lg text-sm font-bold" style={{ background: C.linkColor, color: '#000' }}>
              Open Studio →
            </Link>
            <Link href="/marketplace" className="px-6 py-3 rounded-lg text-sm font-bold border" style={{ borderColor: C.borderColor, color: C.textColor }}>
              Marketplace
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: C.bgColor, color: C.textColor }}>
      <div className="fixed inset-0 pointer-events-none z-0" style={{
        background: `radial-gradient(ellipse 80% 50% at 50% 0%, ${C.linkColor}12 0%, transparent 60%)`,
      }} />

      <main className="relative z-10">
        {/* HERO */}
        <div className="max-w-6xl mx-auto px-6 pt-24 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-bold mb-8" style={{ backgroundColor: C.accentColor + '15', border: `1px solid ${C.accentColor}30`, color: C.accentColor }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: C.accentColor }} />
            BETA — Free while we build
          </div>

          <h1 className="text-5xl sm:text-6xl font-black leading-tight tracking-tight mb-6">
            <span style={{ color: C.textColor }}>Your </span>
            <span style={{ color: C.headerColor }}>AI Workforce</span>
            <br />
            <span style={{ color: C.textColor }}>is Ready</span>
          </h1>

          <p className="text-lg max-w-xl mx-auto mb-8 leading-relaxed" style={{ color: C.textColor + 'b0' }}>
            Build, deploy, and manage custom AI agents in one platform.
            Automate workflows, generate content, and scale your creativity.
          </p>

          <div className="flex flex-wrap gap-3 justify-center">
            <Link href="/sign-up" className="px-8 py-3.5 rounded-lg text-sm font-bold" style={{ background: `linear-gradient(135deg, ${C.linkColor}, ${C.headerColor})`, color: '#000' }}>
              Start Free — No Card Needed
            </Link>
            <Link href="/studio" className="px-8 py-3.5 rounded-lg text-sm font-bold border" style={{ borderColor: C.borderColor, color: C.textColor }}>
              Open Studio
            </Link>
          </div>

          <div className="flex flex-wrap justify-center gap-8 mt-10 pt-8" style={{ borderTop: `1px solid ${C.borderColor}20` }}>
            {[{ val: '8', label: 'AI Agents' }, { val: '∞', label: 'Free Coins' }, { val: '0$', label: 'During Beta' }].map(s => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-black" style={{ color: C.linkColor }}>{s.val}</div>
                <div className="text-[10px] uppercase tracking-widest opacity-50">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* FEATURES */}
        <div className="max-w-6xl mx-auto px-6 py-16" style={{ borderTop: `1px solid ${C.borderColor}15` }}>
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-black mb-3">Everything You Need</h2>
            <p className="text-sm opacity-60 max-w-md mx-auto">One platform. Unlimited agents. Total creative control.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f, i) => (
              <div key={i} className="rounded-xl p-6 transition hover:-translate-y-1" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}20` }}>
                <f.icon size={24} style={{ color: C.linkColor }} className="mb-4" />
                <h3 className="font-bold text-sm mb-1.5">{f.title}</h3>
                <p className="text-xs leading-relaxed opacity-60">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* PRICING */}
        <div className="max-w-5xl mx-auto px-6 py-16" style={{ borderTop: `1px solid ${C.borderColor}15` }}>
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-black mb-3">Simple Pricing</h2>
            <p className="text-sm opacity-60">Free during beta. Lock in your founding rate.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { name: 'Beta', price: 'Free', features: ['8 AI Agents', 'Unlimited Coins', 'Studio Tools', 'Community'], cta: 'Start Free', highlight: false },
              { name: 'Pro', price: '$9/mo', features: ['All Beta features', 'Priority AI', 'API Access', 'Custom Slugs'], cta: 'Join Waitlist', highlight: true },
              { name: 'Team', price: '$29/mo', features: ['All Pro features', 'Multi-user', 'Analytics', 'White-label'], cta: 'Join Waitlist', highlight: false },
            ].map(p => (
              <div key={p.name} className="rounded-2xl p-6 flex flex-col relative" style={{ backgroundColor: p.highlight ? C.linkColor + '10' : C.boxBg, border: `2px solid ${p.highlight ? C.linkColor : C.borderColor}30` }}>
                {p.highlight && <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold px-3 py-0.5 rounded-full" style={{ backgroundColor: C.linkColor, color: '#000' }}>POPULAR</div>}
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-50">{p.name}</div>
                <div className="text-3xl font-black mb-4">{p.price}</div>
                <ul className="space-y-2 flex-1 mb-5">
                  {p.features.map(f => (
                    <li key={f} className="flex items-center gap-2 text-xs opacity-80"><span style={{ color: C.linkColor }}>✓</span> {f}</li>
                  ))}
                </ul>
                <Link href="/sign-up" className="block text-center text-xs font-bold py-2.5 rounded-lg" style={{ backgroundColor: p.highlight ? C.linkColor : 'transparent', color: p.highlight ? '#000' : C.linkColor, border: `1px solid ${C.linkColor}40` }}>
                  {p.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>

        {/* FOOTER CTA */}
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <div className="rounded-2xl p-10" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}20` }}>
            <h2 className="text-2xl font-black mb-3">Ready to Build?</h2>
            <p className="text-sm opacity-60 mb-6 max-w-md mx-auto">Join today — free while in beta. Get 500 LitCoins and full studio access.</p>
            <Link href="/sign-up" className="inline-block px-10 py-4 rounded-lg text-sm font-black" style={{ background: `linear-gradient(135deg, ${C.linkColor}, ${C.headerColor})`, color: '#000' }}>
              Get Started — It&apos;s Free
            </Link>
            <p className="text-[11px] mt-4 opacity-30">No credit card · Cancel anytime</p>
          </div>
        </div>
      </main>
    </div>
  );
}
