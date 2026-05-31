import React from 'react';
import Link from 'next/link';
import JobQueueMonitor from './JobQueueMonitor';

interface QuickAction {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  href: string;
}

const actions: QuickAction[] = [
  { id: 'neural-link', title: 'NEURAL LINK', subtitle: 'DIRECT AI CONNECTION', icon: '⚡', color: 'from-amber-400 to-orange-500', href: '/agent-chat' },
  { id: 'bot-forge', title: 'BOT FORGE', subtitle: 'ACQUIRE NEW DAEMONS', icon: '🔧', color: 'from-blue-400 to-indigo-500', href: '/marketplace' },
  { id: 'the-matrix', title: 'THE MATRIX', subtitle: 'BUILDER NETWORK', icon: '👥', color: 'from-cyan-400 to-blue-500', href: '/social' },
  { id: 'forge-agent', title: 'FORGE AGENT', subtitle: 'CONSTRUCT CUSTOM AI', icon: '🛠️', color: 'from-emerald-400 to-teal-500', href: '/builder' },
  { id: 'champions', title: 'CHAMPIONS', subtitle: 'ELITE REGISTRY', icon: '🏛️', color: 'from-purple-400 to-fuchsia-500', href: '/gallery' },
  { id: 'system-config', title: 'SYSTEM CONFIG', subtitle: 'WORKSPACE PARAMS', icon: '⚙️', color: 'from-slate-400 to-slate-600', href: '/settings' },
];

export default function DashboardGrid() {
  return (
    <div className="w-full max-w-md mx-auto p-4 bg-black text-white font-sans selection:bg-cyan-500 selection:text-black">
      
      {/* Header Section */}
      <header className="mb-6 space-y-1">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.25em] text-cyan-400 font-mono uppercase">
          <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          System_Status: Online
        </div>
        <h1 className="text-2xl font-black tracking-tight text-white uppercase">
          Welcome Back, <span className="bg-gradient-to-r from-cyan-400 via-indigo-400 to-purple-500 bg-clip-text text-transparent">Builder</span>
        </h1>
        <p className="text-xs text-zinc-400 font-mono tracking-wide">
          Your CEO Operating System is initialized and ready.
        </p>
      </header>

      {/* Telemetry Indicator */}
      <JobQueueMonitor />

      {/* Grid Menu Title */}
      <div className="text-[10px] font-mono tracking-[0.3em] text-zinc-600 uppercase mb-3 border-b border-zinc-900 pb-1">
        Quick_Initialization
      </div>

      {/* Interface Menu Grid */}
      <div className="space-y-3">
        {actions.map((action) => (
          <Link
            key={action.id}
            href={action.href}
            className="w-full text-left flex items-center gap-4 p-4 rounded-xl border border-zinc-900 bg-gradient-to-b from-zinc-900/60 to-zinc-950/80 backdrop-blur-sm transition-all duration-300 hover:border-zinc-700/50 hover:shadow-[0_0_20px_rgba(6,182,212,0.05)] group relative overflow-hidden block"
          >
            {/* Soft background glow effect on hover */}
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.03)_0%,transparent_70%)]" />

            {/* Icon Container with Gradient Border */}
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center text-xl bg-gradient-to-br ${action.color} bg-opacity-10 backdrop-blur-md border border-white/10 group-hover:scale-105 transition-transform duration-300 shadow-inner`}>
              <span className="drop-shadow-[0_2px_8px_rgba(255,255,255,0.2)]">{action.icon}</span>
            </div>

            {/* Text Hierarchy */}
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-black tracking-wider text-zinc-200 group-hover:text-white transition-colors font-mono">
                {action.title}
              </h3>
              <p className="text-[10px] text-zinc-500 tracking-widest font-mono mt-0.5 truncate uppercase">
                {action.subtitle}
              </p>
            </div>

            {/* Futuristic Chevron Indicator */}
            <div className="text-zinc-600 group-hover:text-cyan-400 group-hover:translate-x-1 transition-all duration-300 font-mono text-xs pr-1">
              &rarr;
            </div>
          </Link>
        ))}
      </div>

      {/* Floating Action Protocol Button */}
      <div className="fixed bottom-6 right-6 z-50">
        <button className="w-14 h-14 rounded-full bg-cyan-400 text-black font-bold flex items-center justify-center shadow-[0_0_25px_rgba(34,211,238,0.4)] hover:shadow-[0_0_35px_rgba(34,211,238,0.6)] hover:scale-110 active:scale-95 transition-all duration-300 group">
          <span className="text-xl group-hover:rotate-12 transition-transform duration-300">⚡</span>
        </button>
      </div>

    </div>
  );
}
