'use client';
export const dynamic = "force-dynamic";

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useTheme } from '@/context/ThemeContext';
import { useAuth, RedirectToSignIn } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { AGENT_AVATARS, AGENT_AVATAR_META, type AgentAvatarMeta } from '@/lib/avatars';

function formatPrice(cents: number): string {
  if (cents === 0) return 'FREE';
  return cents + ' LBC'; // price in LiTBit Coins
}

// CREDIT PACKS — Stripe price_id required for each (create in Stripe Dashboard)
const CREDIT_PACKS: { id: string; coins: number; price: number; priceId: string; label: string; popular: boolean; savings: string }[] = [
  { id: 'starter', coins: 500, price: 1, priceId: '', label: 'Starter', popular: false, savings: 'Entry pack' },
  { id: 'popular', coins: 1200, price: 5, priceId: '', label: 'Popular', popular: true, savings: 'Save 20%' },
  { id: 'pro', coins: 3000, price: 10, priceId: '', label: 'Pro', popular: false, savings: 'Save 33%' },
  { id: 'whale', coins: 7000, price: 25, priceId: '', label: 'Whale', popular: false, savings: 'Save 43%' },
  { id: 'max', coins: 15000, price: 50, priceId: '', label: 'Max', popular: false, savings: 'Save 50%' },
];

// SPEND COINS — interactive features with real coin deduction
const SPEND_FEATURES: { id: string; title: string; desc: string; cost: number; action: string }[] = [
  { id: 'generate', title: 'AI Generate', desc: 'Generate an image, music track, or video with AI', cost: 50, action: 'Generate' },
  { id: 'slot', title: 'Extra Agent Slot', desc: 'Expand your dock to run +1 agent simultaneously', cost: 200, action: 'Unlock' },
  { id: 'boost', title: 'Social Boost', desc: 'Feature your post at the top of the social feed for 24h', cost: 100, action: 'Boost' },
  { id: 'priority', title: 'Priority Mode', desc: 'Get faster agent responses and higher rate limits', cost: 150, action: 'Activate' },
  { id: 'theme', title: 'Rare Theme', desc: 'Unlock an exclusive limited-edition UI skin', cost: 300, action: 'Unlock' },
  { id: 'workflow', title: 'Workflow Run', desc: 'Execute a multi-agent orchestrated workflow', cost: 75, action: 'Run' },
];

type Agent = {
  id: string; slug: string; name: string; description: string;
  category: string; avatar_url: string; price_cents: number;
  features: string[]; is_featured: boolean; personality: string;
  rating?: number; installs?: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  developer: 'Developer', marketing: 'Marketing', analytics: 'Analytics',
  content: 'Content', general: 'General', orchestrator: 'Orchestrator',
  music: 'Music', design: 'Design', research: 'Research', legal: 'Legal',
};

// AGENT PRICING TIERS (in LiTBit Coins 🪙)
// Free: Core agents everyone gets
// Budget (50-150): Basic specialized agents  
// Pro (200-500): Advanced agents with premium features
// Elite (1000+): Enterprise-grade specialized agents
const DEMO_AGENTS: Agent[] = [
  // FREE TIER - Core agents
  { id: '1', slug: 'director', name: 'Director', description: 'The master orchestrator. Coordinates strategy, builds agent systems, and delegates tasks across your entire platform.', category: 'orchestrator', avatar_url: AGENT_AVATARS.director, price_cents: 0, features: ['Multi-agent orchestration', 'Strategy planning', 'Workflow automation'], is_featured: true, personality: 'Strategic, decisive, concise', rating: 4.9, installs: 1240 },
  { id: '2', slug: 'champion', name: 'Champion', description: 'Your all-purpose AI partner. Brainstorm, research, plan, and execute any task with unlimited versatility.', category: 'general', avatar_url: AGENT_AVATARS.champion, price_cents: 0, features: ['General assistance', 'Brainstorming', 'Research'], is_featured: true, personality: 'Helpful, thorough, direct', rating: 4.8, installs: 2103 },
  { id: '3', slug: 'code-champion', name: 'Code Champion', description: 'Senior software engineer. Writes, reviews, debugs, and explains code across all languages and frameworks.', category: 'developer', avatar_url: AGENT_AVATARS['code-champion'], price_cents: 0, features: ['Code generation', 'Debugging', 'Architecture'], is_featured: true, personality: 'Precise, clean, practical', rating: 4.9, installs: 1567 },

  // BUDGET TIER (50-150 coins ~ $0.50-$1.50)
  { id: '4', slug: 'writing-coach', name: 'Writing Coach', description: 'Master copywriter. Elevates writing quality — editing, tone adjustment, copywriting, and storytelling.', category: 'content', avatar_url: AGENT_AVATARS['writing-coach'], price_cents: 75, features: ['Editing', 'Tone adjustment', 'Copywriting'], is_featured: false, personality: 'Constructive, articulate, refined', rating: 4.8, installs: 1120 },
  { id: '5', slug: 'research-guru', name: 'Research Guru', description: 'Deep research agent. Synthesizes information from multiple sources, fact-checks, and produces reports.', category: 'research', avatar_url: AGENT_AVATARS['research-guru'], price_cents: 100, features: ['Deep research', 'Fact-checking', 'Reporting'], is_featured: false, personality: 'Thorough, skeptical, rigorous', rating: 4.5, installs: 432 },
  { id: '6', slug: 'support-agent', name: 'Support Agent', description: 'Customer support specialist. Handles inquiries, troubleshooting, and creates FAQ documentation.', category: 'general', avatar_url: AGENT_AVATARS['support-agent'], price_cents: 50, features: ['Support tickets', 'Documentation', 'Troubleshooting'], is_featured: false, personality: 'Patient, helpful, clear', rating: 4.6, installs: 543 },

  // PRO TIER (200-500 coins ~ $2-$5)
  { id: '7', slug: 'social-dominator', name: 'Social Dominator', description: 'Growth hacker and content creator. Writes viral posts, crafts strategies, and helps you dominate social media.', category: 'marketing', avatar_url: AGENT_AVATARS['social-dominator'], price_cents: 250, features: ['Viral content', 'Growth strategy', 'Analytics'], is_featured: true, personality: 'Bold, creative, results-driven', rating: 4.7, installs: 890 },
  { id: '8', slug: 'data-slayer', name: 'Data Slayer', description: 'Data scientist. Analyzes data, builds models, creates visualizations, and surfaces actionable insights.', category: 'analytics', avatar_url: AGENT_AVATARS['data-slayer'], price_cents: 300, features: ['Data analysis', 'Modeling', 'Visualization'], is_featured: true, personality: 'Precise, analytical, data-driven', rating: 4.6, installs: 654 },
  { id: '9', slug: 'pixel-forge', name: 'Pixel Forge', description: 'AI image and 3D world generation specialist. Creates stunning visuals, textures, and immersive environments.', category: 'design', avatar_url: AGENT_AVATARS['pixel-forge'], price_cents: 200, features: ['Image generation', '360 worlds', 'Texture design'], is_featured: true, personality: 'Visionary, artistic, detailed', rating: 4.8, installs: 921 },
  { id: '10', slug: 'music-producer', name: 'Music Producer', description: 'Creates original music from text prompts and lyrics. Generates songs, instrumentals, and covers with AI.', category: 'music', avatar_url: AGENT_AVATARS['music-producer'], price_cents: 400, features: ['Music generation', 'Lyrics writing', 'Style guidance'], is_featured: true, personality: 'Creative, musical, expressive', rating: 4.7, installs: 743 },

  // ELITE TIER (1000+ coins ~ $10+)
  { id: '11', slug: 'legal-shield', name: 'Legal Shield', description: 'Legal assistant for contracts, compliance, and regulatory guidance. Not a lawyer, but a powerful research aide.', category: 'legal', avatar_url: AGENT_AVATARS['legal-shield'], price_cents: 1000, features: ['Contract review', 'Compliance', 'Legal research'], is_featured: false, personality: 'Cautious, precise, thorough', rating: 4.4, installs: 210 },
  { id: '12', slug: 'security-guru', name: 'Security Guru', description: 'Cybersecurity expert. Audits code, finds vulnerabilities, and recommends security best practices.', category: 'developer', avatar_url: AGENT_AVATARS['security-guru'], price_cents: 1200, features: ['Security audits', 'Vulnerability scanning', 'Best practices'], is_featured: false, personality: 'Paranoid, thorough, vigilant', rating: 4.7, installs: 156 },
  { id: '13', slug: 'ml-engineer', name: 'ML Engineer', description: 'Machine learning specialist. Builds models, optimizes training, and deploys AI systems.', category: 'analytics', avatar_url: AGENT_AVATARS['ml-engineer'], price_cents: 1500, features: ['Model training', 'Hyperparameter tuning', 'Model deployment'], is_featured: false, personality: 'Methodical, experimental, rigorous', rating: 4.8, installs: 89 },
];

export default function Marketplace() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const { resolvedColors: T } = useTheme();
  const searchParams = useSearchParams();
  const [agents] = useState<Agent[]>(DEMO_AGENTS);
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(new Set(['1', '2', '3']));
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('featured');
  const [previewAgent, setPreviewAgent] = useState<Agent | null>(null);
  const [litBitCoins, setLitBitCoins] = useState(500);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [sellModalAgent, setSellModalAgent] = useState<Agent | null>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [listedAgents, setListedAgents] = useState<Set<string>>(new Set());

  const [crtEnabled, setCrtEnabled] = useState(true);

  // Fetch wallet from API (source of truth)
  const fetchWallet = async () => {
    try {
      const res = await fetch('/api/wallet');
      const data = await res.json();
      if (typeof data.balance === 'number') {
        setLitBitCoins(data.balance);
      }
    } catch {
      // silent fail
    }
  };

  useEffect(() => {
    fetchWallet();

    const val = localStorage.getItem("crt_global_scanlines");
    if (val !== null) setCrtEnabled(val === "true");

    // Stripe return detection
    const success = searchParams.get('success');
    const canceled = searchParams.get('canceled');
    if (success === 'true') {
      showToast('Payment successful! Your LiTBit Coins will be credited shortly.', 'success');
    } else if (canceled === 'true') {
      showToast('Payment canceled. No coins were charged.', 'info');
    }
  }, [isSignedIn]);

  const buyPack = async (pack: typeof CREDIT_PACKS[0]) => {
    if (!pack.priceId || !pack.priceId.startsWith('price_')) {
      showToast('Stripe setup needed: create a Price in Stripe Dashboard and add its price_xxx ID to CREDIT_PACKS.', 'info');
      return;
    }
    if (!isSignedIn || !userId) {
      showToast('Please sign in to purchase coins.', 'error');
      return;
    }
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priceId: pack.priceId,
          mode: 'payment',
          metadata: { clerk_id: userId, coin_amount: String(pack.coins) },
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        showToast(data.error || 'Checkout failed. Try again.', 'error');
      }
    } catch {
      showToast('Network error during checkout.', 'error');
    }
  };

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const [claimLoading, setClaimLoading] = useState(false);

  const earnCoins = async () => {
    if (claimLoading) return;
    setClaimLoading(true);
    try {
      const res = await fetch('/api/wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'daily' }),
      });
      const data = await res.json();
      if (res.ok) {
        setLitBitCoins(data.balance);
        showToast(`+50 LBC Daily bonus claimed. Balance: ${data.balance}`, 'success');
      } else {
        showToast(data.error || 'Failed to claim daily bonus.', 'error');
      }
    } catch {
      showToast('Network error. Try again.', 'error');
    } finally {
      setClaimLoading(false);
    }
  };

  const categories = Array.from(new Set(agents.map(a => a.category)));

  const filteredAgents = agents
    .filter(a => !selectedCategory || a.category === selectedCategory)
    .filter(a => !searchQuery || a.name.toLowerCase().includes(searchQuery.toLowerCase()) || a.description.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'featured') return (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0) || (b.installs || 0) - (a.installs || 0);
      if (sortBy === 'popular') return (b.installs || 0) - (a.installs || 0);
      if (sortBy === 'rating') return (b.rating || 0) - (a.rating || 0);
      if (sortBy === 'price') return a.price_cents - b.price_cents;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });

  const featuredAgents = filteredAgents.filter(a => a.is_featured);
  const regularAgents = filteredAgents.filter(a => !a.is_featured);

  const syncWallet = async (amount: number) => {
    try {
      const res = await fetch('/api/wallet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount }),
      });
      const data = await res.json();
      if (res.ok && typeof data.balance === 'number') {
        setLitBitCoins(data.balance);
        return data.balance;
      }
    } catch {
      // silent fail
    }
    return null;
  };

  const installAgent = useCallback(async (agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    if (agent.price_cents > 0) {
      const cost = agent.price_cents;
      if (litBitCoins < cost) {
        showToast(`Not enough 🪙 LiTBit Coins! Need ${cost}, have ${litBitCoins}. Earn more below.`, 'error');
        return;
      }
      const newBal = await syncWallet(-cost);
      if (newBal === null) {
        showToast('Purchase failed. Could not deduct coins. Try again.', 'error');
        return;
      }
      showToast(`✅ Installed ${agent.name}! -${cost} 🪙 · Balance: ${newBal}`, 'success');
    } else {
      showToast(`✅ ${agent.name} installed for free!`, 'success');
    }
    setInstalledAgents(prev => new Set([...prev, agentId]));
  }, [agents, litBitCoins]);

  const listForSale = useCallback(async (agentId: string, price: number) => {
    const earned = Math.floor(price * 0.1);
    const newBal = await syncWallet(earned);
    if (newBal === null) {
      showToast('Listing failed. Could not credit bonus. Try again.', 'error');
      return;
    }
    setListedAgents(prev => new Set([...prev, agentId]));
    showToast(`🏪 Agent listed! You earned ${earned} 🪙 listing bonus.`, 'info');
    setSellModalAgent(null);
    setSellPrice('');
  }, [litBitCoins]);

  // Require authentication (after all hooks to respect Rules of Hooks)
  if (!isLoaded) {
    return (
      <div style={{ backgroundColor: T?.bgColor || '#0a0a0f', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T?.textColor || '#00ff41', fontFamily: 'monospace' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '32px', marginBottom: '16px' }}>⏳</div>
          <div>Loading marketplace...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return <RedirectToSignIn redirectUrl="/marketplace" />;
  }

  const stats: Record<string, number | string> = {
    total: agents.length,
    free: agents.filter(a => a.price_cents === 0).length,
    installed: installedAgents.size,
    coins: litBitCoins + ' 🪙',
  };

  return (
    <div style={{ backgroundColor: T.bgColor, minHeight: '100vh', color: T.textColor, fontFamily: 'monospace', position: 'relative' }}>
      {/* CRT Scanline Filter */}
      {crtEnabled && (
        <div className="fixed inset-0 pointer-events-none z-40 opacity-[0.06]" style={{
          background: "repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.1) 1px, transparent 1px, transparent 2px)",
          boxShadow: "inset 0 0 80px rgba(0, 255, 0, 0.3)"
        }} />
      )}
      {/* Toast notification */}
      {toast && (
        <div style={{ position: 'fixed', top: '80px', right: '20px', zIndex: 200, padding: '12px 20px', backgroundColor: toast.type === 'success' ? '#0a2e0a' : toast.type === 'error' ? '#2e0a0a' : '#0a1a2e', border: '2px solid ' + (toast.type === 'success' ? T.accentColor : toast.type === 'error' ? '#ff4444' : T.linkColor), color: toast.type === 'success' ? T.accentColor : toast.type === 'error' ? '#ff4444' : T.linkColor, fontSize: '12px', fontWeight: 'bold', maxWidth: '320px' }}>
          {toast.msg}
        </div>
      )}

      <div style={{ borderBottom: '2px solid ' + T.borderColor, padding: '32px 24px', textAlign: 'center', background: 'linear-gradient(180deg, ' + T.boxBg + ' 0%, ' + T.bgColor + ' 100%)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <h1 style={{ color: T.headerColor, fontSize: '32px', fontWeight: 'bold', letterSpacing: '3px', margin: 0 }}>🤖 AGENT MARKETPLACE</h1>
          <span style={{ padding: '4px 10px', backgroundColor: 'rgba(255,107,107,0.2)', border: '1px solid #ff6b6b', color: '#ff6b6b', fontSize: '10px', fontWeight: 'bold', borderRadius: '6px', letterSpacing: '1px', textTransform: 'uppercase' }}>Beta</span>
        </div>
        <p style={{ color: T.textColor, fontSize: '13px', opacity: 0.7, maxWidth: '500px', margin: '0 auto 12px' }}>Discover, install, and deploy AI agents to your workspace</p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '16px' }}>
          <button onClick={earnCoins} disabled={claimLoading} style={{ padding: '6px 14px', backgroundColor: 'rgba(255,215,0,0.15)', border: '1px solid gold', color: 'gold', fontSize: '11px', cursor: claimLoading ? 'not-allowed' : 'pointer', fontFamily: 'monospace', fontWeight: 'bold', opacity: claimLoading ? 0.6 : 1 }}>{claimLoading ? '⏳ Claiming...' : '🪙 Daily Bonus'}</button>
          <button onClick={() => showToast('Buy LiTBit Coins: connect wallet coming soon!', 'info')} style={{ padding: '6px 14px', backgroundColor: 'rgba(255,215,0,0.1)', border: '1px solid ' + T.borderColor, color: T.textColor, fontSize: '11px', cursor: 'pointer', fontFamily: 'monospace' }}>💳 Buy LiTBit Coins</button>
        </div>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            { label: 'Total Agents', value: stats.total, accent: T.accentColor },
            { label: 'Free', value: stats.free, accent: T.accentColor },
            { label: 'Installed', value: stats.installed, accent: T.accentColor },
            { label: 'Your Wallet', value: stats.coins, accent: 'gold', bg: 'rgba(255,215,0,0.08)', border: 'gold' },
          ].map(stat => (
            <div key={stat.label} style={{ padding: '10px 20px', borderRadius: '8px', border: '1px solid ' + (stat.border || T.borderColor), backgroundColor: stat.bg || 'rgba(0,0,0,0.3)', minWidth: '100px' }}>
              <div style={{ color: stat.accent, fontSize: '20px', fontWeight: 'bold', textAlign: 'center' }}>{stat.value}</div>
              <div style={{ fontSize: '10px', color: T.textColor, opacity: 0.6, textAlign: 'center', marginTop: '2px', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 24px', borderBottom: '1px solid ' + T.borderColor, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', backgroundColor: T.boxBg }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1, alignItems: 'center' }}>
          <button onClick={() => setSelectedCategory('')} style={{ padding: '6px 14px', fontSize: '11px', borderRadius: '6px', border: '1px solid ' + (selectedCategory === '' ? T.accentColor : T.borderColor), backgroundColor: selectedCategory === '' ? 'rgba(255,255,0,0.15)' : 'transparent', color: selectedCategory === '' ? T.accentColor : T.textColor, cursor: 'pointer', fontFamily: 'monospace', fontWeight: selectedCategory === '' ? 'bold' : 'normal', transition: 'all 0.15s' }}>
            All ({agents.length})
          </button>
          {categories.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat === selectedCategory ? '' : cat)} style={{ padding: '6px 14px', fontSize: '11px', borderRadius: '6px', border: '1px solid ' + (selectedCategory === cat ? T.accentColor : T.borderColor), backgroundColor: selectedCategory === cat ? 'rgba(255,255,0,0.15)' : 'transparent', color: selectedCategory === cat ? T.accentColor : T.textColor, cursor: 'pointer', fontFamily: 'monospace', textTransform: 'capitalize', fontWeight: selectedCategory === cat ? 'bold' : 'normal', transition: 'all 0.15s' }}>
              {CATEGORY_LABELS[cat] || cat} ({agents.filter(a => a.category === cat).length})
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input type='text' value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder='Search agents...' style={{ padding: '8px 14px', backgroundColor: T.bgColor, border: '1px solid ' + T.borderColor, borderRadius: '6px', color: '#e0e0e0', fontSize: '12px', fontFamily: 'monospace', width: '200px', outline: 'none' }} />
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '8px 10px', backgroundColor: T.bgColor, border: '1px solid ' + T.borderColor, borderRadius: '6px', color: T.textColor, fontSize: '11px', fontFamily: 'monospace', cursor: 'pointer' }}>
            <option value='featured'>Featured</option>
            <option value='popular'>Popular</option>
            <option value='rating'>Rating</option>
            <option value='price'>Price</option>
            <option value='name'>Name</option>
          </select>
          <Link href='/studio?tool=agents' style={{ padding: '8px 16px', backgroundColor: T.linkColor, color: 'white', textDecoration: 'none', fontSize: '11px', fontWeight: 'bold', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>🚀 My Dock</Link>
          <div style={{ padding: '8px 14px', borderRadius: '6px', border: '1px solid gold', color: 'gold', fontSize: '11px', fontWeight: 'bold', backgroundColor: 'rgba(255,215,0,0.08)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>🪙 {litBitCoins}</div>
        </div>
      </div>

      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        {featuredAgents.length > 0 && !searchQuery && (
          <div style={{ marginBottom: '32px' }}>
            <div style={{ color: T.accentColor, fontSize: '11px', letterSpacing: '2px', marginBottom: '12px', fontWeight: 'bold' }}>⭐ FEATURED AGENTS</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
              {featuredAgents.map(agent => <AgentCard key={agent.id} agent={agent} isInstalled={installedAgents.has(agent.id)} onInstall={() => installAgent(agent.id)} onPreview={() => setPreviewAgent(agent)} theme={T} />)}
            </div>
          </div>
        )}
        <div>
          <div style={{ color: T.accentColor, fontSize: '11px', letterSpacing: '2px', marginBottom: '12px', fontWeight: 'bold' }}>
            {selectedCategory ? selectedCategory.toUpperCase() + ' AGENTS' : 'ALL AGENTS'}
            <span style={{ color: T.textColor, opacity: 0.5, marginLeft: '8px' }}>({filteredAgents.length})</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
            {(searchQuery ? filteredAgents : regularAgents).map(agent => <AgentCard key={agent.id} agent={agent} isInstalled={installedAgents.has(agent.id)} onInstall={() => installAgent(agent.id)} onPreview={() => setPreviewAgent(agent)} theme={T} />)}
          </div>
        </div>
        {filteredAgents.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: T.textColor, opacity: 0.5 }}>
            <div style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '12px', color: T.headerColor }}>?</div>
            <div>No agents found matching your search.</div>
          </div>
        )}

        {/* CREDIT PACKS SECTION */}
        <div style={{ marginTop: '48px', marginBottom: '32px', padding: '24px', border: '2px solid ' + T.borderColor, backgroundColor: T.boxBg }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <div style={{ color: T.headerColor, fontSize: '18px', fontWeight: 'bold', marginBottom: '4px' }}>Buy LiTBit Coins</div>
              <p style={{ color: T.textColor, fontSize: '12px', opacity: 0.7, maxWidth: '400px' }}>
                Purchase coins to unlock premium agents, API access, and AI generations.
                <strong style={{ color: T.accentColor }}>1 LBC = $0.01</strong> (1 cent per coin)
              </p>
            </div>
            <div style={{ padding: '8px 16px', border: '1px solid gold', backgroundColor: 'rgba(255,215,0,0.1)' }}>
              <span style={{ color: 'gold', fontSize: '14px', fontWeight: 'bold' }}>{litBitCoins} LBC current balance</span>
            </div>
          </div>
          
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            {CREDIT_PACKS.map((pack) => (
              <div 
                key={pack.id}
                style={{ 
                  position: 'relative',
                  padding: '20px', 
                  border: `2px solid ${pack.popular ? 'gold' : T.borderColor}`, 
                  backgroundColor: pack.popular ? 'rgba(255,215,0,0.08)' : 'rgba(0,0,0,0.3)',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
                onClick={() => showToast(`${pack.label} Pack: ${pack.coins.toLocaleString()} coins for $${pack.price} - Stripe integration coming soon!`, 'info')}
              >
                {pack.popular && (
                  <div style={{ position: 'absolute', top: '-10px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'gold', color: 'black', padding: '2px 12px', fontSize: '10px', fontWeight: 'bold' }}>
                    MOST POPULAR
                  </div>
                )}
                <div style={{ color: pack.popular ? 'gold' : T.headerColor, fontSize: '28px', fontWeight: 'bold', marginBottom: '4px' }}>
                  {pack.coins.toLocaleString()}
                </div>
                <div style={{ color: T.textColor, fontSize: '11px', marginBottom: '8px' }}>LiTBit Coins</div>
                <div style={{ color: pack.popular ? 'gold' : T.accentColor, fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>
                  ${pack.price}
                </div>
                <div style={{ color: T.textColor, fontSize: '10px', opacity: 0.6, marginBottom: '12px' }}>
                  {pack.savings} · {(pack.coins / pack.price).toFixed(0)} coins/$
                </div>
                <button onClick={() => buyPack(pack)} style={{ 
                  width: '100%', 
                  padding: '10px', 
                  backgroundColor: pack.popular ? 'gold' : T.linkColor, 
                  color: pack.popular ? 'black' : 'white', 
                  border: 'none', 
                  fontWeight: 'bold',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}>
                  Buy {pack.label}
                </button>
              </div>
            ))}
          </div>

          {/* SPEND COINS — interactive */}
          <div style={{ borderTop: '1px solid ' + T.borderColor, paddingTop: '20px' }}>
            <div style={{ color: T.accentColor, fontSize: '11px', letterSpacing: '1px', marginBottom: '16px', fontWeight: 'bold' }}>
              SPEND YOUR LITBIT COINS
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
              {SPEND_FEATURES.map((feat) => (
                <div key={feat.id} style={{ padding: '14px', border: '1px solid ' + T.borderColor, backgroundColor: 'rgba(0,0,0,0.2)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 'bold', color: T.accentColor, marginBottom: '6px', letterSpacing: '1px' }}>{feat.title.toUpperCase()}</div>
                  <div style={{ color: T.headerColor, fontSize: '12px', fontWeight: 'bold', marginBottom: '2px' }}>{feat.title}</div>
                  <div style={{ color: T.textColor, fontSize: '10px', opacity: 0.7, lineHeight: 1.4, marginBottom: '8px' }}>{feat.desc}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'gold', fontSize: '12px', fontWeight: 'bold' }}>{feat.cost} LBC</span>
                    <button
                      onClick={async () => {
                        if (litBitCoins < feat.cost) {
                          showToast(`Need ${feat.cost} LBC. You have ${litBitCoins}`, 'error');
                          return;
                        }
                        const newBal = await syncWallet(-feat.cost);
                        if (newBal === null) {
                          showToast('Transaction failed. Could not deduct coins.', 'error');
                          return;
                        }
                        showToast(`${feat.action} ${feat.title}. -${feat.cost} LBC. Balance: ${newBal}`, 'success');
                      }}
                      style={{ padding: '4px 10px', backgroundColor: T.linkColor, color: 'white', border: 'none', fontSize: '10px', fontWeight: 'bold', cursor: 'pointer' }}
                    >
                      {feat.action}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* PRICING EXAMPLES */}
          <div style={{ borderTop: '1px solid ' + T.borderColor, paddingTop: '20px', marginTop: '20px' }}>
            <div style={{ color: T.accentColor, fontSize: '11px', letterSpacing: '1px', marginBottom: '12px', fontWeight: 'bold' }}>
              PRICING EXAMPLES
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '12px' }}>
              <div style={{ padding: '8px 12px', border: '1px solid ' + T.borderColor }}>
                <span style={{ color: T.accentColor }}>Support Agent</span>
                <span style={{ color: T.textColor, opacity: 0.7 }}> — 50 LBC ($0.50)</span>
              </div>
              <div style={{ padding: '8px 12px', border: '1px solid ' + T.borderColor }}>
                <span style={{ color: T.headerColor }}>Social Dominator</span>
                <span style={{ color: T.textColor, opacity: 0.7 }}> — 250 LBC ($2.50)</span>
              </div>
              <div style={{ padding: '8px 12px', border: '1px solid ' + T.borderColor }}>
                <span style={{ color: '#ff6b35' }}>Legal Shield</span>
                <span style={{ color: T.textColor, opacity: 0.7 }}> — 1000 LBC ($10.00)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {previewAgent && (
        <div onClick={() => setPreviewAgent(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '100%', backgroundColor: T.boxBg, border: '2px solid ' + T.borderColor, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ padding: '24px', borderBottom: '1px solid ' + T.borderColor, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <AgentAvatar slug={previewAgent.slug} size={64} />
                <div>
                  <div style={{ color: T.headerColor, fontSize: '20px', fontWeight: 'bold' }}>{previewAgent.name}</div>
                  <div style={{ color: T.textColor, fontSize: '11px', opacity: 0.7, textTransform: 'capitalize' }}>{previewAgent.category} · {previewAgent.personality}</div>
                </div>
              </div>
              <button onClick={() => setPreviewAgent(null)} style={{ backgroundColor: 'transparent', border: 'none', color: T.textColor, cursor: 'pointer', fontSize: '18px' }}>✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <p style={{ color: T.textColor, fontSize: '13px', lineHeight: 1.6, marginBottom: '20px' }}>{previewAgent.description}</p>
              <div style={{ marginBottom: '20px' }}>
                <div style={{ color: T.accentColor, fontSize: '10px', letterSpacing: '1px', marginBottom: '8px' }}>FEATURES</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {previewAgent.features.map((f, i) => <span key={i} style={{ padding: '4px 10px', backgroundColor: 'rgba(255,0,128,0.15)', border: '1px solid ' + T.linkColor, color: T.linkColor, fontSize: '11px' }}>{f}</span>)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '16px', marginBottom: '20px', fontSize: '12px' }}>
                <span style={{ color: T.textColor }}>⭐ {previewAgent.rating}/5.0</span>
                <span style={{ color: T.textColor }}>📥 {(previewAgent.installs || 0).toLocaleString()} installs</span>
                <span style={{ color: previewAgent.price_cents === 0 ? T.accentColor : T.headerColor, fontWeight: 'bold' }}>{formatPrice(previewAgent.price_cents)}</span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {installedAgents.has(previewAgent.id) ? (
                  <>
                    <button disabled style={{ flex: 1, padding: '12px', backgroundColor: '#333', color: '#666', border: 'none', fontWeight: 'bold' }}>✓ Installed</button>
                    {!listedAgents.has(previewAgent.id) && (
                      <button onClick={() => { setPreviewAgent(null); setSellModalAgent(previewAgent); }} style={{ padding: '12px 16px', border: '2px solid gold', color: 'gold', backgroundColor: 'rgba(255,215,0,0.1)', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px' }}>🏪 Sell</button>
                    )}
                  </>
                ) : (
                  <button onClick={() => { installAgent(previewAgent.id); if (previewAgent.price_cents === 0 || litBitCoins >= previewAgent.price_cents) setPreviewAgent(null); }} style={{ flex: 1, padding: '12px', backgroundColor: T.linkColor, color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                    {previewAgent.price_cents === 0 ? '🚀 Install Free' : '🪙 Buy — ' + formatPrice(previewAgent.price_cents)}
                  </button>
                )}
                <Link href='/studio?tool=agents' onClick={() => setPreviewAgent(null)} style={{ padding: '12px 20px', border: '2px solid ' + T.linkColor, color: T.linkColor, textDecoration: 'none', fontWeight: 'bold', fontSize: '12px', display: 'flex', alignItems: 'center' }}>Open Builder</Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sell Modal */}
      {sellModalAgent && (
        <div onClick={() => setSellModalAgent(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '400px', width: '100%', backgroundColor: T.boxBg, border: '2px solid gold', padding: '28px' }}>
            <h2 style={{ color: 'gold', fontSize: '18px', fontWeight: 'bold', marginBottom: '8px' }}>🏪 List Agent for Sale</h2>
            <p style={{ color: T.textColor, fontSize: '12px', marginBottom: '20px', opacity: 0.8 }}>
              List <strong style={{ color: T.headerColor }}>{sellModalAgent.name}</strong> on the marketplace. Other users can buy it with 🪙 LiTBit Coins. You earn 90% of each sale.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ color: T.accentColor, fontSize: '10px', letterSpacing: '1px', display: 'block', marginBottom: '6px' }}>SET PRICE (🪙 LiTBit Coins)</label>
              <input
                type='number'
                min='1'
                max='9999'
                value={sellPrice}
                onChange={e => setSellPrice(e.target.value)}
                placeholder='e.g. 250'
                style={{ width: '100%', padding: '10px', backgroundColor: T.bgColor, border: '1px solid gold', color: T.textColor, fontSize: '14px', fontFamily: 'monospace', outline: 'none', boxSizing: 'border-box' }}
              />
              {sellPrice && (
                <p style={{ color: T.textColor, fontSize: '10px', marginTop: '4px', opacity: 0.6 }}>
                  You earn ~{Math.floor(Number(sellPrice) * 0.9)} 🪙 per sale (10% platform fee)
                </p>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => { if (sellPrice && Number(sellPrice) > 0) listForSale(sellModalAgent.id, Number(sellPrice)); }}
                disabled={!sellPrice || Number(sellPrice) <= 0}
                style={{ flex: 1, padding: '12px', backgroundColor: Number(sellPrice) > 0 ? 'gold' : '#333', color: Number(sellPrice) > 0 ? 'black' : '#666', border: 'none', cursor: Number(sellPrice) > 0 ? 'pointer' : 'not-allowed', fontWeight: 'bold', fontSize: '13px' }}
              >
                🚀 List Now
              </button>
              <button onClick={() => setSellModalAgent(null)} style={{ padding: '12px 20px', border: '1px solid ' + T.borderColor, color: T.textColor, backgroundColor: 'transparent', cursor: 'pointer', fontSize: '12px' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AgentAvatar({ slug, size = 40 }: { slug: string; size?: number }) {
  const meta: AgentAvatarMeta | undefined = AGENT_AVATAR_META[slug];
  if (!meta) return (
    <div style={{ width: size, height: size, borderRadius: size * 0.2, background: '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.45, border: '1px solid #555' }}>
      🤖
    </div>
  );
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.2, background: meta.bg, border: `1.5px solid ${meta.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.5, lineHeight: 1 }}>
      {meta.emoji}
    </div>
  );
}

function AgentCard({ agent, isInstalled, onInstall, onPreview, theme }: { agent: Agent; isInstalled: boolean; onInstall: () => void; onPreview: () => void; theme: Record<string, string> }) {
  const T = theme;
  const [hovered, setHovered] = useState(false);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ border: '1px solid ' + (hovered ? T.accentColor : T.borderColor), backgroundColor: 'rgba(0,0,0,0.3)', transition: 'all 0.2s', transform: hovered ? 'translateY(-4px)' : 'translateY(0)', boxShadow: hovered ? '0 8px 24px rgba(0,255,255,0.08)' : 'none', borderRadius: '8px', overflow: 'hidden' }}>
      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '12px' }}>
          <AgentAvatar slug={agent.slug} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: T.headerColor, fontSize: '15px', fontWeight: 'bold', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agent.name}</div>
            <div style={{ color: T.textColor, fontSize: '10px', opacity: 0.6, textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{CATEGORY_LABELS[agent.category] || agent.category}</span>
              <span>·</span>
              <span>⭐ {agent.rating}</span>
              <span>·</span>
              <span>📥 {agent.installs}</span>
            </div>
          </div>
          <div style={{ padding: '4px 10px', fontSize: '10px', fontWeight: 'bold', backgroundColor: agent.price_cents === 0 ? T.accentColor : T.headerColor, color: 'black', borderRadius: '6px', letterSpacing: '0.5px', whiteSpace: 'nowrap' }}>{formatPrice(agent.price_cents)}</div>
        </div>
        <p style={{ color: T.textColor, fontSize: '12px', lineHeight: 1.5, marginBottom: '12px', height: '54px', overflow: 'hidden', opacity: 0.85 }}>{agent.description}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '14px' }}>
          {agent.features.slice(0, 2).map((f, i) => <span key={i} style={{ padding: '4px 10px', backgroundColor: 'rgba(255,0,128,0.1)', border: '1px solid ' + T.linkColor, color: T.linkColor, fontSize: '10px', borderRadius: '4px' }}>{f}</span>)}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onPreview} style={{ flex: 1, padding: '8px', border: '1px solid ' + T.linkColor, color: T.linkColor, backgroundColor: 'transparent', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', borderRadius: '6px', transition: 'all 0.15s' }}>👁 Preview</button>
          {isInstalled ? (
            <button disabled style={{ flex: 1, padding: '8px', backgroundColor: 'rgba(80,80,80,0.3)', color: '#888', border: '1px solid #444', borderRadius: '6px', fontSize: '12px', fontWeight: 'bold', cursor: 'not-allowed' }}>✓ Installed</button>
          ) : (
            <button onClick={onInstall} style={{ flex: 1, padding: '8px', backgroundColor: T.linkColor, color: 'white', border: 'none', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', borderRadius: '6px', transition: 'all 0.15s' }}>🚀 Install</button>
          )}
        </div>
      </div>
    </div>
  );
}
