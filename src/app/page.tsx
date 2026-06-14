'use client';
export const dynamic = 'force-dynamic';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { useClerkAuth } from '@/hooks/useClerkAuth';
import { useProfile } from '@/context/ProfileContext';
import SocialFeed from '@/components/SocialFeed';
import {
  Zap, ShoppingBag, Bot, Sparkles, Shield, BarChart3, ArrowRight,
  Wand2, Workflow, Globe, Star, Image as ImageIcon, Film, Music,
  MessageCircle, Settings, Coins, ChevronRight,
  Flame, Layers, Rocket, Activity, Code, FileText, AlertCircle,
  ExternalLink, Save, Users, Loader2, Plus
} from 'lucide-react';

const FEATURES = [
  { icon: Bot, title: 'AI Agents', desc: 'Deploy specialized agents for coding, marketing, research, and more.' },
  { icon: Sparkles, title: 'Studio Tools', desc: 'Generate images, videos, music, and content with AI.' },
  { icon: Zap, title: 'Automation', desc: 'Chain agents into workflows that run end-to-end.' },
  { icon: ShoppingBag, title: 'Marketplace', desc: 'Buy, sell, and share agents. Earn LitCoins.' },
  { icon: BarChart3, title: 'Analytics', desc: 'Real-time monitoring and performance insights.' },
  { icon: Shield, title: 'Secure', desc: 'Clerk auth, Supabase backend, Stripe payments.' },
];

const STEPS = [
  { num: '01', icon: Wand2, title: 'Build Your Agent', desc: 'Pick a role, set a prompt, and configure your agent in seconds. No code required.' },
  { num: '02', icon: Workflow, title: 'Deploy & Automate', desc: 'Chain agents into pipelines. Schedule tasks, trigger webhooks, or run on-demand.' },
  { num: '03', icon: Globe, title: 'Scale & Monetize', desc: 'Publish to the marketplace, sell to others, or scale across your team with analytics.' },
];

const TESTIMONIALS = [
  { name: 'Alex K.', role: 'Indie Developer', text: 'I built 6 agents in one afternoon. The studio is stupid fast.' },
  { name: 'Maya R.', role: 'Content Creator', text: 'My writing agent drafts blog posts while I sleep. Game changer.' },
  { name: 'Jon D.', role: 'Startup Founder', text: 'We replaced 3 SaaS tools with LiTree agents. Saved $400/mo.' },
];

// Fixed professional dark palette
interface Palette {
  bgColor: string; textColor: string; linkColor: string; headerColor: string;
  borderColor: string; accentColor: string; boxBg: string; textMuted?: string;
}
const C: Palette = {
  bgColor: '#1a1210',      // volcanic dark brown
  textColor: '#f0d8cc',    // volcanic text
  textMuted: '#a1a1aa',
  linkColor: '#f87171',    // volcanic red-orange
  headerColor: '#fca5a5',  // volcanic lighter accent
  borderColor: '#4a2520',  // volcanic border
  accentColor: '#ef4444',   // volcanic red
  boxBg: '#251a15',        // volcanic card bg
};

/* Enhanced background with all AI-generated style wallpapers */
import { getWallpaperById, WallpaperId } from '@/lib/wallpapers';

function AnimatedBackground({ wallpaper = 'mesh', customUrl }: { wallpaper?: WallpaperId; customUrl?: string | null }) {
  // Custom wallpaper image
  if (wallpaper === 'custom' && customUrl) {
    return (
      <div className="fixed inset-0 pointer-events-none z-0"
        style={{ backgroundImage: `url(${customUrl})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }} />
    );
  }

  // Get wallpaper config
  const wp = getWallpaperById(wallpaper);
  
  // Special handling for animated mesh
  if (wallpaper === 'mesh') {
    return (
      <>
        <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" style={{ backgroundColor: '#1a1210' }}>
          {/* Mesh blobs - volcanic ember colors */}
          <div className="absolute top-[-10%] left-[-10%] w-[60vw] h-[60vw] rounded-full opacity-[0.06] animate-mesh-blob-1"
            style={{ background: 'radial-gradient(circle, #f87171 0%, transparent 60%)', filter: 'blur(80px)' }} />
          <div className="absolute top-[20%] right-[-15%] w-[50vw] h-[50vw] rounded-full opacity-[0.05] animate-mesh-blob-2"
            style={{ background: 'radial-gradient(circle, #fca5a5 0%, transparent 60%)', filter: 'blur(80px)' }} />
          <div className="absolute bottom-[-10%] left-[20%] w-[55vw] h-[40vw] rounded-full opacity-[0.04] animate-mesh-blob-3"
            style={{ background: 'radial-gradient(circle, #ef4444 0%, transparent 60%)', filter: 'blur(80px)' }} />
          {/* Dot grid */}
          <div className="absolute inset-0 opacity-[0.025]"
            style={{ backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.4) 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
        </div>
        <style jsx>{`
          @keyframes mesh-blob-1 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(30px,-50px) scale(1.1)} 66%{transform:translate(-20px,20px) scale(0.95)} }
          @keyframes mesh-blob-2 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(-40px,30px) scale(1.05)} 66%{transform:translate(20px,-40px) scale(0.9)} }
          @keyframes mesh-blob-3 { 0%,100%{transform:translate(0,0) scale(1)} 33%{transform:translate(50px,20px) scale(1.08)} 66%{transform:translate(-30px,-30px) scale(0.92)} }
          .animate-mesh-blob-1 { animation: mesh-blob-1 20s ease-in-out infinite; }
          .animate-mesh-blob-2 { animation: mesh-blob-2 25s ease-in-out infinite; }
          .animate-mesh-blob-3 { animation: mesh-blob-3 18s ease-in-out infinite; }
        `}</style>
      </>
    );
  }

  // Use wallpaper fullStyle
  return (
    <div className="fixed inset-0 pointer-events-none z-0" style={wp.fullStyle} />
  );
}

/* Scroll-triggered fade-in */
function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return { ref, visible };
}

const COIN_PACKS = [
  { coins: '1,000', amount: 199, price: '$1.99', best: false },
  { coins: '2,500', amount: 499, price: '$4.99', best: false },
  { coins: '6,000', amount: 999, price: '$9.99', best: true },
  { coins: '15,000', amount: 1999, price: '$19.99', best: false },
];

/* ------------------------------------------------------------------ */
/*  Social Feed Dashboard                                              */
/* ------------------------------------------------------------------ */
function SocialDashboard({ C, QUICK_ACTIONS, AGENTS, walletBalance, agentCount, isLoading }: { C: Palette; QUICK_ACTIONS: any[]; AGENTS: any[]; walletBalance: number | null; agentCount: number | null; isLoading: boolean }) {
  const { profile, updateProfile } = useProfile();
  const displayName = profile?.displayName || 'Builder';
  const username = displayName.toLowerCase().replace(/\s+/g, '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (data.url) updateProfile({ avatarUrl: data.url });
    } catch { /* ignore */ }
    setUploadingAvatar(false);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const navLinks = [
    { label: 'Studio', href: '/studio', icon: Zap, color: C.linkColor },
    { label: 'Gallery', href: '/gallery', icon: Sparkles, color: '#f472b6' },
    { label: 'Market', href: '/marketplace', icon: ShoppingBag, color: '#fbbf24' },
    { label: 'Settings', href: '/settings', icon: Settings, color: C.textMuted },
  ];

  return (
    <main className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-6 pt-6 pb-16">
      {/* Three-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr_280px] gap-8">

        {/* ── LEFT SIDEBAR ── */}
        <aside className="hidden xl:block space-y-4">
          {/* Enhanced Profile Card */}
          <div className="rounded-2xl p-5 relative overflow-hidden" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}30` }}>
            {/* Cover gradient */}
            <div className="absolute top-0 left-0 right-0 h-28 opacity-20" style={{ background: `linear-gradient(135deg, ${profile.accentColor || C.accentColor}, ${C.headerColor})` }} />
            
            <div className="relative z-10">
              {/* Avatar + Status */}
              <div className="flex items-start justify-between mb-3">
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="relative w-16 h-16 rounded-xl border-2 overflow-hidden group transition-all hover:scale-105 shadow-lg"
                  style={{ borderColor: (profile.accentColor || C.accentColor) + '50' }}
                  title="Change avatar"
                >
                  {profile?.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl font-black" style={{ background: `linear-gradient(135deg, ${(profile.accentColor || C.accentColor)}20, ${(profile.accentColor || C.accentColor)}40)`, color: profile.accentColor || C.accentColor }}>
                      {displayName.charAt(0)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-sm">📷</span>
                  </div>
                  {uploadingAvatar && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <Loader2 size={20} className="animate-spin text-white" />
                    </div>
                  )}
                </button>
                
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-bold"
                  style={{ backgroundColor: '#22c55e' + '15', color: '#22c55e', border: `1px solid ${'#22c55e'}30` }}>
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#22c55e' }} /> Online
                </div>
              </div>
              
              <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
              
              {/* User Info */}
              <div className="mb-4">
                <div className="text-base font-black mb-0.5" style={{ color: C.textColor }}>{displayName}</div>
                <div className="text-[11px] opacity-50 flex items-center gap-1">
                  @{username}
                  {profile.mood && <span className="opacity-60">· {profile.mood}</span>}
                </div>
              </div>
              
              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-xl" style={{ backgroundColor: C.bgColor + '60' }}>
                {[
                  { label: 'Agents', val: isLoading ? '—' : agentCount ?? '0', icon: Bot },
                  { label: 'Coins', val: isLoading ? '—' : walletBalance !== null ? walletBalance.toLocaleString() : '0', icon: Coins },
                  { label: 'Streak', val: '🔥 Today', icon: Flame },
                ].map(s => (
                  <div key={s.label} className="text-center">
                    <div className="text-sm font-black mb-0.5" style={{ color: profile.accentColor || C.accentColor }}>{s.val}</div>
                    <div className="text-[9px] opacity-40 uppercase tracking-wider">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Quick Actions Grid */}
          <div className="rounded-2xl p-4" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}20` }}>
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-3 flex items-center gap-2">
              <Zap size={10} /> Quick Launch
            </div>
            <div className="grid grid-cols-2 gap-2">
              {QUICK_ACTIONS.map(a => (
                <Link key={a.label} href={a.href} className="flex items-center gap-2 p-2.5 rounded-xl transition-all hover:scale-[1.02] group"
                  style={{ backgroundColor: C.bgColor + '60', border: `1px solid ${C.borderColor}15` }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-110" style={{ backgroundColor: a.color + '15' }}>
                    <a.icon size={14} style={{ color: a.color }} />
                  </div>
                  <span className="text-[11px] font-medium opacity-70 group-hover:opacity-100">{a.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Trending Agents */}
          <div className="rounded-2xl p-4" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}20` }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Flame size={12} style={{ color: C.accentColor }} />
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">Trending</span>
              </div>
              <Link href="/agents" className="text-[9px] opacity-50 hover:opacity-100" style={{ color: C.linkColor }}>View All</Link>
            </div>
            <div className="space-y-2">
              {AGENTS.slice(0, 4).map((a, i) => (
                <Link key={a.name} href={`/agents/${a.id || a.name.toLowerCase().replace(/\s+/g, '-')}`} className="flex items-center gap-2.5 group p-1.5 rounded-lg hover:bg-white/[0.03] transition-all">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0" style={{ backgroundColor: a.color + '15', border: `1px solid ${a.color}30` }}>{a.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: C.textColor }}>{a.name}</div>
                    <div className="text-[9px] opacity-40">{a.tag}</div>
                  </div>
                  <div className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ color: a.color, backgroundColor: a.color + '12' }}>
                    {12 - i * 3}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </aside>

        {/* ── CENTER FEED ── */}
        <section className="min-w-0">
          {/* Mobile profile bar */}
          <div className="xl:hidden flex items-center gap-3 mb-4 p-3 rounded-xl" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}20` }}>
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="relative w-10 h-10 rounded-full overflow-hidden shrink-0 group"
              title="Change avatar"
            >
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt={displayName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-sm font-black" style={{ backgroundColor: C.accentColor + '15', color: C.accentColor }}>
                  {displayName.charAt(0)}
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-xs">📷</span>
              </div>
            </button>
            <div className="min-w-0">
              <div className="text-sm font-bold" style={{ color: C.textColor }}>{displayName}</div>
              <div className="text-[10px] opacity-40">@{username}</div>
            </div>
            <div className="ml-auto flex gap-3 text-center">
              <div><div className="text-xs font-black" style={{ color: C.accentColor }}>{isLoading ? '—' : agentCount ?? '0'}</div><div className="text-[9px] opacity-40">Agents</div></div>
              <div><div className="text-xs font-black" style={{ color: C.accentColor }}>{isLoading ? '—' : walletBalance !== null ? walletBalance.toLocaleString() : '0'}</div><div className="text-[9px] opacity-40">Coins</div></div>
            </div>
          </div>

          {/* Feed */}
          <SocialFeed embedded />
        </section>

        {/* ── RIGHT SIDEBAR ── APPS & WIDGETS DASHBOARD */}
        <aside className="hidden xl:block space-y-4">
          {/* Wallet Widget */}
          <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${C.boxBg}, ${(profile.accentColor || C.accentColor)}08)`, border: `1px solid ${C.borderColor}30` }}>
            <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-[0.08] pointer-events-none" style={{ background: `radial-gradient(circle, ${profile.accentColor || C.accentColor} 0%, transparent 70%)`, transform: 'translate(40%, -40%)' }} />
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: (profile.accentColor || C.accentColor) + '15' }}>
                    <Coins size={16} style={{ color: profile.accentColor || C.accentColor }} />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider opacity-40">Balance</div>
                    <div className="text-xl font-black" style={{ color: profile.accentColor || C.accentColor }}>{isLoading ? '...' : walletBalance !== null ? walletBalance.toLocaleString() : '0'}</div>
                  </div>
                </div>
                <Link href="/marketplace" className="p-2 rounded-lg transition-all hover:scale-110" style={{ backgroundColor: (profile.accentColor || C.accentColor) + '12' }}>
                  <Plus size={14} style={{ color: profile.accentColor || C.accentColor }} />
                </Link>
              </div>
              <div className="text-[10px] opacity-50 mb-3">LiTBit Coins available</div>
              <div className="flex gap-2">
                <Link href="/marketplace" className="flex-1 py-2 rounded-lg text-[10px] font-bold text-center transition-all hover:scale-[1.02]"
                  style={{ backgroundColor: (profile.accentColor || C.accentColor), color: C.bgColor }}>
                  Top Up
                </Link>
                <button className="px-3 py-2 rounded-lg text-[10px] font-bold border transition-all hover:scale-[1.02]"
                  style={{ borderColor: C.borderColor, color: C.textMuted }}>
                  History
                </button>
              </div>
            </div>
          </div>

          {/* System Status Widget */}
          <div className="rounded-2xl p-4" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}20` }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity size={12} style={{ color: '#22c55e' }} />
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">System Status</span>
              </div>
              <span className="flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: '#22c55e' + '15', color: '#22c55e' }}>
                <span className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: '#22c55e' }} /> Operational
              </span>
            </div>
            <div className="space-y-2">
              {[
                { name: 'AI Models', status: 'Online', color: '#22c55e' },
                { name: 'Image Gen', status: 'Online', color: '#22c55e' },
                { name: 'Agent Chat', status: 'Online', color: '#22c55e' },
                { name: 'Marketplace', status: 'Online', color: '#22c55e' },
              ].map(s => (
                <div key={s.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg" style={{ backgroundColor: C.bgColor + '40' }}>
                  <span className="text-[11px] opacity-70">{s.name}</span>
                  <span className="flex items-center gap-1 text-[9px] font-medium" style={{ color: s.color }}>
                    <span className="w-1 h-1 rounded-full" style={{ backgroundColor: s.color }} /> {s.status}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Active Agents Widget */}
          <div className="rounded-2xl p-4" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}20` }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bot size={12} style={{ color: C.linkColor }} />
                <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">Active Agents</span>
              </div>
              <span className="text-[9px] px-2 py-0.5 rounded-full font-bold" style={{ backgroundColor: C.linkColor + '15', color: C.linkColor }}>
                {AGENTS.length} Online
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {AGENTS.map(a => (
                <Link key={a.name} href={`/agents/${a.id || a.name.toLowerCase().replace(/\s+/g, '-')}`} 
                  className="flex flex-col items-center gap-1 p-2 rounded-lg transition-all hover:scale-110 group"
                  style={{ backgroundColor: a.color + '10' }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ backgroundColor: a.color + '20', border: `1px solid ${a.color}30` }}>
                    {a.icon}
                  </div>
                  <span className="text-[8px] opacity-60 text-center truncate w-full group-hover:opacity-100">{a.name.split(' ')[0]}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Quick Stats Widget */}
          <div className="rounded-2xl p-4" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}20` }}>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={12} style={{ color: C.headerColor }} />
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">Your Activity</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'Agents', val: isLoading ? '—' : agentCount ?? '0', icon: Bot },
                { label: 'Coins', val: isLoading ? '—' : walletBalance?.toLocaleString() ?? '0', icon: Coins },
                { label: 'Following', val: '—', icon: Users },
                { label: 'Saved', val: '—', icon: Save },
              ].map(stat => (
                <div key={stat.label} className="p-2.5 rounded-xl" style={{ backgroundColor: C.bgColor + '40' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <stat.icon size={10} style={{ color: C.textMuted }} />
                    <span className="text-[9px] opacity-50">{stat.label}</span>
                  </div>
                  <div className="text-lg font-black" style={{ color: C.textColor }}>{stat.val}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Resources Links */}
          <div className="rounded-2xl p-4" style={{ backgroundColor: C.boxBg, border: `1px solid ${C.borderColor}20` }}>
            <div className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-3 flex items-center gap-2">
              <Globe size={10} /> Resources
            </div>
            <div className="space-y-1">
              {[
                { label: 'Documentation', href: '/docs', icon: FileText },
                { label: 'API Reference', href: '/api', icon: Code },
                { label: 'Community Discord', href: '#', icon: MessageCircle },
                { label: 'Report Issue', href: '#', icon: AlertCircle },
              ].map(link => (
                <Link key={link.label} href={link.href} className="flex items-center gap-2 p-2 rounded-lg transition-all hover:bg-white/[0.03] group">
                  <link.icon size={12} style={{ color: C.textMuted }} className="group-hover:scale-110 transition-transform" />
                  <span className="text-[11px] opacity-60 group-hover:opacity-100">{link.label}</span>
                  <ExternalLink size={10} style={{ color: C.textMuted }} className="ml-auto opacity-0 group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/*  Landing Page                                                       */
/* ------------------------------------------------------------------ */
export default function LandingPage() {
  const { isLoaded, isSignedIn, userId } = useClerkAuth();
  const { profile } = useProfile();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [agentCount, setAgentCount] = useState<number | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const heroReveal = useReveal();
  const featReveal = useReveal();
  const stepsReveal = useReveal();
  const testReveal = useReveal();
  const priceReveal = useReveal();
  const ctaReveal = useReveal();

  const QUICK_ACTIONS = [
    { icon: ImageIcon, label: 'Image', href: '/studio?tool=image', color: '#818cf8', desc: 'Generate AI art' },
    { icon: Film, label: 'Video', href: '/studio?tool=video', color: '#f472b6', desc: 'Create motion' },
    { icon: Music, label: 'Audio', href: '/studio?tool=audio', color: '#a78bfa', desc: 'Sound & music' },
    { icon: Bot, label: 'Agents', href: '/studio?tool=agents', color: '#34d399', desc: 'Chat & build' },
    { icon: MessageCircle, label: 'Social', href: '/social', color: '#fb923c', desc: 'Community feed' },
    { icon: ShoppingBag, label: 'Market', href: '/marketplace', color: '#fbbf24', desc: 'Buy & sell' },
  ];

  const AGENTS = [
    { name: 'Code Champion', icon: '⚡', color: '#818cf8', desc: 'Full-stack dev', tag: 'Code' },
    { name: 'Pixel Forge', icon: '🎨', color: '#f472b6', desc: 'AI image gen', tag: 'Design' },
    { name: 'Growth Hacker', icon: '📈', color: '#34d399', desc: 'Marketing', tag: 'Growth' },
    { name: 'Data Slayer', icon: '📊', color: '#a78bfa', desc: 'Analytics', tag: 'Data' },
  ];

  const buyPack = async (pack: typeof COIN_PACKS[0]) => {
    if (!isSignedIn || !userId) {
      window.location.href = '/sign-up';
      return;
    }
    setCheckoutLoading(pack.coins);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'payment',
          priceData: {
            amount: pack.amount,
            currency: 'usd',
            name: `${pack.coins} LiTBit Coins`,
            description: `One-time purchase of ${pack.coins} LiTBit Coins for LiTree Studio`,
          },
          metadata: { clerk_id: userId, coin_amount: pack.coins.replace(/,/g, '') },
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Checkout failed. Try again.');
      }
    } catch {
      alert('Network error during checkout.');
    } finally {
      setCheckoutLoading(null);
    }
  };

  useEffect(() => {
    if (!isSignedIn) return;
    setDashboardLoading(true);
    Promise.all([
      fetch('/api/wallet').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/user-agents').then(r => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([wallet, agents]) => {
        if (wallet?.balance !== undefined) setWalletBalance(wallet.balance);
        if (agents?.total !== undefined) setAgentCount(agents.total);
      })
      .finally(() => setDashboardLoading(false));
  }, [isSignedIn]);

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

  // Use profile accent color if set
  const accentColor = profile?.accentColor || C.accentColor;
  const C_DYNAMIC = { ...C, accentColor };

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: C.bgColor, color: C.textColor }}>
      <AnimatedBackground wallpaper={profile?.wallpaper} customUrl={profile?.customWallpaperUrl} />

      {isSignedIn ? (
        /* ============= SOCIAL FEED DASHBOARD ============= */
        <SocialDashboard C={C_DYNAMIC} QUICK_ACTIONS={QUICK_ACTIONS} AGENTS={AGENTS} walletBalance={walletBalance} agentCount={agentCount} isLoading={dashboardLoading} />
      ) : (
        /* ============= LOGGED-OUT LANDING ============= */
        <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6">
        {/* HERO */}
        <section className="relative w-full">
          <div ref={heroReveal.ref}
            className={`max-w-6xl mx-auto px-4 sm:px-6 pt-20 sm:pt-28 pb-16 sm:pb-20 text-center transition-all duration-700 ${heroReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            {/* Logo */}
            <div className="relative w-20 h-20 sm:w-24 sm:h-24 mx-auto mb-6 rounded-2xl overflow-hidden" style={{ border: `2px solid ${C.accentColor}30`, boxShadow: `0 0 40px ${C.accentColor}15` }}>
              <Image src="/logo.png" alt="LiTree Lab Studios" fill className="object-contain p-1" unoptimized />
            </div>
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold mb-8"
              style={{ backgroundColor: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', color: '#34d399' }}>
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: '#34d399' }} />
              Now Live — Start Free
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-black leading-[1.1] tracking-tight mb-6">
              <span style={{ color: C.textColor }}>Your </span>
              <span style={{ color: C.headerColor }}>AI Workforce</span>
              <span style={{ color: C.textColor }}> is Ready</span>
            </h1>

            {/* Subheadline */}
            <p className="text-base sm:text-lg max-w-2xl mx-auto mb-10 leading-relaxed px-4" style={{ color: 'rgba(228,228,231,0.6)' }}>
              Build, deploy, and manage custom AI agents in one platform.
              Automate workflows, generate content, and scale your creativity.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center items-center mb-12">
              <Link href="/sign-up" className="group px-8 py-3.5 rounded-lg text-sm font-bold inline-flex items-center gap-2 transition-all hover:scale-[1.02] shadow-lg"
                style={{ background: `linear-gradient(135deg, ${C.linkColor}, ${C.headerColor})`, color: '#000', boxShadow: `0 8px 32px ${C.linkColor}30` }}>
                Get Started Free
                <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link href="/studio" className="px-8 py-3.5 rounded-lg text-sm font-bold border transition-all hover:bg-white/5"
                style={{ borderColor: 'rgba(39,39,42,0.4)', color: C.textColor }}>
                Open Studio
              </Link>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap justify-center gap-6 sm:gap-10 pt-8" style={{ borderTop: '1px solid rgba(39,39,42,0.15)' }}>
              {[
                { val: '10K+', label: 'AI Agents' },
                { val: '50K+', label: 'Users' },
                { val: '2M+', label: 'Tasks Done' },
              ].map(s => (
                <div key={s.label} className="text-center min-w-[80px]">
                  <div className="text-2xl sm:text-3xl font-black" style={{ color: C.linkColor }}>{s.val}</div>
                  <div className="text-[10px] sm:text-xs uppercase tracking-widest opacity-50 mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="w-full" style={{ borderTop: '1px solid rgba(39,39,42,0.1)' }}>
          <div ref={featReveal.ref}
            className={`max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 transition-all duration-700 ${featReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            <div className="text-center mb-12 sm:mb-14">
              <h2 className="text-2xl sm:text-3xl font-black mb-3" style={{ color: C.textColor }}>Everything You Need</h2>
              <p className="text-sm opacity-60 max-w-md mx-auto">One platform. Unlimited agents. Total creative control.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map((f, i) => (
                <div key={i} className="group rounded-xl p-6 transition-all duration-300 hover:-translate-y-1 relative overflow-hidden"
                  style={{ backgroundColor: C.boxBg, border: '1px solid rgba(39,39,42,0.2)' }}>
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                    style={{ background: `radial-gradient(circle at 50% 0%, ${C.linkColor}08, transparent 70%)` }} />
                  <div className="relative z-10">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4 transition-all group-hover:scale-110"
                      style={{ backgroundColor: 'rgba(129,140,248,0.08)' }}>
                      <f.icon size={20} style={{ color: C.linkColor }} />
                    </div>
                    <h3 className="font-bold text-sm mb-2" style={{ color: C.textColor }}>{f.title}</h3>
                    <p className="text-xs leading-relaxed opacity-60">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS */}
        <section className="w-full" style={{ borderTop: '1px solid rgba(39,39,42,0.1)' }}>
          <div ref={stepsReveal.ref}
            className={`max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20 transition-all duration-700 ${stepsReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            <div className="text-center mb-12 sm:mb-14">
              <h2 className="text-2xl sm:text-3xl font-black mb-3" style={{ color: C.textColor }}>How It Works</h2>
              <p className="text-sm opacity-60 max-w-md mx-auto">From idea to deployed agent in minutes.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
              <div className="hidden md:block absolute top-16 left-[16%] right-[16%] h-[1px]" style={{ background: `linear-gradient(90deg, transparent, ${C.linkColor}30, transparent)` }} />
              {STEPS.map((s, i) => (
                <div key={i} className="text-center relative">
                  <div className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center mb-5 relative z-10"
                    style={{ backgroundColor: C.boxBg, border: `1px solid ${C.linkColor}30` }}>
                    <s.icon size={22} style={{ color: C.linkColor }} />
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-2 opacity-40">Step {s.num}</div>
                  <h3 className="font-bold text-sm mb-2" style={{ color: C.textColor }}>{s.title}</h3>
                  <p className="text-xs leading-relaxed opacity-60 max-w-[260px] mx-auto">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TESTIMONIALS */}
        <section className="w-full" style={{ borderTop: '1px solid rgba(39,39,42,0.1)' }}>
          <div ref={testReveal.ref}
            className={`max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20 transition-all duration-700 ${testReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            <div className="text-center mb-12">
              <h2 className="text-2xl sm:text-3xl font-black mb-3" style={{ color: C.textColor }}>Loved by Creators</h2>
              <p className="text-sm opacity-60">Real users. Real workflows. Real results.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {TESTIMONIALS.map((t, i) => (
                <div key={i} className="rounded-xl p-6 relative"
                  style={{ backgroundColor: C.boxBg, border: '1px solid rgba(39,39,42,0.2)' }}>
                  <div className="flex gap-0.5 mb-3">
                    {[1,2,3,4,5].map(s => <Star key={s} size={12} style={{ color: C.accentColor }} fill={C.accentColor} />)}
                  </div>
                  <p className="text-xs leading-relaxed opacity-80 mb-4">&ldquo;{t.text}&rdquo;</p>
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                      style={{ backgroundColor: C.linkColor + '20', color: C.linkColor }}>
                      {t.name.split(' ').map(n => n[0]).join('')}
                    </div>
                    <div>
                      <div className="text-[11px] font-bold" style={{ color: C.textColor }}>{t.name}</div>
                      <div className="text-[10px] opacity-50">{t.role}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section className="w-full" style={{ borderTop: '1px solid rgba(39,39,42,0.1)' }}>
          <div ref={priceReveal.ref}
            className={`max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-20 transition-all duration-700 ${priceReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            <div className="text-center mb-10 sm:mb-12">
              <h2 className="text-2xl sm:text-3xl font-black mb-3" style={{ color: C.textColor }}>Pricing</h2>
              <p className="text-sm opacity-60">Start free. Upgrade when you need more.</p>
            </div>

            {/* Plans */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
              {[
                { name: 'Starter', price: 'Free', period: 'forever', features: ['3 AI Agents', '500 LiTBit Coins', 'Image, Video & Audio Studio', 'Community Access'], cta: 'Get Started', highlight: false, href: '/sign-up' },
                { name: 'Pro', price: '$9', period: '/month', features: ['10 AI Agents', '2,000 LiTBit Coins /mo', 'Priority Generation', 'Custom Agent Slugs', 'API Access'], cta: 'Upgrade', highlight: true, href: '/sign-up' },
                { name: 'Team', price: '$29', period: '/month', features: ['Unlimited Agents', '10,000 LiTBit Coins /mo', 'Multi-user Seats', 'Analytics Dashboard', 'White-label Options'], cta: 'Upgrade', highlight: false, href: '/sign-up' },
              ].map(p => (
                <div key={p.name} className="rounded-2xl p-6 flex flex-col relative transition-all duration-200 hover:-translate-y-0.5" style={{ backgroundColor: p.highlight ? 'rgba(129,140,248,0.04)' : C.boxBg, border: `2px solid ${p.highlight ? C.linkColor : 'rgba(39,39,42,0.2)'}`, opacity: p.highlight ? 1 : undefined }}>
                  {p.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] font-bold px-3 py-1 rounded-full" style={{ backgroundColor: C.linkColor, color: '#000' }}>
                      MOST POPULAR
                    </div>
                  )}
                  <div className="text-[10px] font-bold uppercase tracking-widest mb-1 opacity-50">{p.name}</div>
                  <div className="flex items-baseline gap-1 mb-5">
                    <span className="text-3xl font-black" style={{ color: C.textColor }}>{p.price}</span>
                    <span className="text-sm opacity-50">{p.period}</span>
                  </div>
                  <ul className="space-y-3 flex-1 mb-6">
                    {p.features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-sm opacity-80">
                        <span style={{ color: C.linkColor }}>✓</span> {f}
                      </li>
                    ))}
                  </ul>
                  <Link href={p.href} className="block text-center text-sm font-bold py-2.5 rounded-lg transition-all hover:opacity-90" style={{ backgroundColor: p.highlight ? C.linkColor : 'transparent', color: p.highlight ? '#000' : C.linkColor, border: `1px solid ${p.highlight ? 'transparent' : 'rgba(129,140,248,0.3)'}` }}>
                    {p.cta}
                  </Link>
                </div>
              ))}
            </div>

            {/* Credit Packs */}
            <div className="max-w-3xl mx-auto">
              <div className="text-center mb-6">
                <h3 className="text-lg font-bold mb-1" style={{ color: C.textColor }}>LiTBit Coin Packs</h3>
                <p className="text-xs opacity-50">Need more coins? Top up anytime. No subscription required.</p>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {COIN_PACKS.map(pack => (
                  <button key={pack.coins} onClick={() => buyPack(pack)} disabled={!!checkoutLoading}
                    className="relative rounded-xl p-4 text-center transition-all hover:scale-[1.02] disabled:opacity-50 cursor-pointer"
                    style={{ backgroundColor: C.boxBg, border: `1px solid ${pack.best ? C.linkColor + '40' : 'rgba(39,39,42,0.2)'}` }}>
                    {pack.best && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: C.linkColor, color: '#000' }}>BEST VALUE</div>
                    )}
                    <div className="text-lg font-black mb-0.5" style={{ color: C.textColor }}>{pack.coins}</div>
                    <div className="text-[10px] opacity-50 mb-2">LiTBit Coins</div>
                    <div className="text-sm font-bold" style={{ color: C.linkColor }}>
                      {checkoutLoading === pack.coins ? 'Loading...' : pack.price}
                    </div>
                  </button>
                ))}
              </div>
              <p className="text-center text-[10px] opacity-40 mt-4">Coins never expire. One-time purchase. No hidden fees.</p>
            </div>
          </div>
        </section>

        {/* FOOTER CTA */}
        <section className="w-full pb-8">
          <div ref={ctaReveal.ref}
            className={`max-w-4xl mx-auto px-4 sm:px-6 transition-all duration-700 ${ctaReveal.visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'}`}>
            <div className="rounded-2xl p-8 sm:p-12 text-center relative overflow-hidden"
              style={{ backgroundColor: C.boxBg, border: '1px solid rgba(39,39,42,0.15)' }}>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[200px] rounded-full opacity-[0.05] pointer-events-none"
                style={{ background: `radial-gradient(circle, ${C.linkColor} 0%, transparent 70%)` }} />
              <h2 className="text-2xl sm:text-3xl font-black mb-3 relative z-10" style={{ color: C.textColor }}>Ready to Build?</h2>
              <p className="text-sm opacity-60 mb-8 max-w-md mx-auto relative z-10">Join 500+ creators already building with AI agents. Get 500 LiTBit Coins to start.</p>
              <Link href="/sign-up" className="inline-block px-10 py-4 rounded-lg text-sm font-black transition-all hover:scale-[1.02] relative z-10 shadow-lg"
                style={{ background: `linear-gradient(135deg, ${C.linkColor}, ${C.headerColor})`, color: '#000', boxShadow: `0 8px 32px ${C.linkColor}30` }}>
                Create Free Account
              </Link>
              <p className="text-xs mt-5 opacity-40 relative z-10">No credit card required · Cancel anytime</p>
            </div>
          </div>
        </section>

      </main>
      )}
    </div>
  );
}
