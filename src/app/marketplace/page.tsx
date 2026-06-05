'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useTheme } from '@/context/ThemeContext';

function formatPrice(cents: number): string {
  if (cents === 0) return 'FREE';
  return cents + ' 🪙'; // price in LitCoins
}

function getLitCoinBalance(): number {
  if (typeof window === 'undefined') return 500;
  return parseInt(localStorage.getItem('litcoins') || '500', 10);
}

function setLitCoinBalance(val: number) {
  if (typeof window !== 'undefined') localStorage.setItem('litcoins', String(Math.max(0, val)));
}

type Agent = {
  id: string; slug: string; name: string; description: string;
  category: string; avatar_url: string; price_cents: number;
  features: string[]; is_featured: boolean; personality: string;
  rating?: number; installs?: number;
};

const CATEGORY_ICONS: Record<string, string> = {
  developer: '💻', marketing: '📱', analytics: '📊',
  content: '✍️', general: '🏆', orchestrator: '🎯',
  music: '🎵', design: '🎨', research: '🔬', legal: '⚖️',
};

const DEMO_AGENTS: Agent[] = [
  { id: '1', slug: 'director', name: 'Director', description: 'The master orchestrator. Coordinates strategy, builds agent systems, and delegates tasks across your entire platform.', category: 'orchestrator', avatar_url: '🎯', price_cents: 0, features: ['Multi-agent orchestration', 'Strategy planning', 'Workflow automation'], is_featured: true, personality: 'Strategic, decisive, concise', rating: 4.9, installs: 1240 },
  { id: '2', slug: 'champion', name: 'Champion', description: 'Your all-purpose AI partner. Brainstorm, research, plan, and execute any task with unlimited versatility.', category: 'general', avatar_url: '🏆', price_cents: 0, features: ['General assistance', 'Brainstorming', 'Research'], is_featured: true, personality: 'Helpful, thorough, direct', rating: 4.8, installs: 2103 },
  { id: '3', slug: 'code-champion', name: 'Code Champion', description: 'Senior software engineer. Writes, reviews, debugs, and explains code across all languages and frameworks.', category: 'developer', avatar_url: '💻', price_cents: 0, features: ['Code generation', 'Debugging', 'Architecture'], is_featured: true, personality: 'Precise, clean, practical', rating: 4.9, installs: 1567 },
  { id: '4', slug: 'social-dominator', name: 'Social Dominator', description: 'Growth hacker and content creator. Writes viral posts, crafts strategies, and helps you dominate social media.', category: 'marketing', avatar_url: '📱', price_cents: 0, features: ['Viral content', 'Growth strategy', 'Analytics'], is_featured: false, personality: 'Bold, creative, results-driven', rating: 4.7, installs: 890 },
  { id: '5', slug: 'data-slayer', name: 'Data Slayer', description: 'Data scientist. Analyzes data, builds models, creates visualizations, and surfaces actionable insights.', category: 'analytics', avatar_url: '📊', price_cents: 0, features: ['Data analysis', 'Modeling', 'Visualization'], is_featured: false, personality: 'Precise, analytical, data-driven', rating: 4.6, installs: 654 },
  { id: '6', slug: 'writing-coach', name: 'Writing Coach', description: 'Master copywriter. Elevates writing quality — editing, tone adjustment, copywriting, and storytelling.', category: 'content', avatar_url: '✍️', price_cents: 0, features: ['Editing', 'Tone adjustment', 'Copywriting'], is_featured: false, personality: 'Constructive, articulate, refined', rating: 4.8, installs: 1120 },
  { id: '7', slug: 'music-producer', name: 'Music Producer', description: 'Creates original music from text prompts and lyrics. Generates songs, instrumentals, and covers with AI.', category: 'music', avatar_url: '🎵', price_cents: 0, features: ['Music generation', 'Lyrics writing', 'Style guidance'], is_featured: true, personality: 'Creative, musical, expressive', rating: 4.7, installs: 743 },
  { id: '8', slug: 'pixel-forge', name: 'Pixel Forge', description: 'AI image and 3D world generation specialist. Creates stunning visuals, textures, and immersive environments.', category: 'design', avatar_url: '🎨', price_cents: 0, features: ['Image generation', '360 worlds', 'Texture design'], is_featured: false, personality: 'Visionary, artistic, detailed', rating: 4.8, installs: 921 },
  { id: '9', slug: 'research-guru', name: 'Research Guru', description: 'Deep research agent. Synthesizes information from multiple sources, fact-checks, and produces reports.', category: 'research', avatar_url: '🔬', price_cents: 0, features: ['Deep research', 'Fact-checking', 'Reporting'], is_featured: false, personality: 'Thorough, skeptical, rigorous', rating: 4.5, installs: 432 },
  { id: '10', slug: 'legal-shield', name: 'Legal Shield', description: 'Legal assistant for contracts, compliance, and regulatory guidance. Not a lawyer, but a powerful research aide.', category: 'legal', avatar_url: '⚖️', price_cents: 499, features: ['Contract review', 'Compliance', 'Legal research'], is_featured: false, personality: 'Cautious, precise, thorough', rating: 4.4, installs: 210 },
];

export default function Marketplace() {
  const { resolvedColors: T } = useTheme();
  const [agents] = useState<Agent[]>(DEMO_AGENTS);
  const [installedAgents, setInstalledAgents] = useState<Set<string>>(new Set(['1', '2', '3']));
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('featured');
  const [previewAgent, setPreviewAgent] = useState<Agent | null>(null);
  const [litCoins, setLitCoins] = useState(500);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [sellModalAgent, setSellModalAgent] = useState<Agent | null>(null);
  const [sellPrice, setSellPrice] = useState('');
  const [listedAgents, setListedAgents] = useState<Set<string>>(new Set());

  useEffect(() => { setLitCoins(getLitCoinBalance()); }, []);

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const earnCoins = () => {
    const earned = 50;
    const newBal = litCoins + earned;
    setLitCoins(newBal);
    setLitCoinBalance(newBal);
    showToast(`+${earned} 🪙 LitCoins earned! Balance: ${newBal}`, 'success');
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

  const installAgent = useCallback((agentId: string) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    if (agent.price_cents > 0) {
      const cost = agent.price_cents;
      if (litCoins < cost) {
        showToast(`Not enough 🪙 LitCoins! Need ${cost}, have ${litCoins}. Earn more below.`, 'error');
        return;
      }
      const newBal = litCoins - cost;
      setLitCoins(newBal);
      setLitCoinBalance(newBal);
      showToast(`✅ Installed ${agent.name}! -${cost} 🪙 · Balance: ${newBal}`, 'success');
    } else {
      showToast(`✅ ${agent.name} installed for free!`, 'success');
    }
    setInstalledAgents(prev => new Set([...prev, agentId]));
  }, [agents, litCoins]);

  const listForSale = useCallback((agentId: string, price: number) => {
    setListedAgents(prev => new Set([...prev, agentId]));
    const earned = Math.floor(price * 0.1);
    const newBal = litCoins + earned;
    setLitCoins(newBal);
    setLitCoinBalance(newBal);
    showToast(`🏪 Agent listed! You earned ${earned} 🪙 listing bonus.`, 'info');
    setSellModalAgent(null);
    setSellPrice('');
  }, [litCoins]);

  const stats: Record<string, number | string> = {
    total: agents.length,
    free: agents.filter(a => a.price_cents === 0).length,
    installed: installedAgents.size,
    coins: litCoins + ' 🪙',
  };

  return (
    <div style={{ backgroundColor: T.bgColor, minHeight: '100vh', color: T.textColor, fontFamily: 'monospace' }}>
      {/* Toast notification */}
      {toast && (
        <div style={{ position: 'fixed', top: '80px', right: '20px', zIndex: 200, padding: '12px 20px', backgroundColor: toast.type === 'success' ? '#0a2e0a' : toast.type === 'error' ? '#2e0a0a' : '#0a1a2e', border: '2px solid ' + (toast.type === 'success' ? T.accentColor : toast.type === 'error' ? '#ff4444' : T.linkColor), color: toast.type === 'success' ? T.accentColor : toast.type === 'error' ? '#ff4444' : T.linkColor, fontSize: '12px', fontWeight: 'bold', maxWidth: '320px' }}>
          {toast.msg}
        </div>
      )}

      <div style={{ borderBottom: '2px solid ' + T.borderColor, padding: '32px 24px', textAlign: 'center', background: 'linear-gradient(180deg, ' + T.boxBg + ' 0%, ' + T.bgColor + ' 100%)' }}>
        <h1 style={{ color: T.headerColor, fontSize: '32px', fontWeight: 'bold', letterSpacing: '3px', marginBottom: '8px' }}>🤖 AGENT MARKETPLACE</h1>
        <p style={{ color: T.textColor, fontSize: '13px', opacity: 0.7, maxWidth: '500px', margin: '0 auto 12px' }}>Discover, install, and deploy AI agents to your workspace</p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '16px' }}>
          <button onClick={earnCoins} style={{ padding: '6px 14px', backgroundColor: 'rgba(255,215,0,0.15)', border: '1px solid gold', color: 'gold', fontSize: '11px', cursor: 'pointer', fontFamily: 'monospace', fontWeight: 'bold' }}>🪙 Daily Bonus</button>
          <button onClick={() => showToast('Buy LitCoins: connect wallet coming soon!', 'info')} style={{ padding: '6px 14px', backgroundColor: 'rgba(255,215,0,0.1)', border: '1px solid ' + T.borderColor, color: T.textColor, fontSize: '11px', cursor: 'pointer', fontFamily: 'monospace' }}>💳 Buy LitCoins</button>
        </div>
        <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
          {[{ label: 'Total Agents', value: stats.total }, { label: 'Free', value: stats.free }, { label: 'Installed', value: stats.installed }, { label: 'Your Wallet', value: stats.coins }].map(stat => (
            <div key={stat.label} style={{ padding: '8px 16px', border: '1px solid ' + (stat.label === 'Your Wallet' ? 'gold' : T.borderColor), backgroundColor: stat.label === 'Your Wallet' ? 'rgba(255,215,0,0.08)' : 'rgba(0,0,0,0.3)' }}>
              <div style={{ color: stat.label === 'Your Wallet' ? 'gold' : T.accentColor, fontSize: '18px', fontWeight: 'bold' }}>{stat.value}</div>
              <div style={{ fontSize: '9px', color: T.textColor, opacity: 0.7 }}>{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '16px 24px', borderBottom: '1px solid ' + T.borderColor, display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', backgroundColor: T.boxBg }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', flex: 1 }}>
          <button onClick={() => setSelectedCategory('')} style={{ padding: '6px 12px', fontSize: '11px', border: '1px solid ' + (selectedCategory === '' ? T.accentColor : T.borderColor), backgroundColor: selectedCategory === '' ? 'rgba(255,255,0,0.15)' : 'transparent', color: selectedCategory === '' ? T.accentColor : T.textColor, cursor: 'pointer', fontFamily: 'monospace' }}>
            🌟 All ({agents.length})
          </button>
          {categories.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat === selectedCategory ? '' : cat)} style={{ padding: '6px 12px', fontSize: '11px', border: '1px solid ' + (selectedCategory === cat ? T.accentColor : T.borderColor), backgroundColor: selectedCategory === cat ? 'rgba(255,255,0,0.15)' : 'transparent', color: selectedCategory === cat ? T.accentColor : T.textColor, cursor: 'pointer', fontFamily: 'monospace', textTransform: 'capitalize' }}>
              {(CATEGORY_ICONS[cat] || '🔹') + ' ' + cat + ' (' + agents.filter(a => a.category === cat).length + ')'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input type='text' value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder='🔍 Search agents...' style={{ padding: '8px 12px', backgroundColor: T.bgColor, border: '1px solid ' + T.borderColor, color: '#e0e0e0', fontSize: '12px', fontFamily: 'monospace', width: '200px', outline: 'none' }} />
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ padding: '8px', backgroundColor: T.bgColor, border: '1px solid ' + T.borderColor, color: T.textColor, fontSize: '11px', fontFamily: 'monospace', cursor: 'pointer' }}>
            <option value='featured'>⭐ Featured</option>
            <option value='popular'>🔥 Popular</option>
            <option value='rating'>⭐ Rating</option>
            <option value='price'>💰 Price</option>
            <option value='name'>🔤 Name</option>
          </select>
          <Link href='/builder' style={{ padding: '8px 14px', backgroundColor: T.linkColor, color: 'white', textDecoration: 'none', fontSize: '11px', fontWeight: 'bold' }}>🚀 My Dock</Link>
          <div style={{ padding: '8px 12px', border: '1px solid gold', color: 'gold', fontSize: '11px', fontWeight: 'bold', backgroundColor: 'rgba(255,215,0,0.08)' }}>🪙 {litCoins}</div>
        </div>
      </div>

      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
        {featuredAgents.length > 0 && !searchQuery && (
          <div style={{ marginBottom: '32px' }}>
            <div style={{ color: T.accentColor, fontSize: '11px', letterSpacing: '2px', marginBottom: '12px', fontWeight: 'bold' }}>⭐ FEATURED AGENTS</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
              {featuredAgents.map(agent => <AgentCard key={agent.id} agent={agent} isInstalled={installedAgents.has(agent.id)} onInstall={() => installAgent(agent.id)} onPreview={() => setPreviewAgent(agent)} theme={T} />)}
            </div>
          </div>
        )}
        <div>
          <div style={{ color: T.accentColor, fontSize: '11px', letterSpacing: '2px', marginBottom: '12px', fontWeight: 'bold' }}>
            {selectedCategory ? (CATEGORY_ICONS[selectedCategory] || '🔹') + ' ' + selectedCategory.toUpperCase() : '🔥 ALL AGENTS'}
            <span style={{ color: T.textColor, opacity: 0.5, marginLeft: '8px' }}>({filteredAgents.length})</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {(searchQuery ? filteredAgents : regularAgents).map(agent => <AgentCard key={agent.id} agent={agent} isInstalled={installedAgents.has(agent.id)} onInstall={() => installAgent(agent.id)} onPreview={() => setPreviewAgent(agent)} theme={T} />)}
          </div>
        </div>
        {filteredAgents.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: T.textColor, opacity: 0.5 }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔍</div>
            <div>No agents found matching your search.</div>
          </div>
        )}
      </div>

      {previewAgent && (
        <div onClick={() => setPreviewAgent(null)} style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '600px', width: '100%', backgroundColor: T.boxBg, border: '2px solid ' + T.borderColor, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ padding: '24px', borderBottom: '1px solid ' + T.borderColor, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                <div style={{ fontSize: '48px' }}>{previewAgent.avatar_url}</div>
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
                  <button onClick={() => { installAgent(previewAgent.id); if (previewAgent.price_cents === 0 || litCoins >= previewAgent.price_cents) setPreviewAgent(null); }} style={{ flex: 1, padding: '12px', backgroundColor: T.linkColor, color: 'white', border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>
                    {previewAgent.price_cents === 0 ? '🚀 Install Free' : '🪙 Buy — ' + formatPrice(previewAgent.price_cents)}
                  </button>
                )}
                <Link href='/builder' onClick={() => setPreviewAgent(null)} style={{ padding: '12px 20px', border: '2px solid ' + T.linkColor, color: T.linkColor, textDecoration: 'none', fontWeight: 'bold', fontSize: '12px', display: 'flex', alignItems: 'center' }}>Open Builder</Link>
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
              List <strong style={{ color: T.headerColor }}>{sellModalAgent.name}</strong> on the marketplace. Other users can buy it with 🪙 LitCoins. You earn 90% of each sale.
            </p>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ color: T.accentColor, fontSize: '10px', letterSpacing: '1px', display: 'block', marginBottom: '6px' }}>SET PRICE (🪙 LitCoins)</label>
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

function AgentCard({ agent, isInstalled, onInstall, onPreview, theme }: { agent: Agent; isInstalled: boolean; onInstall: () => void; onPreview: () => void; theme: Record<string, string> }) {
  const T = theme;
  const [hovered, setHovered] = useState(false);
  return (
    <div onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} style={{ border: '1px solid ' + (hovered ? T.accentColor : T.borderColor), backgroundColor: 'rgba(0,0,0,0.3)', transition: 'all 0.2s', transform: hovered ? 'translateY(-4px)' : 'translateY(0)', boxShadow: hovered ? '0 8px 24px rgba(0,255,255,0.08)' : 'none' }}>
      <div style={{ padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ fontSize: '32px' }}>{agent.avatar_url}</div>
          <div style={{ padding: '4px 8px', fontSize: '10px', fontWeight: 'bold', backgroundColor: agent.price_cents === 0 ? T.accentColor : T.headerColor, color: 'black' }}>{formatPrice(agent.price_cents)}</div>
        </div>
        <div style={{ color: T.headerColor, fontSize: '14px', fontWeight: 'bold', marginBottom: '4px' }}>{agent.name}</div>
        <div style={{ color: T.textColor, fontSize: '10px', opacity: 0.7, textTransform: 'capitalize', marginBottom: '8px' }}>{agent.category} · ⭐ {agent.rating} · 📥 {agent.installs}</div>
        <p style={{ color: T.textColor, fontSize: '11px', lineHeight: 1.5, marginBottom: '12px', height: '50px', overflow: 'hidden' }}>{agent.description}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
          {agent.features.slice(0, 2).map((f, i) => <span key={i} style={{ padding: '3px 8px', backgroundColor: 'rgba(255,0,128,0.12)', border: '1px solid ' + T.linkColor, color: T.linkColor, fontSize: '9px' }}>{f}</span>)}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button onClick={onPreview} style={{ flex: 1, padding: '8px', border: '1px solid ' + T.linkColor, color: T.linkColor, backgroundColor: 'transparent', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>👁 Preview</button>
          {isInstalled ? (
            <button disabled style={{ flex: 1, padding: '8px', backgroundColor: '#333', color: '#666', border: 'none', fontSize: '11px' }}>✓ Installed</button>
          ) : (
            <button onClick={onInstall} style={{ flex: 1, padding: '8px', backgroundColor: T.linkColor, color: 'white', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>🚀 Install</button>
          )}
        </div>
      </div>
    </div>
  );
}
