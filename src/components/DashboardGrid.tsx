"use client";
import React from 'react';
import Link from 'next/link';
import { useAuth } from '@/context/AuthContext';

interface QuickAction {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  href: string;
}

const actions: QuickAction[] = [
  { id: 'neural-link', title: 'Neural Chat', subtitle: 'Chat with AI agents', icon: '⚡', color: 'from-amber-500 to-orange-600', href: '/agent-chat' },
  { id: 'bot-forge', title: 'Bot Forge', subtitle: 'Browse & acquire agents', icon: '🔧', color: 'from-blue-500 to-indigo-600', href: '/marketplace' },
  { id: 'the-matrix', title: 'The Feed', subtitle: 'Builder social network', icon: '👥', color: 'from-cyan-500 to-blue-600', href: '/social' },
  { id: 'forge-agent', title: 'Forge Agent', subtitle: 'Build custom AI agents', icon: '🛠️', color: 'from-emerald-500 to-teal-600', href: '/builder' },
  { id: 'champions', title: 'Gallery', subtitle: 'Explore top agents', icon: '🏛️', color: 'from-purple-500 to-fuchsia-600', href: '/gallery' },
  { id: 'system-config', title: 'Settings', subtitle: 'Account & workspace', icon: '⚙️', color: 'from-slate-500 to-slate-700', href: '/settings' },
];

export default function DashboardGrid() {
  const { user } = useAuth();

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold tracking-tight text-white mb-1">
          Welcome back, <span className="gradient-text">{user?.name || user?.email?.split("@")[0] || "Builder"}</span>
        </h1>
        <p className="text-sm text-zinc-500">Your agents are running. Here&apos;s your workspace.</p>
      </div>

      {/* Quick Actions Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {actions.map((action) => (
          <Link
            key={action.id}
            href={action.href}
            className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.06] hover:border-white/20 transition-all group"
          >
            <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${action.color} flex items-center justify-center text-xl flex-shrink-0 group-hover:scale-105 transition-transform`}>
              {action.icon}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-white">{action.title}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">{action.subtitle}</p>
            </div>
            <div className="text-zinc-600 group-hover:text-white group-hover:translate-x-0.5 transition-all text-sm">→</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
