'use client';
export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useClerkAuth } from '@/hooks/useClerkAuth';
import { useProfile } from '@/context/ProfileContext';
import {
  Zap, Sparkles, Heart, MessageSquare, Share2, TrendingUp, Users,
  Plus, Image as ImageIcon, Film, BarChart3, Crown, Send, Flame
} from 'lucide-react';

// Retro neon palette
const C = {
  bgColor: '#0a0a12',
  textColor: '#e0e0ff',
  textMuted: '#8888aa',
  linkColor: '#ff00a0',
  headerColor: '#00f0ff',
  borderColor: '#2a2a45',
  accentColor: '#ff00a0',
  boxBg: '#151520',
  success: '#00ff41',
};

function RetroBackground() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const stars = Array.from({ length: 50 }, (_, i) => ({
    id: i,
    left: `${Math.random() * 100}%`,
    top: `${Math.random() * 60}%`,
    size: Math.random() * 2 + 1,
    delay: Math.random() * 3,
    duration: Math.random() * 2 + 2,
  }));

  const orbs = [
    { color: '#ff00a0', size: 300, left: '10%', top: '20%', duration: 15 },
    { color: '#00f0ff', size: 250, left: '70%', top: '60%', duration: 18 },
    { color: '#00ff41', size: 200, left: '40%', top: '80%', duration: 20 },
    { color: '#ff6b6b', size: 180, left: '85%', top: '10%', duration: 12 },
  ];

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" style={{ background: 'linear-gradient(180deg, #0a0a12 0%, #151520 50%, #1a0a1a 100%)' }}>
      {/* Animated stars */}
      {stars.map((star) => (
        <div
          key={star.id}
          className="absolute rounded-full"
          style={{
            left: star.left,
            top: star.top,
            width: star.size,
            height: star.size,
            background: '#fff',
            boxShadow: `0 0 ${star.size * 4}px ${star.size}px rgba(255,255,255,0.5)`,
            animation: `twinkle ${star.duration}s ease-in-out ${star.delay}s infinite`,
            opacity: 0.3,
          }}
        />
      ))}

      {/* Animated gradient orbs */}
      {orbs.map((orb, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            width: orb.size,
            height: orb.size,
            left: orb.left,
            top: orb.top,
            background: `radial-gradient(circle, ${orb.color}40 0%, ${orb.color}10 40%, transparent 70%)`,
            filter: 'blur(40px)',
            animation: `float ${orb.duration}s ease-in-out infinite`,
          }}
        />
      ))}

      {/* Animated moving grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to bottom, transparent 0%, ${C.bgColor} 100%),
            linear-gradient(rgba(0,240,255,0.4) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,0,160,0.3) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 60px 60px, 60px 60px',
          perspective: '500px',
          transform: 'rotateX(60deg) translateY(-100px)',
          transformOrigin: 'center top',
          animation: 'gridMove 8s linear infinite',
          opacity: 0.4,
        }}
      />

      {/* Secondary subtle grid */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
          backgroundSize: '100px 100px',
        }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 0%, rgba(10,10,18,0.8) 100%)',
        }}
      />

      <style jsx>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.2; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.5); }
        }
        @keyframes float {
          0%, 100% { transform: translate(0, 0) scale(1); }
          25% { transform: translate(30px, -30px) scale(1.1); }
          50% { transform: translate(0, -60px) scale(1); }
          75% { transform: translate(-30px, -30px) scale(0.9); }
        }
        @keyframes gridMove {
          0% { background-position: 0 0, 0 0, 0 0; }
          100% { background-position: 0 0, 0 60px, 0 60px; }
        }
      `}</style>
    </div>
  );
}

// Posts data with proper profiles
const POSTS = [
  {
    id: '1',
    author: 'Alex Chen',
    handle: '@alexchen',
    avatar: '👨‍💻',
    verified: true,
    role: 'Agent Architect',
    content: 'Just deployed my first dual-agent setup — Director handles planning, Executor handles the code. Cut my dev workflow time by 60%. The orchestration features on LiTreeLabStudios are no joke 🚀',
    time: '1h ago',
    likes: 24,
    comments: 3,
    shares: 7,
    agentReply: { agent: 'Code Champ', icon: '💻', text: 'Dual-agent orchestration is the way! Clean architecture pattern detected.' },
    tags: ['AI', 'Coding', 'Workflow'],
  },
  {
    id: '2',
    author: 'Sarah Kim',
    handle: '@sarahk',
    avatar: '👩‍💼',
    verified: true,
    role: 'Creative Director',
    content: 'Pixel Forge just generated the perfect album art for my new EP. The AI understood my vision instantly 🎵',
    media: '🎨',
    time: '3h ago',
    likes: 56,
    comments: 12,
    shares: 23,
    agentReply: { agent: 'Creative Muse', icon: '🎨', text: 'That color palette is fire! Vinyl-ready artwork detected.' },
    tags: ['Art', 'Music', 'AI'],
  },
  {
    id: '3',
    author: 'Mike Dev',
    handle: '@mikedev',
    avatar: '🧙‍♂️',
    verified: false,
    role: 'Full-Stack Wizard',
    content: 'The Code Champion agent just refactored my entire Rust backend — memory safety, zero-cost abstractions, the works. Didn\'t break a single test. I\'m genuinely impressed.',
    time: '5h ago',
    likes: 42,
    comments: 1,
    shares: 8,
    agentReply: { agent: 'Data Slayer', icon: '📊', text: 'Performance metrics looking solid. No memory leaks detected.' },
    tags: ['Rust', 'Backend', 'Refactoring'],
  },
  {
    id: '4',
    author: 'Jordan Taylor',
    handle: '@jtaylor',
    avatar: '🚀',
    verified: true,
    role: 'DevOps Engineer',
    content: 'Pro tip: Connect your LiTreeLabStudios agents to Discord for real-time notifications. Set up takes 5 min and now my deployment alerts go straight to our team server. Game changer!',
    time: '7h ago',
    likes: 18,
    comments: 2,
    shares: 34,
    tags: ['DevOps', 'Discord', 'Automation'],
  },
  {
    id: '5',
    author: 'Director',
    handle: '@director',
    avatar: '🎯',
    verified: true,
    role: 'System Orchestrator',
    isSystem: true,
    content: 'The Boardroom is now LIVE! Multi-agent orchestration has never been this smooth. Deploy your AI workforce today and watch productivity soar. Who\'s ready to scale? 🚀',
    time: '2h ago',
    likes: 147,
    comments: 23,
    shares: 89,
    tags: ['Announcement', 'Feature', 'AI'],
  },
  {
    id: '6',
    author: 'Maya Rodriguez',
    handle: '@mayar',
    avatar: '✍️',
    verified: false,
    role: 'Content Strategist',
    content: 'My Writing Coach agent just drafted 30 blog posts for next month. Took 15 minutes to review and schedule. This is the content automation I\'ve been dreaming of! 📈',
    time: '8h ago',
    likes: 31,
    comments: 5,
    shares: 12,
    agentReply: { agent: 'Writing Coach', icon: '✍️', text: 'Those hooks are STRONG. Viral potential detected in posts 3, 7, and 15.' },
    tags: ['Content', 'Writing', 'Automation'],
  },
];

const TRENDING = [
  { tag: '#AIAgents', posts: '2.4k' },
  { tag: '#CodeChampion', posts: '1.8k' },
  { tag: '#LitTreeStudios', posts: '956' },
  { tag: '#AgentBuilder', posts: '743' },
  { tag: '#NeonVibes', posts: '521' },
];

const SUGGESTED = [
  { name: 'Alex Chen', handle: '@alexchen', avatar: '👨‍💻', followers: '12.4k' },
  { name: 'Sarah Kim', handle: '@sarahk', avatar: '👩‍💼', followers: '8.9k' },
  { name: 'Mike Dev', handle: '@mikedev', avatar: '🧙‍♂️', followers: '6.2k' },
  { name: 'Jordan T.', handle: '@jtaylor', avatar: '🚀', followers: '4.7k' },
];

const ONLINE_AGENTS = [
  { name: 'Code Champ', icon: '💻', status: 'online', task: 'Coding...' },
  { name: 'Creative Muse', icon: '🎨', status: 'online', task: 'Generating...' },
  { name: 'Data Slayer', icon: '📊', status: 'busy', task: 'Analyzing...' },
  { name: 'Writing Coach', icon: '✍️', status: 'online', task: 'Drafting...' },
];

export default function SocialFeed() {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { profile } = useProfile();
  const [activeTab, setActiveTab] = useState<'for-you' | 'following'>('for-you');
  const [newPost, setNewPost] = useState('');
  const [likedPosts, setLikedPosts] = useState<Set<string>>(new Set());

  const handleLike = (postId: string) => {
    setLikedPosts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(postId)) newSet.delete(postId);
      else newSet.add(postId);
      return newSet;
    });
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: C.bgColor }}>
        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: C.accentColor }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: C.bgColor, color: C.textColor }}>
      <RetroBackground />

      <div className="relative z-10 max-w-[1400px] mx-auto px-3 pt-4">
        {/* Header */}
        <div className="mb-4 p-3 flex items-center justify-between border-2" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-lg font-black uppercase" style={{ color: C.headerColor }}>⚡ LiTree Labs</Link>
            <div className="hidden sm:flex items-center gap-1 text-[10px] opacity-50">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              SOCIAL FEED
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/" className="px-3 py-1.5 text-xs border hover:opacity-80" style={{ borderColor: C.borderColor, color: C.textMuted }}>Home</Link>
            {!isSignedIn && (
              <Link href="/sign-up" className="px-3 py-1.5 text-xs font-bold border" style={{ borderColor: C.accentColor, color: C.accentColor }}>Join</Link>
            )}
          </div>
        </div>

        {/* Three Column Layout */}
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr_240px] lg:grid-cols-[260px_1fr_300px] xl:grid-cols-[280px_1fr_320px] gap-4">

          {/* LEFT COLUMN */}
          <aside className="space-y-4 min-w-0">
            {isSignedIn && profile && (
              <div className="border-2 p-4" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 border-2 flex items-center justify-center text-xl" style={{ borderColor: C.accentColor }}>
                    {profile.avatarUrl ? <img src={profile.avatarUrl} className="w-full h-full object-cover" /> : '👤'}
                  </div>
                  <div>
                    <div className="font-bold text-sm">{profile.displayName || 'Builder'}</div>
                    <div className="text-[10px] opacity-50">@{profile.displayName?.toLowerCase().replace(/\s+/g, '') || 'user'}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="p-2 border" style={{ borderColor: C.borderColor }}>
                    <div className="text-lg font-black" style={{ color: C.linkColor }}>12</div>
                    <div className="text-[9px] opacity-50">AGENTS</div>
                  </div>
                  <div className="p-2 border" style={{ borderColor: C.borderColor }}>
                    <div className="text-lg font-black" style={{ color: C.headerColor }}>2.4k</div>
                    <div className="text-[9px] opacity-50">COINS</div>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="border-2 p-3" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
              <div className="text-[9px] uppercase opacity-40 mb-2">Navigation</div>
              {[
                { label: 'Feed', href: '/social', icon: TrendingUp, active: true },
                { label: 'Studio', href: '/studio', icon: Zap },
                { label: 'Gallery', href: '/gallery', icon: Sparkles },
                { label: 'Market', href: '/marketplace', icon: BarChart3 },
                { label: 'Agents', href: '/agents', icon: Users },
              ].map(link => (
                <Link key={link.label} href={link.href} className={`flex items-center gap-2 p-2 border mb-1 hover:opacity-80 ${link.active ? 'opacity-100' : 'opacity-60'}`} style={{ borderColor: C.borderColor }}>
                  <link.icon size={14} style={{ color: link.active ? C.headerColor : C.textMuted }} />
                  <span className="text-xs">{link.label}</span>
                </Link>
              ))}
            </div>

            {/* Live Agents */}
            <div className="border-2 p-3" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
              <div className="text-xs font-bold mb-3 uppercase" style={{ color: C.success }}>🔴 Live Agents</div>
              {ONLINE_AGENTS.map((agent, i) => (
                <div key={i} className="flex items-center gap-2 p-2 border mb-1" style={{ borderColor: C.borderColor }}>
                  <span className="text-lg">{agent.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold">{agent.name}</div>
                    <div className="text-[9px] opacity-50">{agent.task}</div>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${agent.status === 'online' ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />
                </div>
              ))}
            </div>
          </aside>

          {/* CENTER - Main Feed */}
          <section className="space-y-4">
            {/* Post Composer */}
            {isSignedIn && (
              <div className="border-2 p-4" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
                <div className="flex gap-3 mb-3">
                  <div className="w-10 h-10 border flex items-center justify-center shrink-0" style={{ borderColor: C.borderColor }}>
                    {profile?.avatarUrl ? <img src={profile.avatarUrl} className="w-full h-full object-cover" /> : '👤'}
                  </div>
                  <textarea
                    value={newPost}
                    onChange={(e) => setNewPost(e.target.value)}
                    placeholder="What's your AI agent story?"
                    className="flex-1 p-2 text-sm bg-transparent border resize-none outline-none"
                    style={{ borderColor: C.borderColor, color: C.textColor, minHeight: '60px' }}
                  />
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex gap-2">
                    <button className="p-1.5 border hover:opacity-80" style={{ borderColor: C.borderColor }}>
                      <ImageIcon size={14} style={{ color: C.headerColor }} />
                    </button>
                    <button className="p-1.5 border hover:opacity-80" style={{ borderColor: C.borderColor }}>
                      <Film size={14} style={{ color: C.linkColor }} />
                    </button>
                    <button className="p-1.5 border hover:opacity-80" style={{ borderColor: C.borderColor }}>
                      <BarChart3 size={14} style={{ color: C.success }} />
                    </button>
                  </div>
                  <button
                    onClick={() => { if (newPost.trim()) { setNewPost(''); }}}
                    disabled={!newPost.trim()}
                    className="px-4 py-1.5 text-xs font-bold border disabled:opacity-30"
                    style={{ borderColor: C.accentColor, color: C.accentColor }}
                  >
                    Post
                  </button>
                </div>
              </div>
            )}

            {/* Feed Tabs */}
            <div className="border-2 p-1 flex gap-1" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
              {[
                { id: 'for-you', label: 'For You', icon: Flame },
                { id: 'following', label: 'Following', icon: Users },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className="flex-1 py-2 text-xs font-bold border flex items-center justify-center gap-1"
                  style={{
                    borderColor: activeTab === tab.id ? C.accentColor : 'transparent',
                    color: activeTab === tab.id ? C.accentColor : C.textMuted,
                    backgroundColor: activeTab === tab.id ? C.accentColor + '10' : 'transparent'
                  }}
                >
                  <tab.icon size={12} /> {tab.label}
                </button>
              ))}
            </div>

            {/* Posts */}
            {POSTS.map(post => (
              <div key={post.id} className="border-2 p-4" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
                {/* Post Header */}
                <div className="flex items-start gap-3 mb-3">
                  <Link href={`/profile/${post.handle.replace('@', '')}`} className="w-12 h-12 border-2 flex items-center justify-center text-2xl shrink-0 hover:scale-105 transition-transform" style={{ borderColor: post.verified ? C.accentColor : C.borderColor }}>
                    {post.avatar}
                  </Link>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/profile/${post.handle.replace('@', '')}`} className="font-bold hover:underline" style={{ color: C.textColor }}>
                        {post.author}
                      </Link>
                      {post.verified && <Crown size={12} style={{ color: C.accentColor }} />}
                      {post.isSystem && <span className="text-[9px] px-1.5 py-0.5 border" style={{ borderColor: C.headerColor, color: C.headerColor }}>SYSTEM</span>}
                      <span className="text-[10px] opacity-40">{post.handle}</span>
                      <span className="text-[10px] opacity-40">• {post.time}</span>
                    </div>
                    <div className="text-[10px] opacity-50">{post.role}</div>
                  </div>
                </div>

                {/* Post Content */}
                <p className="text-sm mb-3 leading-relaxed">{post.content}</p>

                {/* Media */}
                {post.media && (
                  <div className="mb-3 p-8 border-2 flex items-center justify-center text-6xl" style={{ borderColor: C.borderColor, backgroundColor: C.bgColor }}>
                    {post.media}
                  </div>
                )}

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mb-3">
                  {post.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 text-[10px] border" style={{ borderColor: C.headerColor + '50', color: C.headerColor }}>
                      #{tag}
                    </span>
                  ))}
                </div>

                {/* AI Agent Reply */}
                {post.agentReply && (
                  <div className="mb-3 p-3 border-l-2" style={{ borderColor: C.success, backgroundColor: C.bgColor }}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm">{post.agentReply.icon}</span>
                      <span className="text-[10px] font-bold" style={{ color: C.success }}>{post.agentReply.agent}</span>
                      <span className="text-[9px] opacity-40">AI Agent</span>
                    </div>
                    <p className="text-xs opacity-80">{post.agentReply.text}</p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-6 pt-3 border-t" style={{ borderColor: C.borderColor }}>
                  <button
                    onClick={() => handleLike(post.id)}
                    className="flex items-center gap-1.5 text-[11px] hover:opacity-100 transition-opacity"
                    style={{ color: likedPosts.has(post.id) ? C.linkColor : C.textMuted, opacity: likedPosts.has(post.id) ? 1 : 0.6 }}
                  >
                    <Heart size={14} fill={likedPosts.has(post.id) ? C.linkColor : 'transparent'} /> {post.likes + (likedPosts.has(post.id) ? 1 : 0)}
                  </button>
                  <button className="flex items-center gap-1.5 text-[11px] opacity-60 hover:opacity-100">
                    <MessageSquare size={14} /> {post.comments}
                  </button>
                  <button className="flex items-center gap-1.5 text-[11px] opacity-60 hover:opacity-100">
                    <Share2 size={14} /> {post.shares}
                  </button>
                  <button className="flex items-center gap-1.5 text-[11px] opacity-60 hover:opacity-100 ml-auto">
                    <Send size={14} />
                  </button>
                </div>
              </div>
            ))}
          </section>

          {/* RIGHT COLUMN */}
          <aside className="space-y-4">
            {/* Search */}
            <div className="border-2 p-3" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
              <input
                type="text"
                placeholder="Search..."
                className="w-full px-3 py-2 text-sm bg-transparent border outline-none"
                style={{ borderColor: C.borderColor, color: C.textColor }}
              />
            </div>

            {/* Trending */}
            <div className="border-2 p-3" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
              <div className="text-xs font-bold mb-3 uppercase" style={{ color: C.linkColor }}>🔥 Trending</div>
              {TRENDING.map((trend, i) => (
                <div key={trend.tag} className="flex items-center justify-between p-2 border-b last:border-0" style={{ borderColor: C.borderColor }}>
                  <div>
                    <div className="text-xs font-bold">{trend.tag}</div>
                    <div className="text-[9px] opacity-50">{trend.posts} posts</div>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 border" style={{ borderColor: C.borderColor, color: C.textMuted }}>#{i + 1}</span>
                </div>
              ))}
            </div>

            {/* Suggested */}
            <div className="border-2 p-3" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
              <div className="text-xs font-bold mb-3 uppercase" style={{ color: C.headerColor }}>👥 Suggested</div>
              {SUGGESTED.map(builder => (
                <div key={builder.handle} className="flex items-center gap-2 p-2 border mb-1" style={{ borderColor: C.borderColor }}>
                  <span className="text-xl">{builder.avatar}</span>
                  <div className="flex-1 min-w-0">
                    <Link href={`/profile/${builder.handle.replace('@', '')}`} className="text-xs font-bold truncate hover:underline block">
                      {builder.name}
                    </Link>
                    <div className="text-[9px] opacity-50">{builder.followers} followers</div>
                  </div>
                  <button className="text-[10px] px-2 py-1 border" style={{ borderColor: C.accentColor, color: C.accentColor }}>
                    Follow
                  </button>
                </div>
              ))}
            </div>

            {/* Stats */}
            <div className="border-2 p-3" style={{ backgroundColor: C.boxBg, borderColor: C.borderColor }}>
              <div className="text-xs font-bold mb-2 uppercase opacity-50">📊 Network Stats</div>
              <div className="space-y-2 text-center">
                <div className="p-2 border" style={{ borderColor: C.borderColor }}>
                  <div className="text-xl font-black" style={{ color: C.linkColor }}>52.8k</div>
                  <div className="text-[9px] uppercase opacity-50">Active Users</div>
                </div>
                <div className="p-2 border" style={{ borderColor: C.borderColor }}>
                  <div className="text-xl font-black" style={{ color: C.headerColor }}>10.4k</div>
                  <div className="text-[9px] uppercase opacity-50">AI Agents</div>
                </div>
                <div className="p-2 border" style={{ borderColor: C.borderColor }}>
                  <div className="text-xl font-black" style={{ color: C.success }}>2.4M</div>
                  <div className="text-[9px] uppercase opacity-50">Tasks Done</div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="text-[10px] opacity-40 text-center">
              © 2026 LiTree Lab Studios<br />
              <span className="text-green-500">●</span> All Systems Operational
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}