'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect, useCallback } from 'react';
import { useTheme, darkSkins, lightSkins, type SkinPreset } from '@/context/ThemeContext';
import { useProfile } from '@/context/ProfileContext';
import { useClerkAuth } from '@/hooks/useClerkAuth';
import Link from 'next/link';
import PageShell from '@/components/PageShell';
import { WALLPAPERS } from '@/lib/wallpapers';
import {
  Palette, User, Bot, Monitor, Sparkles, Moon, Sun, Check,
  Zap, RefreshCw, Code, Trash2, Eye, Camera, ImageIcon, MapPin,
  Globe, AtSign, Loader2, Wand2, Link2, Hash,
  Fingerprint, Upload, X, ChevronDown, ChevronUp, Terminal,
  Activity, Wifi, Cpu, Database, AlertTriangle, Music, Volume2, VolumeX
} from 'lucide-react';

const skinLabels: Record<SkinPreset, string> = {
  cyberpunk: 'Navy Cyan', retro: 'Amber', ocean: 'Deep Aqua', sunset: 'Warm Ember',
  matrix: 'Matrix', pink: 'Rose', synthwave: 'Violet', volcanic: 'Coral',
  gold: 'Gold', arctic: 'Ice', emerald: 'Forest', midnight: 'Midnight',
  neon: 'Neon', blood: 'Crimson', cosmic: 'Cosmic', miami: 'Miami',
};

const accentHex: Record<string, string> = {
  'neon-green': '#06b6d4', 'hot-pink': '#ec4899', 'electric-blue': '#3b82f6',
  'cyber-yellow': '#f59e0b', 'matrix-green': '#8b5cf6', 'sunset-orange': '#f97316',
  'ocean-blue': '#0ea5e9', 'purple-haze': '#a855f7',
};

type TabId = 'theme' | 'profile' | 'agents' | 'interface' | 'system' | 'music';

const TABS: { id: TabId; label: string; icon: typeof Palette; shortcut: string }[] = [
  { id: 'theme', label: 'Theme', icon: Palette, shortcut: 'T' },
  { id: 'profile', label: 'Identity', icon: Fingerprint, shortcut: 'I' },
  { id: 'agents', label: 'Agents', icon: Bot, shortcut: 'A' },
  { id: 'interface', label: 'UI', icon: Monitor, shortcut: 'U' },
  { id: 'music', label: 'Audio', icon: Music, shortcut: 'M' },
  { id: 'system', label: 'SYS', icon: Terminal, shortcut: 'S' },
];

// Glitch text effect component
function GlitchText({ text, className = '' }: { text: string; className?: string }) {
  return (
    <span className={`relative inline-block ${className}`}>
      <span className="relative z-10">{text}</span>
      <span className="absolute top-0 left-0 -ml-[2px] opacity-50 text-red-500 animate-pulse" style={{ clipPath: 'inset(0 0 50% 0)' }}>{text}</span>
      <span className="absolute top-0 left-0 ml-[2px] opacity-50 text-cyan-500 animate-pulse" style={{ clipPath: 'inset(50% 0 0 0)', animationDelay: '0.1s' }}>{text}</span>
    </span>
  );
}

// Compact field component
function Field({ label, value, onChange, icon: Icon, prefix, type = 'text', rows }: {
  label: string; value: string; onChange: (v: string) => void;
  icon?: typeof MapPin; prefix?: string; type?: 'text' | 'textarea'; rows?: number;
}) {
  const [isFocused, setIsFocused] = useState(false);
  return (
    <div className="group">
      <label className="text-[10px] uppercase tracking-wider opacity-40 mb-1 block font-mono">{label}</label>
      <div className={`relative flex items-center border transition-all ${isFocused ? 'border-cyan-500/50 shadow-[0_0_8px_rgba(6,182,212,0.2)]' : 'border-white/10'}`} style={{ background: 'rgba(0,0,0,0.3)' }}>
        {prefix && <span className="pl-2 text-[11px] opacity-30 font-mono">{prefix}</span>}
        {Icon && <Icon size={12} className="ml-2 opacity-30" />}
        {type === 'textarea' ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            rows={rows || 3}
            className="w-full bg-transparent p-2 text-[12px] outline-none resize-none font-mono"
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            className="w-full bg-transparent p-2 text-[12px] outline-none font-mono"
            style={{ paddingLeft: (prefix || Icon) ? '1.5rem' : '0.5rem' }}
          />
        )}
      </div>
    </div>
  );
}

// Collapsible section
function Section({ title, icon: Icon, children, defaultOpen = true }: {
  title: string; icon: typeof Palette; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-white/10" style={{ background: 'rgba(15,15,25,0.6)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 text-left hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon size={14} className="opacity-50" />
          <span className="text-[11px] font-bold uppercase tracking-wider">{title}</span>
        </div>
        {open ? <ChevronUp size={14} className="opacity-40" /> : <ChevronDown size={14} className="opacity-40" />}
      </button>
      {open && <div className="p-3 pt-0 space-y-3 border-t border-white/5">{children}</div>}
    </div>
  );
}

// Toggle switch
function Toggle({ label, desc, value, onChange }: { label: string; desc?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="text-[12px] font-medium">{label}</div>
        {desc && <div className="text-[10px] opacity-40">{desc}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`w-8 h-4 border transition-all ${value ? 'border-cyan-500 bg-cyan-500/20' : 'border-white/20'}`}
      >
        <div className={`w-3 h-3 bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

// Color swatch
function Swatch({ color, active, onClick, label }: { color: string; active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 p-2 border transition-all hover:scale-105 ${active ? 'border-white/40' : 'border-white/10'}`}
      style={{ background: active ? `${color}15` : 'transparent' }}
    >
      <div className="w-6 h-6 border border-white/20" style={{ background: color }} />
      <span className="text-[9px] opacity-60 uppercase">{label}</span>
    </button>
  );
}

// Generate image button
function GenBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="px-3 py-2 border border-white/20 text-[10px] uppercase tracking-wider hover:border-cyan-500/50 hover:bg-cyan-500/10 transition-all disabled:opacity-50"
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
    </button>
  );
}

export default function SettingsPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { theme, resolvedColors, setMode, setSkin, setAccent, setBackgroundMode, resetTheme } = useTheme();
  const { profile, updateProfile, resetProfile } = useProfile();

  const [activeTab, setActiveTab] = useState<TabId>('theme');
  const [saved, setSaved] = useState(false);
  const [generating, setGenerating] = useState<string | null>(null);

  // UI prefs
  const [animSpeed, setAnimSpeed] = useState('normal');
  const [compactMode, setCompactMode] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [soundEffects, setSoundEffects] = useState(false);
  const [customCSS, setCustomCSS] = useState('');

  // Music prefs
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicVolume, setMusicVolume] = useState(50);
  const [musicAutoPlay, setMusicAutoPlay] = useState(false);
  const [musicMuteOnLeave, setMusicMuteOnLeave] = useState(true);

  useEffect(() => {
    setAnimSpeed(localStorage.getItem('litlabs-anim-speed') || 'normal');
    setCompactMode(localStorage.getItem('litlabs-compact') === 'true');
    setReducedMotion(localStorage.getItem('litlabs-reduced-motion') === 'true');
    setSoundEffects(localStorage.getItem('litlabs-sound') === 'true');
    setCustomCSS(localStorage.getItem('litlabs-custom-css') || '');
    // Load music prefs
    try {
      const musicPrefs = JSON.parse(localStorage.getItem('litlabs-music-prefs') || '{}');
      setMusicEnabled(musicPrefs.enabled ?? false);
      setMusicVolume(musicPrefs.volume ?? 50);
      setMusicAutoPlay(musicPrefs.autoPlay ?? false);
      setMusicMuteOnLeave(musicPrefs.muteOnLeave ?? true);
    } catch { /* ignore */ }
  }, []);

  const showSaved = useCallback(() => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, []);

  const save = (key: string, val: string | boolean) => {
    localStorage.setItem(`litlabs-${key}`, String(val));
    showSaved();
  };

  const generateImage = async (type: 'avatar' | 'cover') => {
    setGenerating(type);
    try {
      const prompt = type === 'avatar'
        ? 'Professional portrait avatar, abstract digital art style, single figure centered, dark background with subtle purple and blue neon glow, futuristic, clean, high quality, square composition'
        : 'Abstract futuristic technology banner, dark purple and blue gradient, subtle grid lines, soft glowing particles, wide cinematic composition, clean minimal, high quality';
      const res = await fetch('/api/media/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mediaType: 'image', provider: 'pollinations', model: 'flux', width: type === 'avatar' ? 512 : 1280, height: type === 'avatar' ? 512 : 640 }),
      });
      const data = await res.json();
      if (data.url) {
        updateProfile({ [type === 'avatar' ? 'avatarUrl' : 'coverUrl']: data.url });
        showSaved();
      }
    } catch (e) {
      console.error('Gen failed', e);
    } finally {
      setGenerating(null);
    }
  };

  const skinPresets: SkinPreset[] = ['cyberpunk', 'retro', 'ocean', 'sunset', 'matrix', 'pink', 'synthwave', 'volcanic', 'gold', 'arctic', 'emerald', 'midnight', 'neon', 'blood', 'cosmic', 'miami'];
  const bgModes = ['constellation', 'nebula', 'waves', 'minimal'] as const;
  const accents = ['electric-blue', 'purple-haze', 'hot-pink', 'cyber-yellow', 'neon-green', 'matrix-green', 'sunset-orange', 'ocean-blue'];

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a12] text-cyan-400 font-mono">
        <div className="text-center">
          <div className="text-2xl mb-2 animate-pulse">▓▒░</div>
          <div className="text-xs opacity-50">SYSTEM_INIT...</div>
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <PageShell title="Access Denied">
        <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 font-mono">
          <AlertTriangle size={32} className="text-red-500" />
          <p className="text-xs opacity-60">AUTHENTICATION REQUIRED</p>
          <Link href="/login" className="px-4 py-2 border border-cyan-500/50 text-cyan-400 text-xs hover:bg-cyan-500/10">
            LOGIN &gt;&gt;
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Settings" className="font-mono">
      <div className="max-w-6xl mx-auto px-3 py-4">
        {/* Terminal Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Terminal size={14} className="text-cyan-400" />
              <span className="text-[10px] uppercase tracking-widest opacity-40">System Config</span>
            </div>
            <h1 className="text-xl font-bold tracking-tight">
              <GlitchText text="SETTINGS" />
            </h1>
          </div>
          <div className="flex items-center gap-3 text-[10px] opacity-40">
            <span className="flex items-center gap-1"><Activity size={10} className="text-green-400" /> ONLINE</span>
            <span>v2.0.6</span>
          </div>
        </div>

        {/* Compact Tab Nav */}
        <div className="flex gap-1 mb-4 overflow-x-auto pb-2">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold uppercase tracking-wider border transition-all whitespace-nowrap ${
                  isActive ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400' : 'border-white/10 hover:border-white/30'
                }`}
              >
                <Icon size={12} />
                {tab.label}
                <span className="opacity-30 ml-1">[{tab.shortcut}]</span>
              </button>
            );
          })}
        </div>

        {/* THEME TAB */}
        {activeTab === 'theme' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Section title="Background" icon={Sparkles}>
              <div className="grid grid-cols-4 gap-1">
                {bgModes.map((mode) => (
                  <button
                    key={mode}
                    onClick={() => { setBackgroundMode(mode); showSaved(); }}
                    className={`p-2 text-[9px] uppercase border transition-all ${
                      theme.backgroundMode === mode ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Mode" icon={Monitor}>
              <div className="flex gap-2">
                <button
                  onClick={() => { setMode('dark'); showSaved(); }}
                  className={`flex-1 flex items-center justify-center gap-2 p-2 border text-[11px] ${
                    theme.mode === 'dark' ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10'
                  }`}
                >
                  <Moon size={12} /> Dark
                </button>
                <button
                  onClick={() => { setMode('light'); showSaved(); }}
                  className={`flex-1 flex items-center justify-center gap-2 p-2 border text-[11px] ${
                    theme.mode === 'light' ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10'
                  }`}
                >
                  <Sun size={12} /> Light
                </button>
              </div>
            </Section>

            <Section title="Palette" icon={Palette}>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
                {skinPresets.map((skin) => {
                  const colors = theme.mode === 'light' ? lightSkins[skin] : darkSkins[skin];
                  return (
                    <Swatch
                      key={skin}
                      color={colors.accentColor}
                      active={theme.skin === skin}
                      onClick={() => { setSkin(skin); showSaved(); }}
                      label={skinLabels[skin]}
                    />
                  );
                })}
              </div>
            </Section>

            <Section title="Accent" icon={Zap}>
              <div className="flex flex-wrap gap-1">
                {accents.map((accent) => (
                  <button
                    key={accent}
                    onClick={() => { setAccent(accent as any); showSaved(); }}
                    className={`w-8 h-8 border transition-all hover:scale-110 ${
                      theme.accent === accent ? 'border-white' : 'border-white/20'
                    }`}
                    style={{ background: accentHex[accent] }}
                    title={accent}
                  />
                ))}
              </div>
            </Section>

            <div className="lg:col-span-2 flex justify-end">
              <button
                onClick={() => { resetTheme(); showSaved(); }}
                className="flex items-center gap-2 px-3 py-2 border border-white/10 text-[10px] uppercase hover:border-red-500/50 hover:text-red-400 transition-colors"
              >
                <RefreshCw size={12} /> Reset Defaults
              </button>
            </div>
          </div>
        )}

        {/* PROFILE TAB */}
        {activeTab === 'profile' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="lg:col-span-2 border border-white/10 overflow-hidden">
              <div className="h-24 relative" style={{ background: profile.coverUrl ? `url(${profile.coverUrl}) center/cover` : 'linear-gradient(135deg, #ff00a050, #00f0ff30)' }}>
                <div className="absolute -bottom-6 left-4">
                  <div className="w-16 h-16 border-2 border-black overflow-hidden" style={{ background: profile.avatarUrl ? 'transparent' : '#1a1a2e' }}>
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User size={24} className="m-4 opacity-50" />
                    )}
                  </div>
                </div>
              </div>
              <div className="pt-8 pb-3 px-4">
                <div className="text-sm font-bold">{profile.displayName || 'Unknown'}</div>
                <div className="text-[10px] opacity-40">@{profile.username || 'user'}</div>
              </div>
            </div>

            <Section title="Identity" icon={Fingerprint}>
              <div className="space-y-2">
                <Field label="Display Name" value={profile.displayName || ''} onChange={(v) => updateProfile({ displayName: v })} />
                <Field label="Username" value={profile.username || ''} onChange={(v) => updateProfile({ username: v })} prefix="@" />
                <Field label="Mood" value={profile.mood || ''} onChange={(v) => updateProfile({ mood: v })} />
                <Field label="Location" value={profile.location || ''} onChange={(v) => updateProfile({ location: v })} icon={MapPin} />
                <Field label="Website" value={profile.website || ''} onChange={(v) => updateProfile({ website: v })} icon={Globe} />
                <Field label="Bio" value={profile.bio || ''} onChange={(v) => updateProfile({ bio: v })} type="textarea" rows={3} />
              </div>
            </Section>

            <Section title="Assets" icon={Camera}>
              <div className="space-y-2">
                <div className="flex-1">
                  <label className="text-[10px] uppercase tracking-wider opacity-40 mb-1 block">Avatar</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={profile.avatarUrl || ''}
                      onChange={(e) => updateProfile({ avatarUrl: e.target.value })}
                      className="flex-1 p-2 text-[11px] bg-black/30 border border-white/10 outline-none focus:border-cyan-500/50"
                      placeholder="https://..."
                    />
                    <GenBtn onClick={() => generateImage('avatar')} loading={generating === 'avatar'} />
                  </div>
                </div>
                <div className="flex-1">
                  <label className="text-[10px] uppercase tracking-wider opacity-40 mb-1 block">Cover</label>
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={profile.coverUrl || ''}
                      onChange={(e) => updateProfile({ coverUrl: e.target.value })}
                      className="flex-1 p-2 text-[11px] bg-black/30 border border-white/10 outline-none focus:border-cyan-500/50"
                      placeholder="https://..."
                    />
                    <GenBtn onClick={() => generateImage('cover')} loading={generating === 'cover'} />
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Social" icon={Link2}>
              <div className="space-y-2">
                <Field label="X/Twitter" value={profile.socialLinks?.twitter || ''} onChange={(v) => updateProfile({ socialLinks: { ...profile.socialLinks, twitter: v } })} icon={AtSign} />
                <Field label="Instagram" value={profile.socialLinks?.instagram || ''} onChange={(v) => updateProfile({ socialLinks: { ...profile.socialLinks, instagram: v } })} icon={AtSign} />
                <Field label="GitHub" value={profile.socialLinks?.github || ''} onChange={(v) => updateProfile({ socialLinks: { ...profile.socialLinks, github: v } })} icon={Hash} />
                <Field label="LinkedIn" value={profile.socialLinks?.linkedin || ''} onChange={(v) => updateProfile({ socialLinks: { ...profile.socialLinks, linkedin: v } })} icon={Link2} />
              </div>
            </Section>

            <div className="lg:col-span-2 flex justify-end">
              <button
                onClick={() => { resetProfile(); showSaved(); }}
                className="flex items-center gap-2 px-3 py-2 border border-white/10 text-[10px] uppercase hover:border-red-500/50 hover:text-red-400 transition-colors"
              >
                <RefreshCw size={12} /> Reset Profile
              </button>
            </div>
          </div>
        )}

        {/* AGENTS TAB */}
        {activeTab === 'agents' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Section title="Webhook Endpoint" icon={Link2}>
              <p className="text-[10px] opacity-60 mb-2">ActivePieces flow endpoint</p>
              <code className="block p-3 bg-black/30 border border-white/10 text-[9px] break-all text-cyan-400 font-mono">
                https://cloud.activepieces.com/api/v1/webhooks/VoccE3SEr4bciLvkThTlO
              </code>
            </Section>

            <Section title="Core Agents" icon={Bot}>
              <div className="space-y-1">
                {[
                  { name: 'Director', role: 'Orchestrator', color: '#00ffff' },
                  { name: 'Champion', role: 'General Assistant', color: '#ff0080' },
                  { name: 'Code Champion', role: 'Software Expert', color: '#00ff41' },
                  { name: 'Social Dominator', role: 'Growth & Viral', color: '#ff6b6b' },
                  { name: 'Data Slayer', role: 'Analytics', color: '#ffff00' },
                  { name: 'Writing Coach', role: 'Copy & Content', color: '#ff9ff3' },
                ].map((a) => (
                  <div key={a.name} className="flex items-center gap-3 p-2 border border-white/10 bg-black/20">
                    <span className="w-2 h-2" style={{ backgroundColor: a.color }} />
                    <span className="text-[11px] font-bold">{a.name}</span>
                    <span className="text-[10px] opacity-40 ml-auto">{a.role}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}

        {/* INTERFACE TAB */}
        {activeTab === 'interface' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Section title="Animation" icon={Zap}>
              <div className="grid grid-cols-4 gap-1">
                {['fast', 'normal', 'slow', 'off'].map((speed) => (
                  <button
                    key={speed}
                    onClick={() => { setAnimSpeed(speed); save('anim-speed', speed); }}
                    className={`p-2 text-[9px] uppercase border transition-all ${
                      animSpeed === speed ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10 hover:border-white/30'
                    }`}
                  >
                    {speed}
                  </button>
                ))}
              </div>
            </Section>

            <Section title="Density" icon={Monitor}>
              <div className="grid grid-cols-2 gap-1">
                <button
                  onClick={() => { setCompactMode(true); save('compact', true); }}
                  className={`p-2 text-[9px] uppercase border transition-all ${
                    compactMode ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10 hover:border-white/30'
                  }`}
                >
                  Compact
                </button>
                <button
                  onClick={() => { setCompactMode(false); save('compact', false); }}
                  className={`p-2 text-[9px] uppercase border transition-all ${
                    !compactMode ? 'border-cyan-500/50 bg-cyan-500/10' : 'border-white/10 hover:border-white/30'
                  }`}
                >
                  Comfortable
                </button>
              </div>
            </Section>

            <Section title="Accessibility" icon={Eye}>
              <Toggle label="Reduced Motion" desc="Disable animations" value={reducedMotion} onChange={(v) => { setReducedMotion(v); save('reduced-motion', v); }} />
              <Toggle label="Sound Effects" desc="UI audio cues" value={soundEffects} onChange={(v) => { setSoundEffects(v); save('sound', v); }} />
            </Section>

            <Section title="Custom CSS" icon={Code}>
              <textarea
                value={customCSS}
                onChange={(e) => setCustomCSS(e.target.value)}
                onBlur={(e) => save('custom-css', e.target.value)}
                rows={5}
                placeholder=":root { --border: #333; }"
                className="w-full p-3 bg-black/30 border border-white/10 text-[11px] font-mono outline-none focus:border-cyan-500/50 resize-none"
              />
              <button
                onClick={() => { setCustomCSS(''); save('custom-css', ''); }}
                className="w-full mt-2 p-2 border border-white/10 text-[9px] uppercase hover:border-cyan-500/50 hover:bg-cyan-500/10 transition-all"
              >
                Clear CSS
              </button>
            </Section>
          </div>
        )}

        {/* MUSIC TAB */}
        {activeTab === 'music' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Section title="Background Music" icon={Music}>
              <div className="space-y-4">
                <Toggle
                  label="Enable Music Player"
                  desc="Show the music player widget on all pages"
                  value={musicEnabled}
                  onChange={(v) => {
                    setMusicEnabled(v);
                    const prefs = JSON.parse(localStorage.getItem('litlabs-music-prefs') || '{}');
                    prefs.enabled = v;
                    localStorage.setItem('litlabs-music-prefs', JSON.stringify(prefs));
                    showSaved();
                  }}
                />
                <Toggle
                  label="Auto-play on Load"
                  desc="Start playing music when you open the site"
                  value={musicAutoPlay}
                  onChange={(v) => {
                    setMusicAutoPlay(v);
                    const prefs = JSON.parse(localStorage.getItem('litlabs-music-prefs') || '{}');
                    prefs.autoPlay = v;
                    localStorage.setItem('litlabs-music-prefs', JSON.stringify(prefs));
                    showSaved();
                  }}
                />
                <Toggle
                  label="Mute on Tab Leave"
                  desc="Pause music when you switch to another tab"
                  value={musicMuteOnLeave}
                  onChange={(v) => {
                    setMusicMuteOnLeave(v);
                    const prefs = JSON.parse(localStorage.getItem('litlabs-music-prefs') || '{}');
                    prefs.muteOnLeave = v;
                    localStorage.setItem('litlabs-music-prefs', JSON.stringify(prefs));
                    showSaved();
                  }}
                />
              </div>
            </Section>

            <Section title="Volume Control" icon={Volume2}>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-2">
                    <span className="text-[11px] opacity-60">Master Volume</span>
                    <span className="text-[11px] opacity-60">{musicVolume}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={musicVolume}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setMusicVolume(val);
                      const prefs = JSON.parse(localStorage.getItem('litlabs-music-prefs') || '{}');
                      prefs.volume = val;
                      localStorage.setItem('litlabs-music-prefs', JSON.stringify(prefs));
                    }}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                    style={{
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      accentColor: '#06b6d4',
                    }}
                  />
                </div>
                <p className="text-[10px] opacity-40">
                  The music player appears in the bottom-right corner when enabled. 
                  You can minimize it or access full controls by clicking on it.
                </p>
                <div className="p-3 border border-white/10 bg-black/20">
                  <div className="text-[10px] opacity-60 mb-2">// Currently Playing</div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🎵</span>
                    <div>
                      <div className="text-xs font-bold">Synthwave Radio</div>
                      <div className="text-[9px] opacity-50">Curated playlist • 5 tracks</div>
                    </div>
                  </div>
                </div>
              </div>
            </Section>
          </div>
        )}

        {/* SYSTEM TAB */}
        {activeTab === 'system' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Section title="Environment" icon={Terminal}>
              <div className="space-y-1 text-[10px] font-mono">
                {[
                  { key: 'CLERK_AUTH', status: 'CONFIGURED', color: 'text-green-400' },
                  { key: 'GEMINI_AI', status: 'ACTIVE', color: 'text-green-400' },
                  { key: 'OPENROUTER', status: 'ACTIVE', color: 'text-green-400' },
                ].map((env) => (
                  <div key={env.key} className="flex justify-between p-2 border border-white/10 bg-black/20">
                    <span className="opacity-60">{env.key}</span>
                    <span className={env.color}>{env.status}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Data Management" icon={Database}>
              <p className="text-[10px] opacity-60 mb-3">// Erase all local config and reset system</p>
              <button
                onClick={() => { localStorage.clear(); window.location.reload(); }}
                className="w-full p-3 border border-red-500/50 text-red-400 text-[10px] uppercase hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={12} className="inline-block mr-2" /> WIPE_ALL_DATA
              </button>
            </Section>
          </div>
        )}

        {/* Saved toast */}
        {saved && (
          <div className="fixed bottom-6 right-6 px-4 py-2 border border-cyan-500/50 bg-black/80 text-cyan-400 text-[10px] flex items-center gap-2 shadow-lg animate-pulse z-50 font-mono">
            <Check size={12} /> [DATA_SAVED]
          </div>
        )}
      </div>
    </PageShell>
  );
}
